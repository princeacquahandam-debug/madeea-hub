-- An owner outranks an admin, and is_admin() did not know that.
--
-- WHAT BROKE. is_admin() was written when there were exactly two roles, and it
-- asks literally `role = 'admin'`. Adding owner above admin therefore did the
-- opposite of what promoting somebody should do: the moment an account became
-- an owner it stopped satisfying is_admin(), and 21 policies across the schema
-- depend on that function.
--
-- The symptom was quiet, which is what makes it worth recording. Promoting the
-- first owner did not raise anything; an UPDATE they were no longer allowed to
-- make simply affected zero rows and returned success. A guard test read that
-- as "the operation was permitted" when in fact the row had not moved. Nothing
-- errored at any layer.
--
-- THE FIX IS RANK, NOT A LONGER LIST. Writing `role in ('owner','admin')` would
-- work today and break again the moment a role is added above owner. is_admin()
-- now means "ranks at least as high as admin", which stays true by construction.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.role_rank(public.my_role()) >= public.role_rank('admin'), false)
$$;

comment on function public.is_admin() is
  'True when the caller ranks at or above admin. Owners included: this is a rank test, not an equality test, so a role added above owner keeps working.';
