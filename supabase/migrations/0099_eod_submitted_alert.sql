-- Each EOD report by email, for the team leads.
--
-- Asked for in the 19 Oct 2026 team meeting: Rowena and Reichelle monitor every
-- EA's EOD and want each one in their email, not only on the EOD Reports page
-- ("basta mapunta lang sa email ko"). The Team tab (21 Oct) covers the in-app
-- view; this covers the email.
--
-- Same shape as 0064: the browser names the event after a report is saved,
-- alert_routes decides where it goes, and n8n sends the email. So who receives
-- it is an n8n setting, not a deploy.
--
-- Internal audience. Off and pointing nowhere until an admin connects it in
-- Settings -> Alerts. alert_deliveries' unique (workspace_id, event, subject_id)
-- with subject "person:date" means one email per person per day.
insert into alert_routes (workspace_id, event, channel, audience, is_active)
select w.id, 'eod_submitted', 'none', 'internal', false from workspaces w
where not exists (
  select 1 from alert_routes r where r.workspace_id = w.id and r.event = 'eod_submitted'
);
