-- What the AI features actually cost, per account.
--
-- ── WHY THIS IS NOT CALLED ai_usage ──────────────────────────────────────
-- That name is taken, by 0016, for something entirely different: a rolling
-- call counter behind check_ai_rate_limit, whose rows are DELETED after two
-- hours. Reusing it would have put month-long spend in a table that empties
-- itself twice a shift.
--
-- Worth recording how that was found, because it was nearly missed: the first
-- draft said "create table if not exists ai_usage", which against an
-- existing table does nothing and says nothing. The failure surfaced one
-- statement later as "column workspace_id does not exist" on the index — a
-- confusing error a long way from its cause.
--
-- ── WHY THIS IS TOKENS FIRST AND MONEY SECOND ────────────────────────────
--
-- Asked for as "usage and remaining balance". Two honest limits shaped it:
--
-- Neither provider exposes a live account balance to query. OpenAI withdrew
-- its credit-grants endpoint and Anthropic has never had a public one, so
-- "remaining" cannot mean "what is left on the card". It has to mean "what is
-- left of an allowance we set", and this schema says so rather than implying
-- a number it cannot obtain.
--
-- And a hardcoded price list goes stale silently. A dashboard confidently
-- reporting $4.12 at last year's rates is worse than one reporting tokens and
-- admitting it does not know the price. So ai_rates ships EMPTY of numbers:
-- the models in use are listed, their rates are null, and cost stays null
-- until an admin fills them in. A null reads as "not priced". An invented
-- number reads as fact.
--
-- Tokens are the measure that is always true, come from the provider's own
-- response, and never go out of date.

-- ---------------------------------------------------------------------------
-- 1. One row per model call.
-- ---------------------------------------------------------------------------
create table if not exists ai_spend (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Which feature spent it: 'generate', 'assistant-chat', 'meeting-intelligence',
  -- 'run-automation', 'voice-parse'. Text rather than an enum so a new feature
  -- costs an insert, the same reasoning as alert_routes in 0036.
  feature text not null,
  provider text not null check (provider in ('openai', 'anthropic')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  /* Priced at write time from the rates below, so a later rate change does not
     silently rewrite history. Null when the model has no rate configured, which
     is the shipped state and is displayed as "not priced" rather than as zero. */
  cost_usd numeric(12,6),
  created_at timestamptz not null default now()
);

create index if not exists ai_spend_owner_idx on ai_spend (workspace_id, owner_id, created_at desc);
create index if not exists ai_spend_period_idx on ai_spend (workspace_id, created_at desc);

alter table ai_spend enable row level security;

/* Your own spend, always. The whole workspace's, if you are an admin — this is
   a billing surface, and somebody has to be able to see where the money went. */
drop policy if exists "ai usage read" on ai_spend;
create policy "ai usage read" on ai_spend for select to authenticated
  using (workspace_id = my_workspace() and (owner_id = auth.uid() or is_admin()));

/* Written by the edge function that made the call, as the caller. Pinned to
   auth.uid() so one account cannot log spend against another. */
drop policy if exists "ai usage insert as self" on ai_spend;
create policy "ai usage insert as self" on ai_spend for insert to authenticated
  with check (workspace_id = my_workspace() and owner_id = auth.uid());

/* No update, no delete, so neither exists. A spend record that can be edited
   after the fact is not a record of spend. */

-- ---------------------------------------------------------------------------
-- 2. What an account is allowed per month.
-- ---------------------------------------------------------------------------
create table if not exists ai_allowances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references workspaces (id) on delete cascade,
  -- Null is the workspace default; a row with an owner overrides it for that
  -- person. Two partial indexes rather than one key, because a unique index
  -- treats every NULL as distinct and would let a workspace collect any number
  -- of "defaults".
  owner_id uuid references auth.users (id) on delete cascade,
  monthly_tokens bigint not null default 2000000 check (monthly_tokens >= 0),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_allowance_default_idx
  on ai_allowances (workspace_id) where owner_id is null;
create unique index if not exists ai_allowance_person_idx
  on ai_allowances (workspace_id, owner_id) where owner_id is not null;

alter table ai_allowances enable row level security;

drop policy if exists "allowances read" on ai_allowances;
create policy "allowances read" on ai_allowances for select to authenticated
  using (workspace_id = my_workspace());

drop policy if exists "allowances admin write" on ai_allowances;
create policy "allowances admin write" on ai_allowances for all to authenticated
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

-- Every workspace starts with a default so the dashboard has a denominator.
insert into ai_allowances (workspace_id, owner_id, monthly_tokens)
select w.id, null, 2000000 from workspaces w
where not exists (
  select 1 from ai_allowances a where a.workspace_id = w.id and a.owner_id is null
);

-- ---------------------------------------------------------------------------
-- 3. Prices, deliberately unset.
-- ---------------------------------------------------------------------------
create table if not exists ai_rates (
  provider text not null check (provider in ('openai', 'anthropic')),
  model text not null,
  -- Null until somebody enters the rate they are actually billed. See the
  -- header: a stale price presented as money is worse than no price at all.
  input_per_mtok numeric(10,4),
  output_per_mtok numeric(10,4),
  updated_at timestamptz not null default now(),
  primary key (provider, model)
);

alter table ai_rates enable row level security;

drop policy if exists "rates read" on ai_rates;
create policy "rates read" on ai_rates for select to authenticated using (true);

drop policy if exists "rates admin write" on ai_rates;
create policy "rates admin write" on ai_rates for all to authenticated
  using (is_admin()) with check (is_admin());

-- The models this app actually calls today, listed so an admin can see what
-- needs pricing rather than having to go and read five edge functions.
insert into ai_rates (provider, model) values
  ('openai',    'gpt-4o'),
  ('openai',    'gpt-4o-mini'),
  ('anthropic', 'claude-opus-4-8')
on conflict (provider, model) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The dashboard's numbers, as one question.
-- ---------------------------------------------------------------------------
/* security_invoker, so it shows exactly what the caller may already read: an
   EA sees their own line, an admin sees everybody's. The period is the calendar
   month, which is what an allowance called "monthly" has to mean. */
create or replace view ai_spend_current_month
with (security_invoker = true) as
  select
    u.workspace_id,
    u.owner_id,
    count(*)                                         as calls,
    coalesce(sum(u.input_tokens), 0)                 as input_tokens,
    coalesce(sum(u.output_tokens), 0)                as output_tokens,
    coalesce(sum(u.input_tokens + u.output_tokens), 0) as total_tokens,
    -- Null when nothing is priced, rather than 0, which would read as free.
    sum(u.cost_usd)                                  as cost_usd
  from ai_spend u
  where u.created_at >= date_trunc('month', now())
  group by u.workspace_id, u.owner_id;

comment on view ai_spend_current_month is
  'Per-account AI spend for the calendar month so far. Tokens are exact; cost is null unless the model has a rate in ai_rates.';

-- ---------------------------------------------------------------------------
-- 5. Pricing happens here, not in five edge functions.
-- ---------------------------------------------------------------------------
/* The functions report tokens, which is all they reliably know. Cost is filled
   in on the way into the table, from whatever rate is configured at that
   moment. One place to change, one place to be wrong, and no arithmetic
   duplicated across five standalone Deno files that would drift apart.

   An unpriced model leaves cost null and the row is still recorded. Losing the
   token count because nobody entered a price would be the wrong trade. */
create or replace function public.price_ai_spend()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rate_in  numeric(10,4);
  rate_out numeric(10,4);
begin
  if new.cost_usd is not null then
    return new;
  end if;

  select input_per_mtok, output_per_mtok
    into rate_in, rate_out
    from ai_rates
   where provider = new.provider and model = new.model;

  if rate_in is null or rate_out is null then
    return new;
  end if;

  new.cost_usd :=
      (new.input_tokens::numeric  / 1000000) * rate_in
    + (new.output_tokens::numeric / 1000000) * rate_out;

  return new;
end $$;

drop trigger if exists ai_spend_priced on ai_spend;
create trigger ai_spend_priced
  before insert on ai_spend
  for each row execute function public.price_ai_spend();

-- ---------------------------------------------------------------------------
-- 6. A workspace made tomorrow gets an allowance too.
-- ---------------------------------------------------------------------------
/* The seed above only reaches workspaces that existed when this migration ran.
   Without this, a workspace created afterwards has no allowance row, and the
   dashboard has no denominator: "0 of 0" with nothing to say why.

   Caught by check:access, which creates its workspace after the migrations and
   so was the first caller to hit the gap. Same shape as 0065's conversation
   seeding, for the same reason. */
create or replace function public.seed_ai_allowance() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into ai_allowances (workspace_id, owner_id, monthly_tokens)
  values (new.id, null, 2000000)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists workspaces_seed_ai_allowance on workspaces;
create trigger workspaces_seed_ai_allowance
  after insert on workspaces
  for each row execute function public.seed_ai_allowance();
