-- An activity signal that is not blind to the rest of the machine.
--
-- THE PROBLEM. keystrokes and mouse_events come from browser events, and a
-- browser receives events for its own document only. Someone writing in Outlook
-- for twenty minutes produces zero of both. A dashboard built on those two
-- columns alone would report a working employee as idle, and that number would
-- eventually be read out in a performance conversation.
--
-- THE SIGNAL THAT DOES SEE THE WHOLE SCREEN. Every capture is already
-- perceptually hashed to find duplicates. The distance between one capture's
-- hash and the previous one measures how much the screen changed in between,
-- and when the shared surface is a monitor, that is the WHOLE screen, including
-- every application the browser cannot see. It costs nothing extra: the hash is
-- computed anyway.
--
-- WHAT IT IS AND IS NOT. It is evidence that the screen changed, so someone was
-- doing something. It is not a measure of effort, and it says nothing about
-- what was being done: a compiling build and a playing video both change the
-- screen without a person present. It belongs beside the input counts, not
-- instead of them, and the dashboard shows both.

alter table public.activity_records
  -- 0..100. Derived from the perceptual distance between this capture and the
  -- previous one, so it is only meaningful once there is a previous one.
  add column if not exists screen_change_percent int
    check (screen_change_percent between 0 and 100),
  -- What the person actually shared. A tab share makes both the screenshot and
  -- the screen-change figure cover a fraction of the machine, and a reviewer
  -- has to be able to see that rather than infer it.
  add column if not exists capture_surface text
    check (capture_surface in ('monitor', 'window', 'browser', 'unknown'));

comment on column public.activity_records.screen_change_percent is
  'How much the screen changed since the previous capture, 0-100, from perceptual hash distance. Covers the whole machine when capture_surface is monitor. Evidence that something happened, not a measure of effort.';

/* The honest summary of a period, which is not simply the input counts.
   Returns the strongest signal available and NAMES it, so a caller can never
   present a tab-scoped number as if it covered the machine. */
create or replace function public.activity_summary(r public.activity_records)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'activity_percent', public.activity_percent(r),
    'keystrokes_per_minute', public.keystrokes_per_minute(r),
    'mouse_per_minute', public.mouse_per_minute(r),
    'screen_change_percent', r.screen_change_percent,
    'scope', case
      when r.source = 'agent' then 'whole machine'
      when r.capture_surface = 'monitor' then 'whole screen for screen change, this browser tab for input'
      else 'this browser tab only'
    end,
    'input_is_tab_scoped', r.source = 'browser'
  )
$$;
