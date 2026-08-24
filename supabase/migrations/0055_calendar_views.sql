-- What a Google-shaped calendar needs that we were not storing.
--
-- TIMEZONE. Events are stored as instants, which is right, but the screen was
-- rendering them in the browser's zone while Google renders them in the
-- calendar's. A team meeting at 8pm Manila read as 5am on a laptop set to
-- Mountain time, and anything within eight hours of midnight showed on the
-- wrong DAY. The instant was never wrong; the frame of reference was missing,
-- so the calendar's own zone is now stored and shown.
--
-- RESPONSE. "Show declined events" is a filter on your own answer to the
-- invitation, which is per attendee. Without it a declined meeting is
-- indistinguishable from one you are attending, and the day looks fuller than
-- it is.
alter table public.meetings
  add column if not exists event_timezone  text,
  add column if not exists response_status text;

comment on column public.meetings.response_status is
  'This account''s own answer: accepted, declined, tentative, needsAction. Null when not an attendee (usually the organiser).';
