-- A "Follow-up" stage on the task board.
--
-- 28 Sep audit (Abder): "To do, in progress, review, done. So we can add
-- follow-up." It means the work is waiting on someone else: a reply, a file, a
-- decision. Until now that sat in In Progress, where it looked like the EA was
-- the one holding it.
--
-- In the enum it goes before 'done' ('review' was appended after 'done' in 0030,
-- so the enum order was never the board order; the board sets its own order:
-- To Do, In Progress, Follow-up, Review, Done).
-- Nothing else changes: everything that asks "is this task open?" asks
-- status <> 'done', so a follow-up task stays open everywhere (EOD drafts,
-- the Needs Follow-up box, Madeline, the client portal).
--
-- Safe to run twice. Run it on its own: Postgres won't let a new enum value be
-- used in the same transaction that adds it.

alter type task_status add value if not exists 'follow_up' before 'done';
