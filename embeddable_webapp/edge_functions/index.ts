import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- Request payload types ----
type UpsertPayload = {
  op: "upsert";
  event_id: string;
  table?: string; // default to "items" if missing
  row: Record<string, any>; // generic row data
  conflict_columns?: string[]; // optional, for upsert conflict resolution
};

type DeletePayload = {
  op: "delete";
  event_id: string;
  table?: string; // default to "items" if missing
  filter: Record<string, any>; // e.g. { name: "foo" } or { id: 123 }
  deleted_at?: string;
};

type Payload = UpsertPayload | DeletePayload;

serve(async (req) => {
  // 0) Shared-secret auth for ALL methods (GET/POST)
  const syncKey = req.headers.get("x-sync-key");
  if (!syncKey || syncKey !== Deno.env.get("SYNC_KEY")) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- GET: getItem / listItems (Generic) ----
  if (req.method === "GET") {
    const url = new URL(req.url);
    const table = url.searchParams.get("table") || "items"; // default table
    
    // Common params
    const includeDeleted = url.searchParams.get("include_deleted") === "true";
    const limitRaw = url.searchParams.get("limit") ?? "50";
    const limit = Math.max(1, Math.min(200, Number(limitRaw) || 50));

    // Filter by specific column (generic way: ?col=name&val=foo)
    const filterCol = url.searchParams.get("col");
    const filterVal = url.searchParams.get("val");

    // get single item by filter
    if (filterCol && filterVal) {
      let q = supabase
        .from(table)
        .select("*")
        .eq(filterCol, filterVal)
        .limit(1);

      // Only apply deleted_at check if the table has that column (assuming standard schema)
      // For simplicity, we assume tables might have deleted_at. If not, this might error or be ignored.
      // A safer way is to check table metadata, but for now we assume convention.
      if (!includeDeleted) {
        // We try to filter deleted_at only if we think it exists. 
        // Or we just try it. If column doesn't exist, Supabase/Postgres might throw error.
        // For "stores" table, we don't have deleted_at in the SQL provided, so we should skip this 
        // or add deleted_at to stores table. 
        // Based on user request, stores table has store_status, maybe use that?
        // For generic approach, let's assume standard soft delete column "deleted_at" if it exists.
        // If the table doesn't have deleted_at, we might need to skip this filter or handle error.
        // For now, let's apply it only for "items" or tables known to have it.
        if (table === "items") {
           q = q.is("deleted_at", null);
        }
      }

      const { data, error } = await q.maybeSingle();

      if (error) {
        return new Response(JSON.stringify(error), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // not found
      if (!data) {
        return new Response(JSON.stringify({ ok: true, item: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, item: data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // list items
    let q = supabase
      .from(table)
      .select("*")
      .limit(limit);
      
    // Try to order by updated_at if possible, else just default order
    // We can't easily know if updated_at exists for all tables without metadata check.
    // But stores and items both have updated_at.
    q = q.order("updated_at", { ascending: false });

    if (!includeDeleted && table === "items") {
       q = q.is("deleted_at", null);
    }

    const { data, error } = await q;

    if (error) {
      return new Response(JSON.stringify(error), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, items: data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ---- POST: upsert/delete (Generic) ----
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 3) Parse JSON
  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // 4) Minimal validation
  if (!payload?.event_id || typeof payload.event_id !== "string") {
    return new Response("Missing event_id", { status: 400 });
  }

  // 5) Idempotency: if event already applied, return OK (safe retry)
  const { data: existing, error: checkErr } = await supabase
    .from("sync_events_applied")
    .select("event_id")
    .eq("event_id", payload.event_id)
    .maybeSingle();

  if (checkErr) {
    return new Response(JSON.stringify(checkErr), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (existing) {
    return new Response(JSON.stringify({ ok: true, deduped: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // 6) Apply operation
  const table = payload.table || "items"; // default to items for backward compatibility

  if (payload.op === "upsert") {
    const row = payload.row;
    if (!row) {
      return new Response("Missing row data", { status: 400 });
    }

    // Auto-fill updated_at if missing
    if (!row.updated_at) {
      row.updated_at = new Date().toISOString();
    }
    
    // For items table, handle deleted_at revival logic
    if (table === "items") {
      row.deleted_at = null;
    }

    // Upsert
    // We need to know the conflict columns for onConflict.
    // For 'items', it's 'name'. For 'stores', it might be 'id' or 'erp_customer_name'.
    // We let the client specify it, or default based on table.
    let conflict = payload.conflict_columns;
    if (!conflict) {
      if (table === "items") conflict = ["name"];
      else if (table === "stores") conflict = ["id"]; // or erp_customer_name? usually ID for updates
      else if (table === "inventory_details") conflict = ["item_code"];
      else conflict = ["id"]; // safe default guess
    }
    
    const { error: upsertErr } = await supabase
      .from(table)
      .upsert(row, { onConflict: conflict.join(",") });

    if (upsertErr) {
      return new Response(JSON.stringify(upsertErr), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else if (payload.op === "delete") {
    const filter = payload.filter;
    if (!filter || Object.keys(filter).length === 0) {
       // Backward compatibility for "items" table using "name"
       if (table === "items" && (payload as any).name) {
         // convert old payload format to filter
       } else {
         return new Response("Missing filter for delete", { status: 400 });
       }
    }

    // Handle backward compatibility for items table delete payload
    let finalFilter = filter;
    if (table === "items" && (payload as any).name && !finalFilter) {
      finalFilter = { name: (payload as any).name };
    }

    // Check if table supports soft delete
    // 'items' has deleted_at. 'stores' does not (based on SQL).
    // If stores table needs soft delete, we should update SQL or use store_status='inactive'.
    // For now, let's assume hard delete for stores, soft delete for items.
    
    if (table === "items") {
      const deletedAt = payload.deleted_at ?? new Date().toISOString();
      const { error: delErr } = await supabase
        .from(table)
        .update({ deleted_at: deletedAt, updated_at: deletedAt })
        .match(finalFilter);
        
      if (delErr) {
        return new Response(JSON.stringify(delErr), { status: 400, headers: { "Content-Type": "application/json" } });
      }
    } else {
      // Hard delete for other tables (like stores)
      const { error: delErr } = await supabase
        .from(table)
        .delete()
        .match(finalFilter);
        
      if (delErr) {
        return new Response(JSON.stringify(delErr), { status: 400, headers: { "Content-Type": "application/json" } });
      }
    }
  } else {
    return new Response("Unknown op", { status: 400 });
  }

  // 7) Mark event applied
  const { error: markErr } = await supabase
    .from("sync_events_applied")
    .insert({ event_id: payload.event_id });

  if (markErr) {
    return new Response(JSON.stringify(markErr), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, deduped: false }), {
    headers: { "Content-Type": "application/json" },
  });
});