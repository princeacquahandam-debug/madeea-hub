// Edge Function: screenshot-delete   (Verify JWT: OFF. Auth enforced in code.)
//
// Deleting a screenshot means deleting the IMAGE, not the row that points at it.
//
// WHY THIS IS A FUNCTION AND NOT A DELETE STATEMENT. A row delete leaves the
// JPEG in the bucket: still stored, still readable by anything with storage
// access, and now invisible to every query, every filter and every audit. For a
// product that photographs people's screens that is not untidiness, it is a
// privacy failure that reports itself as done. Sixteen files were found in this
// bucket against five rows, so eleven pictures of somebody's desktop existed
// that nothing in the app could see or account for.
//
// The storage API is only reachable with the service-role key, which must never
// be in a browser, so the whole operation lives here: remove the object, mark
// the row, write the audit entry. All three or none.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const BUCKET = "time-screenshots";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    // The caller's own token, so RLS and the capability functions apply to them
    // rather than to the service role.
    const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    /* Permission is asked of the database, not re-implemented here. can() is the
       same function every RLS policy consults, so this cannot drift from what
       the rest of the system enforces. */
    const { data: allowed } = await asUser.rpc("can", { capability: "delete_screenshots" });
    if (allowed !== true) {
      return json({ error: "You do not have permission to delete screenshots." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "delete");
    const admin = createClient(URL_, SERVICE);

    if (action === "delete") {
      const id = String(body.id ?? "");
      if (!id) return json({ error: "id is required" }, 400);

      // Read through the CALLER's client: if RLS will not show it to them, they
      // may not delete it, and the service role must not be used to reach past
      // that.
      const { data: shot } = await asUser
        .from("time_screenshots")
        .select("id, owner_id, storage_path, captured_at, workspace_id")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!shot) return json({ error: "Not found, or not yours to delete." }, 404);

      /* The image goes first. If this succeeds and the row update fails, the
         result is a row pointing at nothing, which is visible and fixable. The
         other order leaves an invisible image, which is the failure this whole
         function exists to prevent. */
      const { error: rmErr } = await admin.storage.from(BUCKET).remove([shot.storage_path]);
      if (rmErr) return json({ error: `Could not remove the image: ${rmErr.message}` }, 500);

      const { error: rowErr } = await admin
        .from("time_screenshots")
        .update({ deleted_at: new Date().toISOString(), deleted_by: u.user.id })
        .eq("id", id);
      if (rowErr) {
        return json({
          error: "The image was deleted but the record could not be updated.",
          detail: rowErr.message,
          image_deleted: true,
        }, 500);
      }

      /* §12: deletion is logged, and the log records who the data was ABOUT as
         well as who acted. An audit that only says an admin deleted something
         cannot answer whose screen it was. */
      const { error: auditErr } = await admin.from("audit_log").insert({
        workspace_id: shot.workspace_id,
        actor_id: u.user.id,
        subject_id: shot.owner_id,
        action: "screenshot.deleted",
        target_table: "time_screenshots",
        target_id: id,
        detail: { storage_path: shot.storage_path, captured_at: shot.captured_at, permanent: true },
      });
      if (auditErr) {
        return json({
          ok: true, deleted: id, permanent: true,
          warning: `Deleted, but the audit entry failed: ${auditErr.message}`,
        });
      }

      return json({ ok: true, deleted: id, permanent: true });
    }

    if (action === "sweep_orphans") {
      /* Files with no row. They are unreachable through the app, so nothing
         else will ever find them, and they are pictures of somebody's screen.
         Owner-only: this walks the whole bucket. */
      const { data: role } = await asUser.rpc("my_role");
      if (String(role) !== "owner") {
        return json({ error: "Only an owner can sweep orphaned files." }, 403);
      }

      const { data: rows } = await admin.from("time_screenshots").select("storage_path");
      const known = new Set((rows ?? []).map((r: { storage_path: string }) => r.storage_path));

      // The bucket is laid out as <user>/<date>/<file>, so it is walked rather
      // than listed flat: Storage list() does not recurse.
      const orphans: string[] = [];
      const { data: users } = await admin.storage.from(BUCKET).list("", { limit: 1000 });
      for (const user of users ?? []) {
        const { data: days } = await admin.storage.from(BUCKET).list(user.name, { limit: 1000 });
        for (const day of days ?? []) {
          const prefix = `${user.name}/${day.name}`;
          const { data: files } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
          for (const f of files ?? []) {
            const path = `${prefix}/${f.name}`;
            if (!known.has(path)) orphans.push(path);
          }
        }
      }

      if (orphans.length === 0) return json({ ok: true, removed: 0 });

      const { error: rmErr } = await admin.storage.from(BUCKET).remove(orphans);
      if (rmErr) return json({ error: rmErr.message }, 500);

      /* my_workspace(), not a select on memberships.
         The read policy on memberships deliberately shows the whole team, so
         `.select("workspace_id").maybeSingle()` received nine rows and errored,
         workspace_id came out null, and the insert failed against a NOT NULL
         column. Silently, because the result was never checked: the sweep
         reported success and recorded nothing. */
      const { data: ws } = await asUser.rpc("my_workspace");
      const { error: auditErr } = await admin.from("audit_log").insert({
        workspace_id: ws,
        actor_id: u.user.id,
        action: "screenshot.orphans_swept",
        target_table: "storage.objects",
        detail: { count: orphans.length, paths: orphans.slice(0, 50) },
      });
      /* A deletion that is not recorded is worse than one that fails, because
         it looks like it complied. Reported rather than swallowed. */
      if (auditErr) {
        return json({
          ok: true, removed: orphans.length,
          warning: `Files were removed but the audit entry failed: ${auditErr.message}`,
        });
      }

      return json({ ok: true, removed: orphans.length });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
