import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- Request payload types ----
type UpsertPayload = {
  op: "upsert";
  event_id: string;
  row: {
    name: string;
    qty: number;
    updated_at?: string;
  };
};

type DeletePayload = {
  op: "delete";
  event_id: string;
  name: string;
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

  // ---- GET: getItem / listItems ----
  if (req.method === "GET") {
    const url = new URL(req.url);

    const name = url.searchParams.get("name"); // optional
    const includeDeleted = url.searchParams.get("include_deleted") === "true";

    // default list limit
    const limitRaw = url.searchParams.get("limit") ?? "50";
    const limit = Math.max(1, Math.min(200, Number(limitRaw) || 50));

    // get single item by name
    if (name) {
      let q = supabase
        .from("items")
        .select("id,name,qty,updated_at,deleted_at")
        .eq("name", name)
        .limit(1);

      if (!includeDeleted) q = q.is("deleted_at", null);

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
      .from("items")
      .select("id,name,qty,updated_at,deleted_at")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (!includeDeleted) q = q.is("deleted_at", null);

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

  // ---- POST: upsert/delete (existing logic) ----
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
  if (payload.op === "upsert") {
    const row = payload.row;
    if (!row?.name || typeof row.name !== "string") {
      return new Response("Invalid row.name", { status: 400 });
    }
    if (typeof row.qty !== "number" || Number.isNaN(row.qty)) {
      return new Response("Invalid row.qty", { status: 400 });
    }

    const updatedAt = row.updated_at ?? new Date().toISOString();

    // Upsert by name (requires UNIQUE index on name)
    const { error: upsertErr } = await supabase
      .from("items")
      .upsert(
        {
          name: row.name,
          qty: row.qty,
          updated_at: updatedAt,
          deleted_at: null, // revive if previously deleted
        },
        { onConflict: "name" },
      );

    if (upsertErr) {
      return new Response(JSON.stringify(upsertErr), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else if (payload.op === "delete") {
    if (!payload.name || typeof payload.name !== "string") {
      return new Response("Invalid name", { status: 400 });
    }

    const deletedAt = payload.deleted_at ?? new Date().toISOString();

    // soft delete
    const { error: delErr } = await supabase
      .from("items")
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq("name", payload.name);

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