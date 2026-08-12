-- 0006_slack.sql. Slack message triage source.
alter table messages add column slack_ts text;
create unique index messages_slack_uniq on messages (workspace_id, slack_ts);
