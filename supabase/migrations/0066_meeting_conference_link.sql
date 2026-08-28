-- Where the meeting actually happens.
--
-- `meetings` already mirrors a Google event: title, times, location, html_link,
-- attendees. html_link is the page ABOUT the event on calendar.google.com, not
-- the room. Anybody joining a call needs the second one, and it had nowhere to
-- live, so a prep packet could name a meeting it could not get you into.
--
-- Nullable, and stays null for everything that has no call attached: an all-day
-- block, a room booking, a reminder. An empty string would be indistinguishable
-- from "we asked Google and it declined", which is a real case — a Workspace
-- policy can forbid Meet creation, and the event is still made without one.
alter table meetings
  add column if not exists hangout_link text;

comment on column meetings.hangout_link is
  'Google Meet URL for this event, or null when it has no call attached. Distinct from html_link, which is the event page rather than the room.';
