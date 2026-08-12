/**
 * The Made Ready outline, for demo mode.
 *
 * Mirrors the seed block at the bottom of migration 0034. It is duplicated
 * because one copy is SQL and one is TypeScript, and demo mode has no database
 * to read the other from. If you change the curriculum, change both.
 *
 * ANSWER KEY WARNING. In live mode the key sits in a table PostgREST cannot
 * read and grading happens in Postgres, so the pass/fail gate is real. Here the
 * key is in the bundle, because there is no server to hide it behind. Demo mode
 * is for reviewing the app, not for certifying anybody, and the UI says so.
 */
import type { AcademyLesson, AcademyModule, AcademyQuestion } from "@/types/db";

export const MODULES: AcademyModule[] = [
  {
    id: "am-1", day: 1, title: "Foundations", position: 1, pass_pct: 80, is_published: true,
    summary: "How the Command Center works and what good EA output looks like here. Reichelle: Day 1 is foundations.",
  },
  {
    id: "am-2", day: 2, title: "The AI toolkit", position: 2, pass_pct: 80, is_published: true,
    summary: "AI tools beyond ChatGPT, Claude and Gemini, and what each one is actually for. Draft arrangement, pending Reichelle.",
  },
  {
    id: "am-3", day: 3, title: "Simulation and practice", position: 3, pass_pct: 80, is_published: true,
    summary: "Run a real day end to end, then navigate the app under time pressure. Draft arrangement, pending Reichelle.",
  },
];

const L = (
  id: string, module_id: string, title: string, kind: AcademyLesson["kind"],
  minutes: number, position: number, body: string,
): AcademyLesson => ({ id, module_id, title, kind, minutes, position, body, video_url: null });

export const LESSONS: AcademyLesson[] = [
  L("al-1", "am-1", "Welcome to Made Ready", "video", 10, 1,
    "Why this course exists: you finish it before your first day with a client, so day one is not your training day."),
  L("al-2", "am-1", "The Command Center in ten minutes", "video", 15, 2,
    "Dashboard, Tasks, Communication, EOD. Where the day starts and where it ends."),
  L("al-3", "am-1", "What good output looks like", "reading", 20, 3,
    "Every client-facing piece of work follows an SOP. SOPs are what keep quality standard across EAs (Rowena 54:55)."),
  L("al-4", "am-1", "Your first task, start to finish", "simulation", 25, 4,
    "Open Tasks, pick anything in To Do, move it through In Progress and Review, and leave a comment explaining what you did."),

  L("al-5", "am-2", "Beyond the big three", "video", 20, 1,
    "Most EAs only use ChatGPT, Claude and Gemini. That is the gap this closes (Reichelle 53:00)."),
  L("al-6", "am-2", "What each tool is for", "reading", 30, 2,
    "Tool by tool: what it does well, what it does badly, and the EA task it belongs to. Content pending from FJ."),
  L("al-7", "am-2", "Choosing the right tool", "reading", 20, 3,
    "The assessment checks this: not whether you can name the tools, but whether you pick the right one for the job in front of you."),

  L("al-8", "am-3", "A full day, simulated", "simulation", 45, 1,
    "Morning brief through to EOD report, on a practice client, with the clock running."),
  L("al-9", "am-3", "Navigation under pressure", "simulation", 20, 2,
    "Find things fast. Command palette, search, filters."),
  L("al-10", "am-3", "Handover and escalation", "reading", 20, 3,
    "When to flag a blocker rather than push through it, and how to write it so somebody can act on it."),
];

type Seeded = AcademyQuestion & { answer: number };

const QUESTIONS_WITH_KEY: Seeded[] = [
  {
    id: "aq-1", module_id: "am-1", position: 1, answer: 1,
    prompt: "You finish a client task but you are not certain it is right. What happens next?",
    choices: ["Move it straight to Done", "Move it to Review so an admin approves it", "Leave it in progress and mention it tomorrow", "Delete it and start again"],
    explanation: "Review exists so uncertain work gets a second pair of eyes before the client sees it. Tasks marked as needing approval cannot reach Done without one.",
  },
  {
    id: "aq-2", module_id: "am-1", position: 2, answer: 1,
    prompt: "What is an EOD report for?",
    choices: ["Proving you were online", "Showing the client what moved today and what is blocked", "Replacing the task board", "Logging your hours"],
    explanation: "The EOD is the client-facing record of progress and blockers. Attendance and hours are tracked separately.",
  },
  {
    id: "aq-3", module_id: "am-1", position: 3, answer: 2,
    prompt: "A client asks you to do something no SOP covers. What is the right move?",
    choices: ["Improvise and keep it to yourself", "Refuse until an SOP exists", "Do it, then write the SOP so the next person does it the same way", "Send it back to the client"],
    explanation: "SOPs are how output stays consistent across EAs (Rowena 54:55). New work becomes a new SOP.",
  },
  {
    id: "aq-4", module_id: "am-1", position: 4, answer: 1,
    prompt: "Where do client logins belong?",
    choices: ["A shared spreadsheet", "The Password Manager, encrypted", "A pinned chat message", "Your notes app"],
    explanation: "Rowena 1:02:07. Credentials go in the vault, encrypted in the browser before they are stored. Better still, ask for delegated access instead of a password.",
  },
  {
    id: "aq-5", module_id: "am-1", position: 5, answer: 0,
    prompt: "A task recurs every Monday whether or not last Monday finished. What creates it?",
    choices: ["A routine", "Marking the previous one done", "The client", "Nothing, you create it by hand"],
    explanation: "Routines are calendar driven. Task recurrence is completion driven. Weekly reports are the first kind.",
  },

  {
    id: "aq-6", module_id: "am-2", position: 1, answer: 1,
    prompt: "An executive wants a 40 page contract summarised with the risky clauses called out. Which tool fits?",
    choices: ["An image generator", "A long-context assistant that can read the whole document", "A scheduling tool", "A transcription tool"],
    explanation: "Match the tool to the shape of the job. Long document in, structured summary out.",
  },
  {
    id: "aq-7", module_id: "am-2", position: 2, answer: 1,
    prompt: "You need the decisions and owners out of a recorded call. Which tool fits?",
    choices: ["A spreadsheet formula", "A transcription and meeting-notes tool", "A design tool", "A password manager"],
    explanation: "Transcription first, then extraction. Do not retype a call by hand.",
  },
  {
    id: "aq-8", module_id: "am-2", position: 3, answer: 1,
    prompt: "An AI tool gives you a client figure you cannot verify. What do you do?",
    choices: ["Send it, it came from the AI", "Check it against the source before it leaves the building", "Round it down to be safe", "Ask the client to confirm it"],
    explanation: "Anything client-facing is your output, not the tool's. Unverified numbers do not go out.",
  },

  {
    id: "aq-9", module_id: "am-3", position: 1, answer: 1,
    prompt: "You are blocked at 3pm on the only task the client cares about. What happens?",
    choices: ["Wait and mention it in the EOD", "Flag the blocker now with what you need to unblock it", "Work around it quietly", "Move it to Done and add a note"],
    explanation: "A blocker is worth flagging the moment it exists. The EOD records it, it does not discover it.",
  },
  {
    id: "aq-10", module_id: "am-3", position: 2, answer: 1,
    prompt: "Your assignment with a client ends. What has to happen to their credentials?",
    choices: ["Nothing, access was revoked", "Revoke access and rotate anything you opened", "Delete the vault", "Email them the passwords back"],
    explanation: "Revoking access cannot un-know a password somebody already read. Rotation is the part that actually protects the client.",
  },
];

/** Questions as the learner gets them, with no answer attached. */
export const QUESTIONS: AcademyQuestion[] = QUESTIONS_WITH_KEY.map(({ answer: _answer, ...q }) => q);

/** Demo-only grading. Live mode calls the Postgres function instead. */
export const demoKey = (questionId: string): number | undefined =>
  QUESTIONS_WITH_KEY.find((q) => q.id === questionId)?.answer;
