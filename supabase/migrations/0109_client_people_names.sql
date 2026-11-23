-- 0109_client_people_names.sql. The client's People list shows names.
--
-- Run in the Supabase SQL editor (madeea-hub project). Safe to run twice.
--
-- A name can now be given when a client adds a colleague or staff member
-- (0108 / invite-client-viewer, QA write test WA-07), and it is saved on their
-- profile. client_people (0074) never carried a name, so the People list, the
-- Staff page and the Assign menu still showed only an email address (QA write
-- re-test N-04, 23 Nov 2026).
--
-- One column, added at the end (create or replace view may only append). Every
-- existing column, and the rule that addresses are for the primary only, is
-- exactly 0074. A name is shown to everyone on the account: they are its
-- colleagues.

create or replace view public.client_people as
select
  cu.role,
  cu.created_at,
  cu.user_id = auth.uid() as is_you,
  case when public.my_client_role() = 'primary' then u.email end as email,
  nullif(btrim(p.full_name), '') as name
from public.client_users cu
join auth.users u on u.id = cu.user_id
left join public.profiles p on p.id = cu.user_id
where cu.client_id = public.my_client();

grant select on public.client_people to authenticated;
