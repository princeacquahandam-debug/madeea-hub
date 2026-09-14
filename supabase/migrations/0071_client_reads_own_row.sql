-- A client may read the one row that is them.
--
-- 0065 gave a client their two channels and nothing else, which is right: every
-- other table is gated on my_workspace(), and a client's is NULL by design.
--
-- It left one gap that only shows up once a portal exists. `clients` carries
-- the client's own NAME, and it holds the 0012 workspace policy
-- (`for all using (workspace_id = my_workspace())`), so a client could read
-- their private conversation with their assistant while being unable to learn
-- whose portal they were looking at.
--
-- Narrow deliberately: SELECT only, one row, matched on my_client(), which is
-- security definer and returns NULL for staff. Permissive policies OR together,
-- so this widens what a client can read without altering staff access, and
-- grants no write of any kind. A client still cannot edit their own record —
-- what the agency holds about a client is the agency's record.

drop policy if exists "clients read own row" on clients;
create policy "clients read own row" on clients for select to authenticated
  using (id = public.my_client());
