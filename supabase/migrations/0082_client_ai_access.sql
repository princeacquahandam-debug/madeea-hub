-- Let client accounts use Madeline in the client portal.
--
-- check_ai_rate_limit (0020) refused anyone without a workspace membership:
-- "No workspace, no AI budget." Client logins hold no membership by design
-- (0065), so Madeline in the portal answered every client with "Rate limit
-- reached". A client account (my_client() set) now counts too. Everything else
-- is unchanged: the same per-person hourly cap (the portal asks for a lower
-- one), the same lock, the same rolling counter.
--
-- What a client's Madeline can READ is not decided here. It reads only the
-- client-safe views (client_tasks, client_calendar, client_days, client_notes,
-- client_overview), each already limited to that client. Safe to run twice.

create or replace function check_ai_rate_limit(p_fn text, p_max int default 60)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $ratelimit$
declare uid uuid; used int;
begin
  uid := auth.uid();
  if uid is null then return false; end if;

  -- No workspace and no client account, no AI budget.
  if my_workspace() is null and my_client() is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  delete from ai_usage where created_at < now() - interval '2 hours';

  select count(*) into used from ai_usage
    where user_id = uid and created_at > now() - interval '1 hour';
  if used >= greatest(p_max, 1) then return false; end if;

  insert into ai_usage (user_id, fn) values (uid, p_fn);
  return true;
end $ratelimit$;
