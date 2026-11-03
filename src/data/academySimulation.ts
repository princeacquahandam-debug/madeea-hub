/**
 * The materials for the Made Ready final client simulation (Module 10): the
 * 90-minute capstone from the course outline. "You are supporting a CEO. During
 * the exercise 18 emails arrive, a meeting conflict, an urgent travel request,
 * meeting minutes needed, a client presentation, a research request, a calendar
 * conflict, and the executive asks for a briefing."
 *
 * Everything here is fictional. The one research task is about a real industry
 * topic so it can be done with real tools; everything about the fictional
 * companies is supplied in the files, so nobody can "research" an invented firm
 * and get invented answers back.
 *
 * Emails arrive while the clock runs (`at` = minutes after Start), so the
 * learner has to re-prioritise as new ones land, which is the point of the
 * exercise. The marking guide is NOT here: it lives in academy_trainer_notes,
 * which only admins can read (0096), because this file ships to every browser.
 */

export const SIMULATION_MINUTES = 90;

/** Which lesson gets the pack. Matched by title so it works for every workspace's copy. */
export const isSimulationLesson = (title: string) => title.startsWith("Final client simulation");

export interface SimEmail {
  id: number;
  at: number;
  from: string;
  subject: string;
  body: string;
}

export interface SimEvent {
  day: string;
  time: string;
  title: string;
  note?: string;
}

export const SIM_BRIEF = {
  executive: "Daniel Reyes, CEO of Northbeam Logistics (freight and warehousing, 400 staff). Based in New York (Eastern Time).",
  today: "It's Tuesday, 11:00 AM in New York. You have 90 minutes before Daniel's afternoon starts to get on top of his day.",
  preferences: [
    "Short messages. Lead with what he needs to decide.",
    "No calls before 8:30 AM or after 6:00 PM unless he says so.",
    "Flights: aisle seat, economy plus, up to $600. Hotels: up to $300 a night, walking distance to the meeting.",
    "Internal meetings can be moved without asking him. External meetings: check with him first unless the other side asks to move.",
    "You can approve spending up to $500 within the travel policy. Anything else needs his OK.",
  ],
  people: [
    "Priya Nair: CFO",
    "Marcus Bell: Head of Operations",
    "Sam Ortiz: Head of Sales (Daniel's direct report)",
    "Elena Varga: board member",
    "Halvorsen Capital: investor; Daniel has a call with them today",
    "Meridian Foods: a prospective client; Daniel is pitching them in Chicago on Thursday",
    "Lakeside Retail: an existing client",
  ],
  deliver: [
    "Professional email replies (or drafts) for every email that needs one, and what you did with the rest",
    "Meeting notes from the ops meeting transcript, with decisions and action items",
    "An executive briefing for the Halvorsen Capital call",
    "A short client presentation for Meridian Foods",
    "Your calendar decisions, with reasons",
    "Your task priorities, in order, with reasons",
  ],
};

export const SIM_CALENDAR: SimEvent[] = [
  { day: "Tuesday", time: "9:00 – 9:30 AM", title: "Leadership standup", note: "Done" },
  { day: "Tuesday", time: "10:00 – 10:45 AM", title: "Ops weekly (Marcus, Priya, warehouse leads)", note: "Done. Transcript in Files." },
  { day: "Tuesday", time: "12:00 – 1:00 PM", title: "Lunch with Ana", note: "Personal" },
  { day: "Tuesday", time: "2:00 – 2:30 PM", title: "FleetParts vendor call", note: "External" },
  { day: "Tuesday", time: "3:00 – 3:45 PM", title: "Investor call: Halvorsen Capital", note: "External, video" },
  { day: "Tuesday", time: "4:30 – 5:00 PM", title: "1:1 with Sam" },
  { day: "Wednesday", time: "10:00 – 11:30 AM", title: "Board prep with Priya" },
  { day: "Wednesday", time: "2:00 – 3:00 PM", title: "All-hands" },
  { day: "Thursday", time: "9:00 – 11:00 AM", title: "Meridian Foods pitch", note: "In person, Chicago (Meridian HQ, 200 W Madison St)" },
  { day: "Friday", time: "All day", title: "Free" },
];

export const SIM_EMAILS: SimEmail[] = [
  { id: 1, at: 0, from: "Daniel Reyes", subject: "Today",
    body: "Morning. Busy one. I need a briefing for the Halvorsen call at 3 – one page, what they'll ask and what I should say. Can I have it by 1:30? Notes from our last call are in the shared folder. Thanks, D" },
  { id: 2, at: 0, from: "Priya Nair (CFO)", subject: "Meridian Foods deck",
    body: "Hi, Daniel needs a short deck for Thursday's Meridian pitch – 5 or 6 slides max. My outline is in the folder. End of day today is fine so he can read it on the plane. Priya" },
  { id: 3, at: 2, from: "Marketing team (calendar)", subject: "Updated invitation: Marketing sync, Tue 2:00 – 2:45 PM",
    body: "The Marketing sync has moved to Tuesday 2:00 – 2:45 PM. Daniel is a required attendee. (Sent by Jo on behalf of the marketing team.)" },
  { id: 4, at: 5, from: "Logistics Weekly", subject: "This week in freight: 10 stories you missed",
    body: "Port volumes, fuel prices, warehouse automation and more. Read online. Unsubscribe." },
  { id: 5, at: 6, from: "Mia Chen (Halvorsen Capital)", subject: "Today's 3pm – can we move?",
    body: "Hi, apologies for the late notice. One of our partners is stuck in another meeting. Could we move today's call to 3:30 – 4:15, or tomorrow at 10:00? Either works for us. Best, Mia (assistant to Jonas Halvorsen)" },
  { id: 6, at: 8, from: "Daniel Reyes", subject: "URGENT: Chicago Thursday",
    body: "The Meridian meeting is in person – 9am Thursday at their HQ in Chicago. Get me there Wednesday evening, after the all-hands, and back Thursday afternoon. Hotel close to them. Please sort today, flights are filling up." },
  { id: 7, at: 10, from: "Marcus Bell (Ops)", subject: "Minutes from this morning?",
    body: "Hey, could you send minutes from this morning's ops weekly to everyone who was there? Transcript is in the folder. Need them today so the team can get moving. Thanks, Marcus" },
  { id: 8, at: 12, from: "accounts@fleetparts.example", subject: "Reminder: invoice FP-2291 overdue",
    body: "This is a reminder that invoice FP-2291 ($4,180.00) was due on the 1st. Please arrange payment or contact us." },
  { id: 9, at: 14, from: "Bright Smile Dental", subject: "Appointment confirmed – Friday 8:00 AM",
    body: "Hi Daniel, this confirms your check-up on Friday at 8:00 AM at our Midtown office. Reply C to confirm." },
  { id: 10, at: 16, from: "Tom Harlow (recruiter)", subject: "Quick question about your logistics team",
    body: "Hi Daniel, I place senior logistics leaders and thought you might be hiring. Do you have 20 minutes this week?" },
  { id: 11, at: 18, from: "Elena Varga (board)", subject: "Q3 numbers before Friday?",
    body: "Daniel – could you send me the Q3 numbers before Friday's board call? I'd like to read them over the weekend. Thanks, Elena" },
  { id: 12, at: 20, from: "Daniel Reyes", subject: "Research for Thursday",
    body: "Before Thursday I want to understand the big trends in cold-chain (refrigerated) logistics for food companies this year. One page, with sources. Doesn't need to be today – before I fly Wednesday." },
  { id: 13, at: 25, from: "Rachel Kim (Lakeside Retail)", subject: "Shipment delayed AGAIN",
    body: "Daniel, this is the second time this month. Our order LR-5520 was due yesterday and nobody has told us anything. We have stores waiting. I need an answer today on when it will arrive, or we need to talk about our contract. Rachel Kim, Head of Supply Chain" },
  { id: 14, at: 30, from: "Daniel Reyes <daniel.reyes.ceo@gmail.example>", subject: "Quick favour – confidential",
    body: "Are you at your desk? I need you to buy 5 x $200 gift cards for a client thank-you, it's urgent and confidential. Don't call, I'm in a meeting. Send me the codes by email. D" },
  { id: 15, at: 35, from: "Lena Park (Sales)", subject: "15 mins with Daniel this week?",
    body: "Hi! Could I get 15 minutes with Daniel this week to walk him through the Meridian pricing before Thursday? Any time works. Lena" },
  { id: 16, at: 40, from: "FreightTech Summit", subject: "Invitation to speak – March 2027",
    body: "We'd be delighted to have Daniel speak on a panel about warehouse automation at FreightTech Summit, 10–12 March 2027, Austin. Please let us know by the end of next week." },
  { id: 17, at: 45, from: "Daniel Reyes", subject: "Today",
    body: "Can you push my 4:30 with Sam? I want time after the investor call to prep for Thursday. Tomorrow is fine for Sam." },
  { id: 18, at: 55, from: "Priya Nair (CFO)", subject: "RE: Meridian Foods deck",
    body: "Change of plan – Daniel wants to review the deck with me at 4 today, so I need your draft by 3:30 please, not end of day. Sorry! P" },
];

export interface SimFile { name: string; body: string }

export const SIM_FILES: SimFile[] = [
  { name: "Ops weekly – transcript (Tuesday 10:00)", body:
`Marcus: Okay, let's start. Main thing is the Newark warehouse. We're at 94% capacity and it's going to hit 100 before the holiday peak.
Priya: We approved budget for the overflow site in Secaucus. Can we sign the lease this month?
Marcus: Yes, I'll have the lease to legal by Friday.
Priya: Good. Decision then: we go ahead with Secaucus.
Marcus: Second, Lakeside Retail. Their LR-5520 order slipped because a truck broke down. We need to tell them.
Dana (warehouse): The replacement truck can load tomorrow morning, so delivery Thursday.
Marcus: Someone needs to call Rachel at Lakeside today. Not sure who – sales or me.
Priya: Third thing: overtime is 18% over budget this quarter.
Marcus: I'll bring a plan to reduce overtime to next week's meeting.
Dana: We also need two more forklift drivers for the peak.
Marcus: Agreed, let's hire two seasonal drivers. HR should post the jobs.
Priya: When by?
Marcus: As soon as possible. Okay, that's it. Thanks everyone.
Attendees: Marcus Bell, Priya Nair, Dana Wu, Luis Ortega` },
  { name: "Halvorsen Capital – notes from the last call (August)", body:
`- Halvorsen invested in Northbeam's Series B (2024). Partner on the account: Jonas Halvorsen.
- Last call they asked about: margin on the warehousing business, customer concentration (top 3 clients = 41% of revenue), and the plan for the holiday peak.
- Daniel promised to come back with: an update on the overflow warehouse, and progress on two new enterprise clients.
- Figures shared last time: revenue up 22% year on year; warehousing gross margin 18%.
- Jonas likes short answers and asks about risks directly.
- Since then: Newark warehouse is near capacity; the Secaucus overflow site was approved this morning; Meridian Foods pitch is on Thursday; Lakeside Retail has had two late deliveries this month.` },
  { name: "Meridian Foods – deck outline from Priya", body:
`1. Who we are: Northbeam Logistics, 400 people, freight + warehousing, New York / New Jersey.
2. What Meridian needs: reliable refrigerated (cold-chain) delivery to 120 grocery stores in the Northeast.
3. How we'd do it: dedicated refrigerated fleet, temperature tracking on every load, the new Secaucus site for overflow.
4. Why us: 98.5% on-time delivery last year (but be careful – check with Marcus, this month is lower), 24/7 account team.
5. Next steps: 60-day pilot on 20 stores, then full rollout.
(Pricing comes from Sales – Lena has it. Don't put numbers in the deck without her.)` },
  { name: "Meridian Foods – CRM notes", body:
`Meridian Foods: regional grocery wholesaler, HQ Chicago, 120 store customers in the Northeast.
Contact: Andrea Lopez, VP Supply Chain. Met Daniel at a conference in September.
Pain points: late deliveries from their current carrier, poor temperature tracking.
Decision by: end of the quarter.` },
];
