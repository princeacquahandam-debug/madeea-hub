-- 0039_quick_action_names.sql
-- Keep the workflow AI steps pointing at actions that still exist.
--
-- Run once in the Supabase SQL editor, after 0038.
--
-- The demo build renamed four Quick Actions to the names the client asked for.
-- Workflow steps store the action name as a string and pass it straight to the
-- generate function as its format, so a renamed action leaves those steps
-- calling something that is no longer in the menu. It does not error, it
-- quietly falls through to the generic prompt, which is worse: the step still
-- looks like it worked.
--
-- 0035 did the same job for the previous rename. Same shape here.
update sops set steps = (
  select jsonb_agg(
    case s ->> 'ai_action'
      when 'Meeting Prep'         then jsonb_set(s, '{ai_action}', '"Meeting Preparation"')
      when 'Write an Email'       then jsonb_set(s, '{ai_action}', '"Write Email"')
      when 'Summarize a Document' then jsonb_set(s, '{ai_action}', '"Summarize Document"')
      when 'Draft Social Posts'   then jsonb_set(s, '{ai_action}', '"Draft Social Content"')
      else s
    end
    order by ord
  )
  from jsonb_array_elements(sops.steps) with ordinality as t(s, ord)
)
where steps @> '[{"ai_action": "Meeting Prep"}]'
   or steps @> '[{"ai_action": "Write an Email"}]'
   or steps @> '[{"ai_action": "Summarize a Document"}]'
   or steps @> '[{"ai_action": "Draft Social Posts"}]';
