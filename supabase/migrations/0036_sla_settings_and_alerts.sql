-- 0036_sla_settings_and_alerts.sql
-- The response-time promise, and the seam for telling anyone about it.
--
-- Run once in the Supabase SQL editor, after 0035.
--
-- WHY THIS EXISTS. SLA thresholds lived in localStorage under
-- "madeea-sla-settings". Every person had a private definition of "late",
-- clearing your browser silently reset it, and two admins could disagree about
-- whether a client was breached while looking at the same screen. The store's
-- own comment said it should be a table. It is a promise we make to a client,
-- so it belongs in the database and not in a browser.
--
-- Per-client overrides already exist as clients.sla_ok_hours / sla_risk_hours
-- (0009). This adds the workspace defaults they fall back to.

create table if not exists sla_settings (
  -- One row per workspace. The primary key IS the workspace, so there is no
  -- way to end up with two competing configs and no "which row wins" question.
  workspace_id uuid primary key default my_workspace() references workspaces (id) on delete cascade,

  -- Working hours, not calendar hours. With a 9 hour day, 8 means "answered the
  -- same working day" and 16 means "by the end of the next one", which is what
  -- a 24h/48h calendar SLA actually intends.
  ok_hours integer not null default 8 check (ok_hours > 0),
  risk_hours integer not null default 16 check (risk_hours > 0),
  business_hours_only boolean not null default true,
  start_hour integer not null default 9 check (start_hour between 0 and 23),
  end_hour integer not null default 18 check (end_hour between 1 and 24),
  -- 0 = Sunday, matching JS getDay(), because that is what the client-side
  -- maths in lib/sla.ts already speaks.
  days integer[] not null default '{1,2,3,4,5}',

  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,

  -- A window that can never be open makes every gap zero and every client look
  -- perfect. lib/sla.ts already guards against it at runtime; this stops the
  -- bad row existing at all.
  constraint sla_window_is_open check (end_hour > start_hour),
  constraint sla_risk_after_ok check (risk_hours >= ok_hours)
);

alter table sla_settings enable row level security;

-- Everyone reads it: the thresholds drive what every page renders.
drop policy if exists "sla read" on sla_settings;
create policy "sla read" on sla_settings for select to authenticated
  using (workspace_id = my_workspace());

-- Admins alone change it. An EA editing the definition of "late" is an EA
-- editing their own performance review.
drop policy if exists "sla admin write" on sla_settings;
create policy "sla admin write" on sla_settings for all to authenticated
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

-- Give every existing workspace the defaults, so the app has a row to read on
-- day one rather than a null it has to interpret.
insert into sla_settings (workspace_id)
select w.id from workspaces w
where not exists (select 1 from sla_settings s where s.workspace_id = w.id);

-- ---------------------------------------------------------------------------
-- Where an alert goes.
--
-- One row per event type. Deliberately NOT a hardcoded webhook URL in code:
-- the destination is a setting, because the team has not settled where these
-- land and I am not picking a Slack channel on their behalf.
--
-- channel 'none' is a real, supported state and the default. Until somebody
-- configures a destination the app says "not connected" rather than implying
-- it is sending something.
-- ---------------------------------------------------------------------------
create table if not exists alert_routes (
  workspace_id uuid not null default my_workspace() references workspaces (id) on delete cascade,
  -- e.g. 'sla_breach'. Text rather than an enum so adding an event is an insert.
  event text not null,
  channel text not null default 'none' check (channel in ('none', 'n8n')),
  -- What the channel needs. For n8n, the webhook path appended to N8N_BASE_URL.
  -- Never a full URL with a secret in it: the base and the key are env vars on
  -- the server, and this is the routing part only.
  target text,
  -- Who the alert is about vs who it goes to. Internal by default: an SLA
  -- breach alert tells a client we were late, at the exact moment that is least
  -- useful to hear. Client-facing reporting is a periodic surface, not this.
  audience text not null default 'internal' check (audience in ('internal', 'client')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (workspace_id, event)
);

alter table alert_routes enable row level security;

drop policy if exists "routes read" on alert_routes;
create policy "routes read" on alert_routes for select to authenticated
  using (workspace_id = my_workspace());
drop policy if exists "routes admin write" on alert_routes;
create policy "routes admin write" on alert_routes for all to authenticated
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

insert into alert_routes (workspace_id, event, channel, audience, is_active)
select w.id, 'sla_breach', 'none', 'internal', false from workspaces w
where not exists (
  select 1 from alert_routes r where r.workspace_id = w.id and r.event = 'sla_breach'
);

-- ---------------------------------------------------------------------------
-- What actually happened when we tried to send.
--
-- Two jobs. It is the dedupe key, so one breach produces one alert however many
-- times a browser recalculates it or a retry fires. And it is the failure path:
-- a delivery that never succeeded is a row saying so, with the error, rather
-- than a message nobody notices is missing.
--
-- Append-only by policy shape: select and insert exist, update is limited to
-- the status fields the sender needs to close out an attempt. No delete, so the
-- record of a missed alert cannot be tidied away.
-- ---------------------------------------------------------------------------
create table if not exists alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references workspaces (id) on delete cascade,
  event text not null,
  -- What the alert is about. For sla_breach this is the message id, and it is
  -- what makes the unique index below a dedupe rather than a rate limit.
  subject_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

alter table alert_deliveries enable row level security;

-- One alert per event per subject, forever. A breach that was already announced
-- is not news the second time somebody opens the dashboard.
create unique index if not exists alert_deliveries_once
  on alert_deliveries (workspace_id, event, subject_id);

create index if not exists alert_deliveries_pending
  on alert_deliveries (workspace_id, status) where status in ('pending', 'failed');

drop policy if exists "deliveries read" on alert_deliveries;
create policy "deliveries read" on alert_deliveries for select to authenticated
  using (workspace_id = my_workspace());

-- No insert or update policy for end users. Rows arrive through the edge
-- function on the service role, which is the only thing that knows whether a
-- send actually happened. A client that could write its own delivery record
-- could mark an alert sent that never left the building.
