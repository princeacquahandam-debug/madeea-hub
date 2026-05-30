-- Seed the demo dataset for a given user, and auto-run it on signup so a new
-- account lands on the populated command center (matching the prototype).

create or replace function seed_demo_data(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_james uuid;
  c_priya uuid;
  c_david uuid;
begin
  -- skip if already seeded
  if exists (select 1 from clients where owner_id = uid) then
    return;
  end if;

  insert into clients (owner_id, name, title, company, preferred_channel, tone, tags, bio, preferences_notes)
  values
    (uid, 'James Harrington', 'CEO', 'Harrington Capital', 'Email', 'Formal',
     array['Board Prep','Investor Relations','Travel'],
     'Founding CEO of Harrington Capital, a $2.4B growth equity firm. Values precision, punctuality and brevity.',
     'Morning briefing before 8 AM. Never call without pre-scheduling. Always copy the CFO on financials. Be specific with numbers and dates.')
    returning id into c_james;

  insert into clients (owner_id, name, title, company, preferred_channel, tone, tags, bio, preferences_notes)
  values
    (uid, 'Priya Nair', 'Founder & CEO', 'NovaMed Health', 'Slack', 'Direct, collaborative',
     array['Product Roadmap','Media','Fundraising'],
     'Founder of NovaMed Health, closing a $22M Series B. Highly responsive but time-poor.',
     'Slack day-to-day; email for formal/external. Lead with the ask. Calls Tue/Thu 9–11 AM only. Vegetarian.')
    returning id into c_priya;

  insert into clients (owner_id, name, title, company, preferred_channel, tone, tags, bio, preferences_notes)
  values
    (uid, 'David Osei', 'Managing Director', 'Osei Global Ventures', 'WhatsApp', 'Concise, informal',
     array['Travel','Deal Flow','Events'],
     'MD of Osei Global Ventures ($800M AUM), based between London and Accra. Values efficiency above all.',
     'WhatsApp primary. Email for contracts only. Always business class. Rosewood/Four Seasons/St. Regis. Keep messages under 3 sentences.')
    returning id into c_david;

  insert into tasks (owner_id, client_id, title, due_label, priority, status) values
    (uid, c_david, 'Book SF flights for David', 'Tomorrow', 'normal', 'todo'),
    (uid, c_james, 'Draft investor update email', 'Friday', 'high', 'todo'),
    (uid, c_james, 'Prepare Q3 expense report', 'Next week', 'normal', 'todo'),
    (uid, c_priya, 'Write NovaMed briefing doc', 'Thursday', 'high', 'todo'),
    (uid, c_james, 'Prepare board deck slides', 'Today, 3pm', 'urgent', 'in_progress'),
    (uid, c_priya, 'Research NovaMed competitors', 'Today, EOD', 'high', 'in_progress'),
    (uid, c_james, 'Reschedule Monday call', 'Completed', 'low', 'done'),
    (uid, c_david, 'Send travel itinerary', 'Completed', 'normal', 'done');

  insert into messages (owner_id, client_id, sender_name, sender_initials, subject, preview, body, category) values
    (uid, c_james, 'James Harrington', 'JH', 'Board Meeting Agenda Request', 'Could you please send over the agenda for Thursday''s board meeting by tomorrow morning?', 'Could you please send over the agenda for Thursday''s board meeting by tomorrow morning?', 'urgent'),
    (uid, c_priya, 'Priya Nair', 'PN', 'Postponing Thursday meeting', 'I need to reschedule our Thursday check-in. Can we move it to next Monday instead?', 'I need to reschedule our Thursday check-in. Can we move it to next Monday instead?', 'reply'),
    (uid, null, 'CFO Office', 'CO', 'Q3 Expense Report Due', 'Reminder: Q3 expense reports are due by end of month.', 'Reminder: Q3 expense reports are due by end of month. Please ensure all receipts are submitted.', 'delegate'),
    (uid, c_david, 'Travel Agent', 'TA', 'SF Flight Options — David Osei', 'Here are three flight options for Mr. Osei''s San Francisco trip.', 'Here are three flight options for Mr. Osei''s San Francisco trip. Please confirm preference.', 'reply'),
    (uid, null, 'Newsletter Service', 'NS', 'Weekly industry digest — Issue #142', 'This week in executive leadership: AI adoption trends, market analysis, and more.', 'This week in executive leadership: AI adoption trends, market analysis, and more.', 'archive'),
    (uid, null, 'HR Team', 'HT', 'Team offsite planning — Q4', 'We''re planning the Q4 team offsite and need input on preferred dates and venues.', 'We''re planning the Q4 team offsite and need input on preferred dates and venues.', 'delegate');

  insert into meetings (owner_id, client_id, title, status) values
    (uid, c_james, 'Board Prep Call', 'prepared'),
    (uid, c_priya, 'Product Review', 'needs_prep'),
    (uid, c_david, 'Travel Brief', 'prepared'),
    (uid, null, 'Team Sync', 'pending');

  insert into automations (owner_id, name, description, status, total_runs) values
    (uid, 'Executive Priority Alignment Automation™', 'Every morning at 7:30 AM, analyses your calendar, emails and task list to generate a prioritised daily briefing.', 'active', 247),
    (uid, 'Meeting Preparation Automation™', 'Triggered 24 hours before every scheduled meeting. Compiles attendee profiles, agenda drafts and reminders.', 'active', 183),
    (uid, 'Executive Summary Inbox Automation™', 'Runs every 2 hours to triage email, archive newsletters, delegate routine requests and surface what needs attention.', 'paused', 312);
end $$;

-- On signup: create the profile row and seed demo data.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, initials)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Elite EA'), upper(left(coalesce(new.email, 'EA'), 2)))
  on conflict (id) do nothing;
  perform seed_demo_data(new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
