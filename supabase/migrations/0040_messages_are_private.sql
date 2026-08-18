-- Every EA could read every other EA's inbox.
--
-- The only policy on `messages` was `workspace_id = my_workspace()` for ALL
-- commands, so any signed-in member saw every message any member had ever
-- synced. Three mailboxes were connected and all 64 messages were visible to
-- all nine accounts. Rio reported it after opening the Communication Center and
-- finding Prince's mail in his own inbox, including a payment-failure notice
-- and a Google Play receipt.
--
-- This is the `messages` half of the same defect already logged against
-- eod_reports. A workspace is the tenant boundary, not the privacy boundary,
-- and treating the two as the same thing is what leaked.
--
-- WHY IT CANNOT SIMPLY BE `owner_id = auth.uid()`.
-- Not every message belongs to a person. A Slack channel belongs to a channel:
-- the whole team is in it and should see it. But `owner_id` is NOT NULL with
-- DEFAULT auth.uid(), so a Slack message inserted by slack-sync is stamped with
-- whoever happened to press Sync. Under a pure owner rule a team channel would
-- become the private property of the last person to refresh it, which is a
-- different wrong answer rather than a fix.
--
-- So privacy follows the SOURCE, which is where it actually lives:
--   gmail  -> a personal mailbox, visible to its owner only
--   slack  -> a shared channel, visible to the workspace
-- and by extension whatsapp and discord when they arrive, both of which are
-- shared channels too.
--
-- Shared sources are listed explicitly rather than inferred as "anything that
-- is not gmail". A row with a null or unrecognised source stays private to its
-- owner, so a future integration that forgets to set `source` fails closed. The
-- same absent-means-denied rule used elsewhere in this schema.
--
-- NO ADMIN OVERRIDE, DELIBERATELY.
-- Prince and Bryan are admins and it would have been easy to add `or
-- is_admin()`. It is left out because nothing in the app distinguishes whose
-- mailbox a message came from: there is no owner column in the list, no filter,
-- no "viewing as" mode. An admin reading everyone would get exactly the merged,
-- unlabelled inbox that was just reported as a bug, only with more people in
-- it. Oversight of someone else's mail is a real feature and deserves a real
-- design, not a clause in a policy. Add it when there is a UI that can show
-- whose message you are reading.

drop policy if exists "ws shared" on public.messages;

-- Read: your own mail, plus shared channels the whole workspace is in.
create policy "messages readable by owner or whole team if shared"
  on public.messages for select
  using (
    workspace_id = my_workspace()
    and (
      owner_id = auth.uid()
      or source in ('slack', 'discord', 'whatsapp')
    )
  );

-- Insert: only ever as yourself, into your own workspace.
create policy "messages insert as self"
  on public.messages for insert
  with check (
    workspace_id = my_workspace()
    and owner_id = auth.uid()
  );

-- Update: triage (category, read state) on anything you can legitimately see.
-- Shared-channel messages stay team-editable, because a channel that only its
-- syncer could triage would silently stop being triaged the moment somebody
-- else pressed Sync.
create policy "messages update what you can read"
  on public.messages for update
  using (
    workspace_id = my_workspace()
    and (
      owner_id = auth.uid()
      or source in ('slack', 'discord', 'whatsapp')
    )
  );

-- Delete: your own only. Removing a shared channel message would remove it for
-- the whole team, which nobody asked for and no screen warns about.
create policy "messages delete own"
  on public.messages for delete
  using (
    workspace_id = my_workspace()
    and owner_id = auth.uid()
  );
