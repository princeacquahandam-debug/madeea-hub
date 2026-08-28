-- The client hears that their EA has started the day.
--
-- ── WHY THIS IS A ROUTE AND NOT A SLACK CALL ─────────────────────────────
--
-- Asked for as "notify the client in the team chat channel when their EA times
-- in". The obvious build is a call to slack-send on clock-in. It was not
-- written, for two reasons.
--
-- Slack cannot send today. lib/channels only lists gmail, outlook and teams as
-- connectable; Slack needs an app registered in the workspace and a bot token
-- before a single message leaves. A feature wired straight to it would ship
-- looking finished and do nothing.
--
-- And the app already has exactly one way out, built for this: the browser
-- names an event, alert_routes decides where it goes, and n8n does the routing
-- (0036). "Also send these to Teams instead" is then an n8n node rather than a
-- deploy here, and the destination stays out of the bundle where a webhook key
-- cannot leak.
--
-- So this is an insert, which is what 0036 said adding an event should cost:
-- "Text rather than an enum so adding an event is an insert."
--
-- ── AUDIENCE IS 'client', AND IT IS THE FIRST ONE ────────────────────────
--
-- 0036 wrote the audience column with both values and used only 'internal',
-- noting that an SLA breach tells a client we were late at the moment that is
-- least useful to hear. This one is the opposite case and the reason the column
-- exists: "your assistant has started work" is addressed to the client, is true
-- when it is sent, and carries nothing they should not see.
--
-- ── OFF, AND POINTING NOWHERE, UNTIL AN ADMIN SAYS OTHERWISE ─────────────
--
-- channel 'none' and is_active false, exactly as 0036 seeds sla_breach. Nothing
-- reaches a real client until somebody chooses a destination in Settings. That
-- matters more here than for an internal alert: the recipient is outside the
-- company, and a mistake is a message to a customer rather than a noisy row in
-- a team channel.
insert into alert_routes (workspace_id, event, channel, audience, is_active)
select w.id, 'ea_timed_in', 'none', 'client', false from workspaces w
where not exists (
  select 1 from alert_routes r where r.workspace_id = w.id and r.event = 'ea_timed_in'
);
