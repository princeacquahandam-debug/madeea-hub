-- Put the upload rule back, once the frontend that obeys it is live.
--
-- ── APPLY THIS AFTER DEPLOYING, NOT BEFORE ───────────────────────────────
--
-- 0067 tightened the storage INSERT rule to "upload into a folder named for
-- yourself". That was applied to production while the DEPLOYED frontend still
-- wrote flat keys (`${Date.now()}-name.pdf`), whose first path segment is the
-- filename and never a user id — so every upload was refused until a temporary
-- policy was pasted in that also accepts a single-segment key.
--
-- This is the other half of that. It removes the legacy allowance, which exists
-- only to keep an old frontend working, and a temporary widening of a security
-- rule that nobody removes is just the rule.
--
-- ORDER MATTERS:
--   1. deploy the frontend that uploads to `<uid>/<timestamp>-<name>`
--   2. then run this
--
-- Run it first and uploads break again, exactly as they did before.
--
-- ── WHY THE OLD FILES ARE STILL FINE ─────────────────────────────────────
--
-- Nothing here touches read or delete. Both are decided by the `files` row
-- (0067), not by the path, which is precisely why files uploaded under the old
-- flat keys remain readable and deletable by the right people forever. Only
-- NEW writes are constrained, because a write is the one moment there is no row
-- to consult yet.
drop policy if exists "workspace files write" on storage.objects;

create policy "workspace files write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workspace-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
