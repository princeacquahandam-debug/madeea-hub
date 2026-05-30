# MadeEA EA Hub — Functional Implementation Plan

> From "scaffold on seed data" → **fully functional, persisted, multi-user app.**
> Companion to `madeea-hub-build-plan.md` (architecture) and `madeea-hub-extraction.md` (feature spec).
> **Decisions for this plan:** app-data first → integrations second; v1 includes scheduled automations, search + notifications, PDF export, cost guardrails, and team admin.

---

## Current state (recap)

| Layer | Status |
|---|---|
| UI — all 9 views | ✅ render, but read **static `src/data/seed.ts`** (nothing persists) |
| Auth | ✅ Supabase email sign-in, invite-only; Google method stubbed |
| DB | ✅ schema + RLS + per-user seed migrations applied |
| AI | ✅ `generate` + `assistant-chat` Edge Functions (OpenAI) deployed & callable |
| Persistence / CRUD | ❌ none — the core gap |
| Output history, automations, search, notifications, exports, integrations | ❌ not wired |

**The spine of this plan:** replace `seed.ts` reads with a live Supabase data layer, then layer features on top.

---

## Phase 0 — Tenancy model (do FIRST to avoid a retrofit)

Team admin needs a workspace concept. Adding `workspace_id` *after* building all CRUD means rewriting every query — so it lands first.

- **0.1 Migration `0003_workspaces.sql`:**
  - `workspaces (id, name, created_at)`
  - `memberships (workspace_id, user_id, role enum('admin','ea'))`
  - add `workspace_id` to: clients, tasks, messages, meetings, automations, ai_generations, assistant_threads.
  - **RLS rewrite (per the requirements — "roles, per-EA inbox views, workspace isolation"):**
    access to a row = *member of its workspace* **AND** *(my role = `admin` **OR** `owner_id = auth.uid()`)*.
    → EAs see only their own assigned records; admins see the whole workspace. `owner_id` = the assigned EA.
  - Update `handle_new_user()`: first user → create the workspace + `admin` membership + seed into it; invited users → join the inviting workspace as `ea`.
  - Backfill: existing users (already seeded under the old per-user schema) get a workspace created and their rows assigned to it.
- **0.2** Helpers `my_workspace()` / `is_admin()` (SQL) + a `useWorkspace()` / `useRole()` hook on the client. EA list views default-filter to `owner_id = me`; admins get an "all EAs" toggle.
- **Acceptance:** fresh signup creates a workspace (admin); an invited EA joins it and sees only their own assignments; an admin sees all; another workspace sees nothing.

---

## Phase A — Live data layer (replaces seed.ts everywhere)

- **A.1 Data hooks** (`src/data/`): TanStack Query hooks per entity — `useClients`, `useTasks`, `useMessages`, `useMeetings`, `useAutomations`, `useGenerations`, `useProfile` — each with list/create/update/delete calling Supabase, with optimistic updates + cache invalidation. Central `queryKeys`.
- **A.2 Dashboard** → KPIs computed from live counts; Priority Queue from `tasks` (sorted by priority/due); Upcoming Meetings from `meetings`; Client Snapshot from `clients`.
- **A.3 Task Manager** → full CRUD persisted: add (real modal, not `prompt()`), edit, delete, drag/button move between columns → writes `status`; optimistic.
- **A.4 Client Vault** → CRUD clients + all profile fields (bio, prefs, tags, channel, tone); editable modal; active-tasks derived via join; "Add client".
- **A.5 Communication Center** → messages from DB; tab filters as queries; selecting a message; actions (delegate/archive/mark-read) persist `category`/`is_read`.
- **A.6 Automation page** → list from DB; toggle + Run Now + custom-builder save all persist.
- **A.7** Delete per-page `seed.ts` imports (seed lives only in SQL now).
- **Acceptance:** every page survives refresh; changes persist; isolated per workspace; zero `seed.ts` reads in `src/pages`.

---

## Phase B — AI tied to real records + first-class output history

- **B.1 Client-aware prompts:** Studio/Bookkeeping/Quick Actions accept a selected client; `generate` enriches the prompt with that client's tone + preferences from the DB (the Client Vault becomes a real memory layer).
- **B.2 Generations surface:** `generate` already logs to `ai_generations`. Build:
  - a global **AI History** page (list, search, filter by tool/client, re-open, copy, edit, delete);
  - a **"Generations" tab inside each Client profile** (per-spec).
- **B.3 Action outputs become objects:** Quick Actions + Communication "AI Draft Response" save to history with client attribution; "Save to client" / "Copy" / (later) "Send".
- **B.4 Assistant persistence:** chat threads + messages saved (`assistant_threads`/`messages`); reopen past threads.
- **Acceptance:** generating anything creates a retrievable, searchable record attributable to a client; drafts reflect that client's stored tone.

---

## Phase C — Automations engine (scheduled)

- **C.1 `run-automation` Edge Function:** executes a given automation:
  - *Executive Priority Alignment* → reads tasks/meetings/messages, OpenAI-summarises a prioritised daily brief.
  - *Meeting Preparation* → for meetings in next 24h, compiles an attendee/agenda brief.
  - *Executive Summary Inbox* → categorises uncategorised messages (cheap model).
  Writes `automation_runs` (summary + output) and bumps `total_runs`/`last_run_at`.
- **C.2 Scheduling:** `pg_cron` + `pg_net` to invoke `run-automation` — 7:30 AM daily, hourly pre-meeting check, every 2h triage. Respect each automation's `status` (paused → skip).
- **C.3 Custom builder runnable:** persisted trigger/action mapped to executable steps; **Run Now** invokes live.
- **C.4 Run history UI:** expand an automation card → recent runs + their output.
- **Acceptance:** Run Now produces a real logged run; scheduled runs fire; pausing stops the schedule.

---

## Phase D — Search + notifications

- **D.1 Global search:** Postgres `ilike`/full-text across clients, tasks, messages; top-bar command-palette results, keyboard-navigable; click → navigate.
- **D.2 Notifications:** `notifications` table written by automations + triage (urgent message, automation result, due task). Bell shows unread count + dropdown; mark read; **Supabase Realtime** subscription for live push.
- **Acceptance:** search returns live cross-entity results; bell updates in real time when an automation runs or an urgent item lands.

---

## Phase E — PDF export

- **E.1** Branded PDF renderer (`@react-pdf/renderer`) — navy/orange MadeEA template (logo, header/footer).
- **E.2** "Download PDF" on Bookkeeping outputs (invoice/expense report first), then any generation, and from AI History.
- **Acceptance:** a generated invoice downloads as a clean, branded PDF.

---

## Phase F — Cost guardrails + Team admin

- **F.1 Usage + router:** extend `ai_generations` with `model`, `prompt_tokens`, `completion_tokens`, `cost_usd` (from the OpenAI response). Confirm router: cheap model for triage/categorise/search-summaries, premium for user-facing drafts. `workspace_usage` rollup.
- **F.2 Spend cap:** per-workspace monthly cap (configurable); `generate`/`run-automation` check spend before calling and return a friendly "cap reached" instead of billing.
- **F.3 Team admin screen:** invite EAs (Edge Function using the service-role `auth.admin.inviteUserByEmail`, adds membership), list members + roles, change role, remove. Plus a **Settings/Profile** page and a **Sign-out** control (currently missing in the UI).
- **Acceptance:** usage + cost visible per workspace; cap blocks overspend; an admin can invite an EA who lands in the same workspace with `ea` role.

---

## Phase G — Polish & hardening

- Loading / empty / error states + toast notifications + optimistic rollback on failure.
- Responsive QA below ~900px (the 3-column layout — benchmark gap); a11y (all dialogs titled, focus traps, keyboard).
- Tests where they pay: data hooks, automation logic, **RLS policy tests** (cross-workspace deny), PDF render smoke.
- **Acceptance:** no console a11y errors; usable on tablet width; RLS tests prove isolation.

---

## Phase H — Integrations (second track; gated on OAuth setup)

> Needs you to set up: a **Google Cloud OAuth app** (consent screen + Gmail/Calendar scopes — *sensitive scopes require Google verification, which can take weeks*), and a **Slack app**. Buildable in parallel with A–G; ships when verification clears.

- **H.1** Capture + store Google refresh token server-side (`google_credentials`) via an OAuth callback function; refresh handling.
- **H.2** `gmail-sync` (inbox → `messages`, auto-categorise) + `send-email` (send approved AI drafts) → Communication Center goes live.
- **H.3** `calendar-sync` (events → `meetings`) → Dashboard/meetings go live.
- **H.4** Slack OAuth install (`slack_credentials`) → notifications + message triage source.
- **H.5** Integrations panel: real connect/disconnect + live status from the credential tables.
- **Acceptance:** Communication Center shows the user's real mail; Dashboard meetings mirror Google Calendar; Slack notifications arrive.

---

## Build order & dependencies

```
Phase 0 (tenancy)  ─►  A (live data)  ─►  B (AI + history)
                                   └────►  C (automations) ─► D (search+notifs)
                        A ─► E (PDF)      A/0 ─► F (cost + team)
                        everything ─► G (polish)
                        parallel, gated track:  H (integrations)
```

Phase 0 → A is the critical path (unblocks all else). B, C, E, F can proceed once A lands; D depends on C for notification sources. H runs alongside but ships on Google/Slack readiness.

**Rough effort:** 0+A ≈ the bulk (core rewrite); B/C/D/E/F each a focused slice; G continuous; H gated externally.

---

## What needs YOU vs me

- **Me (now, no creds):** Phases 0, A, B, C, D, E, F, G — all buildable and testable against your Supabase project + existing OpenAI key.
- **You (when we reach H):** create the Google Cloud OAuth app + start Gmail/Calendar scope verification, and create the Slack app. I'll give exact steps.

---

## Risks

| Risk | Mitigation |
|---|---|
| Retrofitting `workspace_id` late | Phase 0 lands it first |
| AI cost from automations/triage | cheap-model router + per-workspace caps (Phase F) before scheduling goes hot |
| Google sensitive-scope verification delay | Phase H is decoupled; app is fully usable on own data without it |
| RLS gaps after workspace rewrite | explicit cross-workspace policy tests (Phase G) |
| Optimistic-update drift | rollback + invalidate on mutation error (Phase G) |
