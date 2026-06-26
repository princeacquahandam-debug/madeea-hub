# Implementation Plan — Reich's Command Center Feedback

> Source: "MadeEA Command Center Feedback" by Reich.
> **Core theme (his words):** improve usability through **clearer guidance,
> examples, and workflow automation** so EAs understand every feature *without
> extra training* — and can see at a glance everything the app offers.

## 1. Review — what he's really asking for

Two buckets:

**A. Make it self-explanatory (his stated #1 priority)** — guided instructions,
tooltips, placeholders, example inputs/outputs for the AI tools; explain the
Communication Center workflow; a first-run tour; "see everything at a glance".

**B. More functional depth** — richer Task Manager (subtasks, dependencies,
recurring, checklists, templates); simple user-built reminders/automations;
saved prompts; favorites; keyboard shortcuts; SOP-trained AI chat; broader
search; mobile.

## 2. Current state — what's already done (so we don't rebuild)

| Reich's ask | Status | Notes |
|---|---|---|
| Onboarding / "explain each module" | 🟡 **partial** | We just shipped **collapsible per-page guide cards** ("How this page works"). A first-run *interactive tour* is still missing. |
| Personal dashboard of today's priorities | ✅ done | Dashboard: KPIs + priority queue + meetings. |
| Notification center | 🟡 partial | Bell shows urgent messages + due tasks (derived client-side); no rule engine for "deadline approaching / follow-up in N days". |
| Universal search | 🟡 partial | Searches clients/tasks/messages; **not** SOPs, tools, notes. |
| AI chat | 🟡 partial | Assistant has task/client context; **not** trained on SOPs/templates. |
| Mobile-responsive | 🟡 partial | Responsive shell + mobile drawer exist; not QA'd across all pages. |
| Examples/placeholders on AI tools | 🟡 partial | Studio + Bookkeeping have placeholders; **Quick Actions run with no input at all** (the root of his confusion). |
| Task Manager depth | 🆕 new | Tasks are flat today. |
| User-built reminders/automations | 🆕 new | We have AI automations (priority/meeting/inbox); not simple user reminders. |
| Saved prompts / favorites / shortcuts / notes | 🆕 new | — |

**Key insight:** his biggest pain — *"Draft Email Response: paste the thread or the latest?"* — exists because the **Quick Actions have no input form**; they fire the AI with empty inputs. Fixing that is both a usability AND a functionality win, so it leads.

## 3. The plan (5 phases, ordered by his priority)

### Phase 1 — "No training needed": guidance + examples  ⭐ (his #1 & #5)
The highest-impact work and the core of his feedback.
- **Quick Actions get real input forms.** Each of the 26 actions gets a small schema: fields + **example placeholders** + a one-line **"How to use"** + a sample-output hint. e.g. *Draft Email Response* → field "Paste the client's email" (placeholder: *"the latest message — or the whole thread if context matters"*) + Tone + a "Reply scope: latest / whole thread" toggle. Reuses the existing form+OutputViewer pattern.
- **Every AI tool gets a description + tooltips** on fields (a small `Tooltip`), and a worked **example input → output** in each tool.
- **Communication Center**: an inline "How this works" workflow strip (beyond the guide card) + clarify Gmail-connect vs manual.
- **SOP-trained assistant**: inject the workspace's SOPs (titles + steps) into the assistant-chat context → "ask company-specific questions".
- **Search → SOPs**: add SOPs (and AI tools) to the global search results.
- *(Guide cards already shipped — counts toward this phase.)*

### Phase 2 — Onboarding & discoverability  (his #4 + "see at a glance")
- **First-run guided tour** — a spotlight walkthrough of the sidebar + key actions on first login; "Replay tour" in settings; completion stored on the profile.
- **Command palette (Ctrl/⌘-K)** — one box to search *and* launch any tool/page; doubles as the base for keyboard shortcuts.
- **Favorites / pinned tools** — star any AI tool; pinned ones surface in the right rail.
- **Tools overview** — a compact "everything the Command Center offers" index (also the tour's anchor).

### Phase 3 — Task Manager depth  (his #2)
- **Checklist items / subtasks** on a task (progress shown on the card).
- **Recurring tasks** (daily/weekly/monthly) via a scheduler.
- **Task templates** — seed common EA workflows (e.g. "Onboard new client", "Weekly report"), one-click instantiate.
- **Task dependencies** — "blocked by" links with a visual indicator.

### Phase 4 — Smart reminders & notification engine  (his #3 + notification center)
- A real **notifications table** + a **rule engine** (pg_cron) generating: *task overdue*, *deadline approaching*, *follow-up after N days*, *recurring weekly task created*.
- The bell reads from that table (persisted, mark-read), replacing the client-only derivation.
- A simple **"Add reminder/rule"** UI ("remind me if a task is overdue", "follow up in 3 days").

### Phase 5 — Power-user & polish  (additional suggestions)
- **Saved AI prompts** library (save/reuse inputs across tools).
- **Keyboard shortcuts** (built on the command palette).
- **Mobile-responsive QA** pass across every page + modals.
- **Notes** module (lightweight) + include in search — *if wanted* (see decisions).

## 4. Decisions to confirm

1. **Sequence** — recommend **Phase 1 first** (it's his #1 and makes the AI tools genuinely usable). OK to proceed in this order?
2. **Notes** — Reich lists "notes" in search; we have no Notes feature. Add a dedicated Notes module, or treat client/task notes (which exist) as "notes"?
3. **Task templates & SOP wording** — we'll need the team's **canonical EA workflows** (ties into Belle's SOP feedback) to seed templates/checklists.
4. **Guided tour** — build a lightweight custom tour (no dep) vs a library (react-joyride). Recommend custom to stay dependency-light.
5. **"Reply scope / what to paste"** conventions — confirm the defaults for the top tools (e.g. Draft Email = latest message by default, with a whole-thread toggle).

## 5. Recommendation

Start with **Phase 1** — it directly answers Reich's central point, turns the
Quick Actions from "fire blind" into guided, example-led tools, and needs no new
infrastructure. It's also the fastest path to "an EA can use this without
training." Phases 2–5 layer on discoverability, task depth, reminders, and
power-user polish.
