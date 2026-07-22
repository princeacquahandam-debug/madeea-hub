-- 0018_goals.sql — let a memory entry be a stated GOAL.
--
-- The Focus Helper's goal-drift view needs somewhere to keep "what the boss said
-- matters this quarter". That is a durable, human-written fact about the desk,
-- which is exactly what the memories table already is — so this adds a kind rather
-- than a second store. One place to look, one set of RLS policies.
--
-- Additive and idempotent: dropping the constraint by name and re-adding it widens
-- the allowed set without touching a single row. Nothing that is valid today
-- becomes invalid.

alter table memories drop constraint if exists memories_kind_check;

alter table memories
  add constraint memories_kind_check
  check (kind in ('preference', 'fact', 'commitment', 'context', 'goal'));
