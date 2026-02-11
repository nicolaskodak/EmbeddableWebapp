import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ------ Summary ------ 
// GET - 單筆查詢
// LIST - 列表查詢
// UPSERT - 新增/更新（包含 CREATE 功能）
// DELETE - 軟刪除（更新 status_id = inactive）

// ---- Request payload types ----
type UpsertPayload = {
  op: "upsert";
  event_id: string;
  table?: string; // default to "items" if missing
  schema?: string; // optional schema, defaults to "public"
  row: Record<string, any>; // generic row data
  conflict_columns?: string[]; // optional, for upsert conflict resolution
};

type DeletePayload = {
  op: "delete";
  event_id: string;
  table?: string; // default to "items" if missing
  schema?: string; // optional schema, defaults to "public"
  filter: Record<string, any>; // e.g. { name: "foo" } or { id: 123 }
  deleted_at?: string;
};

type Payload = UpsertPayload | DeletePayload;

// Cache for status IDs to avoid repeated lookups
let cachedActiveStatusId: number | null = null;
let cachedInactiveStatusId: number | null = null;

async function getStatusIds(supabase: any) {
  if (!cachedActiveStatusId || !cachedInactiveStatusId) {
    const { data, error } = await supabase
      .from("status")
      .select("id, status")
      .in("status", ["active", "inactive"]);

    if (error || !data) {
      throw new Error("Failed to fetch status IDs");
    }

    cachedActiveStatusId = data.find((s: any) => s.status === "active")?.id;
    cachedInactiveStatusId = data.find((s: any) => s.status === "inactive")?.id;
  }

  return {
    activeStatusId: cachedActiveStatusId!,
    inactiveStatusId: cachedInactiveStatusId!,
  };
}

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
    const schema = url.searchParams.get("schema") || "public"; // default schema

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
        .schema(schema)
        .from(table)
        .select("*")
        .eq(filterCol, filterVal)
        .limit(1);

      // Filter by active status (soft delete support)
      // Skip status_id filter for the status table itself
      if (!includeDeleted && table !== "status") {
        const { activeStatusId } = await getStatusIds(supabase);
        q = q.eq("status_id", activeStatusId);
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
      .schema(schema)
      .from(table)
      .select("*")
      .limit(limit);

    // Try to order by updated_at if possible, else just default order
    // We can't easily know if updated_at exists for all tables without metadata check.
    // But stores and items both have updated_at.
    q = q.order("updated_at", { ascending: false });

    // Filter by active status (soft delete support)
    // Skip status_id filter for the status table itself
    if (!includeDeleted && table !== "status") {
      const { activeStatusId } = await getStatusIds(supabase);
      q = q.eq("status_id", activeStatusId);
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
  const schema = payload.schema || "public"; // default schema

  if (payload.op === "upsert") {
    const row = payload.row;
    if (!row) {
      return new Response("Missing row data", { status: 400 });
    }

    // Auto-fill updated_at if missing
    if (!row.updated_at) {
      row.updated_at = new Date().toISOString();
    }

    // Ensure status is active on upsert (revival of soft-deleted records)
    if (!row.status_id) {
      const { activeStatusId } = await getStatusIds(supabase);
      row.status_id = activeStatusId;
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
      .schema(schema)
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
      return new Response("Missing filter for delete", { status: 400 });
    }

    // Soft delete: update status_id to inactive
    const { inactiveStatusId } = await getStatusIds(supabase);
    const updatedAt = new Date().toISOString();

    const { error: delErr } = await supabase
      .schema(schema)
      .from(table)
      .update({
        status_id: inactiveStatusId,
        updated_at: updatedAt,
      })
      .match(filter);

    if (delErr) {
      return new Response(JSON.stringify(delErr), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
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