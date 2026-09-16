-- Did the three SOPs land? Read-only. Safe to run any number of times.
--
-- Expect three rows, each with 7 steps, and an ai_action on exactly one of them.

select s.title,
       jsonb_array_length(s.steps)            as steps,
       jsonb_array_length(s.success_criteria) as criteria,
       (select count(*) from jsonb_array_elements(s.steps) e
         where e ? 'ai_action')               as ai_steps,
       (select count(*) from jsonb_array_elements(s.steps) e
         where (e ->> 'required')::boolean)   as required_steps,
       s.is_active
from sops s
where s.title in ('Morning meeting brief', 'Priority alignment', 'Executive inbox summary')
order by s.title;
