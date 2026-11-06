-- 0101_ai_cost_plan.sql
-- Abder's "AI quick actions and cost" deck (6 Nov 2026), slides 12 to 14.
--
-- 1. Prices for every model the app now calls, so Settings, PostHog and the
--    daily budget below can show money, not only tokens. Per 1M tokens, from
--    the deck (OpenAI's public price list, Oct 2026). Admins can change them in
--    ai_rates if OpenAI's page says otherwise.
-- 2. Cached input tokens: OpenAI bills the repeated start of a prompt (the
--    same system prompt and tool list) at a lower rate. Recorded and priced
--    separately so the saving shows.
-- 3. A daily allowance per person instead of the hourly call count:
--    150 AI calls or $0.50 a day, whichever comes first.
--
-- Safe to run before or after the new edge functions: the old functions keep
-- calling check_ai_rate_limit, which still exists.

-- ---------------------------------------------------------------------------
-- 1 + 2. Rates, with a cached-input rate.
-- ---------------------------------------------------------------------------
alter table ai_rates add column if not exists cached_per_mtok numeric(10,4);
alter table ai_spend add column if not exists cached_input_tokens integer not null default 0
  check (cached_input_tokens >= 0);

insert into ai_rates (provider, model, input_per_mtok, cached_per_mtok, output_per_mtok, updated_at) values
  ('openai', 'gpt-4o',       2.50, 1.25,  10.00, now()),
  ('openai', 'gpt-4o-mini',  0.15, 0.075,  0.60, now()),
  ('openai', 'gpt-5-mini',   0.25, 0.025,  2.00, now()),
  ('openai', 'gpt-4.1-mini', 0.40, 0.10,   1.60, now()),
  ('openai', 'gpt-4.1-nano', 0.10, 0.025,  0.40, now())
on conflict (provider, model) do update set
  input_per_mtok  = coalesce(ai_rates.input_per_mtok,  excluded.input_per_mtok),
  cached_per_mtok = coalesce(ai_rates.cached_per_mtok, excluded.cached_per_mtok),
  output_per_mtok = coalesce(ai_rates.output_per_mtok, excluded.output_per_mtok),
  updated_at      = now();
-- coalesce: a rate an admin already entered is kept.

/* input_tokens is OpenAI's prompt_tokens, which INCLUDES the cached ones. The
   cached part is billed at the cached rate (or the full rate when none is set). */
create or replace function public.price_ai_spend()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rate_in     numeric(10,4);
  rate_cached numeric(10,4);
  rate_out    numeric(10,4);
  cached      integer;
begin
  if new.cost_usd is not null then
    return new;
  end if;

  select input_per_mtok, cached_per_mtok, output_per_mtok
    into rate_in, rate_cached, rate_out
    from ai_rates
   where provider = new.provider and model = new.model;

  if rate_in is null or rate_out is null then
    return new;
  end if;

  cached := least(coalesce(new.cached_input_tokens, 0), new.input_tokens);
  new.cost_usd :=
      ((new.input_tokens - cached)::numeric / 1000000) * rate_in
    + (cached::numeric / 1000000) * coalesce(rate_cached, rate_in)
    + (new.output_tokens::numeric / 1000000) * rate_out;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The daily allowance.
-- ---------------------------------------------------------------------------
/* One call per AI request (not per model call), counted in ai_usage as before,
   plus the money actually spent today from ai_spend. The day is the UTC day.
   Fails closed like check_ai_rate_limit: no user or no workspace, no AI. */
create or replace function check_ai_daily_budget(
  p_fn text,
  p_max_calls int default 150,
  p_max_usd numeric default 0.50
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $budget$
declare uid uuid; used int; spent numeric;
begin
  uid := auth.uid();
  if uid is null then return false; end if;
  if my_workspace() is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- Kept two days now (the hourly limiter kept two hours).
  delete from ai_usage where created_at < now() - interval '2 days';

  select count(*) into used from ai_usage
    where user_id = uid and created_at >= date_trunc('day', now());
  if used >= greatest(p_max_calls, 1) then return false; end if;

  select coalesce(sum(cost_usd), 0) into spent from ai_spend
    where owner_id = uid and created_at >= date_trunc('day', now());
  if spent >= p_max_usd then return false; end if;

  insert into ai_usage (user_id, fn) values (uid, p_fn);
  return true;
end $budget$;

revoke all on function check_ai_daily_budget(text, int, numeric) from public;
grant execute on function check_ai_daily_budget(text, int, numeric) to authenticated;

/* The old hourly limiter deleted anything older than 2 hours, which would wipe
   the day's count while an old function version is still deployed. Make it
   keep two days too; its own one-hour window is unchanged. */
create or replace function check_ai_rate_limit(p_fn text, p_max int default 60)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $ratelimit$
declare uid uuid; used int;
begin
  uid := auth.uid();
  if uid is null then return false; end if;
  if my_workspace() is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  delete from ai_usage where created_at < now() - interval '2 days';
  select count(*) into used from ai_usage
    where user_id = uid and created_at > now() - interval '1 hour';
  if used >= greatest(p_max, 1) then return false; end if;
  insert into ai_usage (user_id, fn) values (uid, p_fn);
  return true;
end $ratelimit$;

create index if not exists ai_usage_user_day_idx on ai_usage (user_id, created_at desc);
