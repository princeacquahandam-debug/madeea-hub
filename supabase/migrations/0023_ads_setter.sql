-- 0023_ads_setter.sql — Ads Setter: launch the campaign, then set the leads.
--
-- Two tables for one loop. `ad_campaigns` holds what the ad promised; `ad_leads`
-- holds the people who answered it. The link between them is load-bearing: a
-- setter that doesn't know which ad a lead clicked opens every conversation like
-- a stranger, which is exactly why paid leads go cold.
--
-- Workspace-scoped and shared, consistent with 0012 — every EA sees the whole
-- pipeline, because a lead nobody else can pick up is a lead that goes cold when
-- one person is off.

-- ---------- campaigns ----------
create table if not exists ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid not null default my_workspace() references workspaces (id) on delete cascade,
  name text not null,
  platform text not null default 'meta',
  objective text,
  daily_budget text,
  -- Model output, stored as given. These are drafts a human pastes into an ad
  -- platform, not a schema anything queries, so columns would buy nothing and
  -- cost a migration every time the shape changes.
  targeting jsonb not null default '{}'::jsonb,
  creatives jsonb not null default '[]'::jsonb,
  offer jsonb not null default '{}'::jsonb,
  utm text,
  qualifying_questions text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table ad_campaigns drop constraint if exists ad_campaigns_platform_check;
alter table ad_campaigns add constraint ad_campaigns_platform_check
  check (platform in ('meta', 'google', 'linkedin', 'tiktok'));

create index if not exists ad_campaigns_ws_idx on ad_campaigns (workspace_id, created_at desc);

-- ---------- leads ----------
create table if not exists ad_leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid not null default my_workspace() references workspaces (id) on delete cascade,
  campaign_id uuid references ad_campaigns (id) on delete set null,
  name text not null,
  email text,
  phone text,
  source text not null default 'manual',       -- manual | csv
  stage text not null default 'new',
  score int,
  reason text,
  note text,                                   -- whatever the ad form captured
  thread jsonb not null default '[]'::jsonb,   -- [{role:'lead'|'setter', text, ts}]
  booked_at timestamptz,
  disqualified_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ad_leads drop constraint if exists ad_leads_stage_check;
alter table ad_leads add constraint ad_leads_stage_check
  check (stage in ('new', 'qualifying', 'booked', 'disqualified'));

alter table ad_leads drop constraint if exists ad_leads_score_check;
alter table ad_leads add constraint ad_leads_score_check
  check (score is null or (score >= 0 and score <= 100));

-- Dedupe key, derived rather than passed in: re-pasting the same CSV export is
-- the normal way to use this, and it must not fork one person into two rows with
-- two half-conversations. Email wins, then phone, then the name.
alter table ad_leads drop column if exists dedupe_key;
alter table ad_leads add column dedupe_key text
  generated always as (lower(coalesce(nullif(trim(email), ''), nullif(trim(phone), ''), name))) stored;

create unique index if not exists ad_leads_dedupe_uniq on ad_leads (workspace_id, dedupe_key);
create index if not exists ad_leads_stage_idx on ad_leads (workspace_id, stage, created_at desc);

-- ---------- RLS: workspace-shared, same as every other table ----------
alter table ad_campaigns enable row level security;
alter table ad_leads enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['ad_campaigns', 'ad_leads'] loop
    execute format('drop policy if exists "ws shared" on %I', t);
    execute format(
      'create policy "ws shared" on %I for all '
      'using (workspace_id = my_workspace()) '
      'with check (workspace_id = my_workspace())', t);
  end loop;
end $rls$;

-- ---------- inherit the 0020 / 0013 guarantees ----------
-- Attribution is immutable (0020 E) and "last touched" is real (0013). Both are
-- attached here rather than left out, because a table added after those
-- migrations ran gets neither by default — the silent gap 0020 was written to close.
do $trg$
begin
  if exists (select 1 from pg_proc where proname = 'force_owner_id') then
    execute 'drop trigger if exists ad_campaigns_force_owner on public.ad_campaigns';
    execute 'create trigger ad_campaigns_force_owner before insert or update on public.ad_campaigns
               for each row execute function force_owner_id()';
    execute 'drop trigger if exists ad_leads_force_owner on public.ad_leads';
    execute 'create trigger ad_leads_force_owner before insert or update on public.ad_leads
               for each row execute function force_owner_id()';
  end if;

  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    execute 'drop trigger if exists ad_leads_touch_updated_at on public.ad_leads';
    execute 'create trigger ad_leads_touch_updated_at before update on public.ad_leads
               for each row execute function touch_updated_at()';
  end if;
end $trg$;
