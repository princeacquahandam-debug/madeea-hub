# MadeEA EA Hub — Build Plan (Functional Rebuild)

> **Companion doc:** `madeea-hub-extraction.md` (complete content/feature spec of the current static prototype).
> **Goal:** Rebuild the prototype as a real, multi-user, AI-powered application.
> **Created:** 2026-05-30

---

## 0. Decisions (locked)

Reconciled against the internal benchmark spec ("Rowena's MadeEA Hub — Benchmark Notes", Bryan → Prince sync 2026-05-29), which locks production scope. Where the benchmark and earlier preferences conflicted, **the benchmark (the requirements) wins.**

| Decision | Choice |
|---|---|
| **Frontend** | **Vite + React + TypeScript**, reuse existing Radix/shadcn UI + Tailwind |
| **Hosting** | **Vercel** (deploy target; migrate off Replit per spec) |
| **Backend / data** | **Supabase** — Postgres + Row Level Security, Auth, Edge Functions, Storage |
| **AI provider** | **OpenAI** (server-side, per locked spec). "Powered by Claude" UI badge is **decorative branding only**, as the benchmark states. LLM access isolated behind one adapter module for swap-ability. |
| **Real integrations (v1)** | **Gmail**, **Google Calendar**, **Slack**, + an **Integrations panel** (Connect/disconnect OAuth screen) |
| **Mocked/app-managed (v1)** | Tasks, Clients, Automations (seeded + user-CRUD) |
| **Users** | **Multi-user from day one** + per-user/workspace isolation (RLS) |

### Benchmark-driven additions (folded into phases)
- **Output history is first-class:** AI generations are saved objects with a per-client **"Generations" tab** (searchable/editable), not ephemeral text under a form.
- **Cost guardrails:** per-workspace spend caps + cheap/premium model router (benchmark "Economics" gap).
- **Mobile responsive:** the 3-column layout must collapse cleanly below ~900px (benchmark "Responsive" gap).

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Vite + React SPA (browser)                              │
│  • Radix/shadcn UI (reused), Tailwind                    │
│  • React Router (real routes per view)                   │
│  • TanStack Query (server state) + Zustand (UI state)    │
│  • supabase-js (auth session, RLS-scoped queries)        │
└───────────────┬─────────────────────────────────────────┘
                │  authenticated requests (JWT)
                ▼
┌─────────────────────────────────────────────────────────┐
│  Supabase                                                │
│  • Postgres + RLS  ← clients/tasks/messages/meetings/... │
│  • Auth (email/password + Google OAuth w/ Gmail+Cal scopes)│
│  • Edge Functions (Deno) — the ONLY place secrets live:  │
│      - generate           (Claude: studio/bookkeeping/QA)│
│      - assistant-chat     (Claude: streaming chat)       │
│      - gmail-sync / send-email                           │
│      - calendar-sync                                     │
│      - run-automation     (+ pg_cron scheduler)          │
│  • Storage (generated PDFs/exports)                      │
└───────────────┬───────────────────┬─────────────────────┘
                ▼                   ▼
        Anthropic API        Google APIs (Gmail, Calendar)
```

**Hard rule:** the browser never holds the Anthropic key or Google client secret. All third-party calls go through Edge Functions, which run with the user's JWT and read their stored Google refresh token server-side.

---

## 2. Tech stack detail

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite | Already in use |
| UI | React 18 + TS, Radix/shadcn, Tailwind | Reuse existing components; **fix `DialogContent` missing `DialogTitle`** |
| Routing | React Router v6 | One route per view (`/`, `/tasks`, `/comms`, `/quick-actions`, `/clients`, `/automation`, `/studio`, `/bookkeeping`) |
| Server state | TanStack Query | Caching, mutations, optimistic updates (task moves) |
| UI state | Zustand | Active view, modals, chat panel |
| Auth/DB client | `@supabase/supabase-js` | Session + RLS-scoped reads/writes |
| AI | **OpenAI SDK** in Edge Functions, behind a one-file `llm` adapter | Premium model (e.g. `gpt-4o`) for drafts, cheap model (e.g. `gpt-4o-mini`) for triage/categorization; SSE streaming. Adapter keeps provider swappable. |
| Google | `googleapis` / REST in Edge Functions | Gmail + Calendar read; Gmail send |
| Slack | Slack Web API in Edge Functions | Notifications + message triage source |
| PDF export | `@react-pdf/renderer` or server render | Invoices/expense reports |

---

## 3. Data model (Postgres)

Enums: `priority(urgent|high|normal|low)`, `task_status(todo|in_progress|done)`, `message_category(urgent|reply|delegate|archive)`, `meeting_status(prepared|needs_prep|pending)`, `automation_status(active|paused)`.

| Table | Key columns |
|---|---|
| `profiles` | `id`→auth.users, `full_name`, `role` (e.g. "Elite EA"), `initials` |
| `clients` | `id`, `owner_id`, `name`, `title`, `company`, `initials`, `preferred_channel`, `tone`, `tags text[]`, `bio`, `preferences_notes` |
| `tasks` | `id`, `owner_id`, `client_id`, `title`, `due_label`, `due_at`, `priority`, `status` |
| `messages` | `id`, `owner_id`, `client_id?`, `sender_name`, `sender_initials`, `subject`, `preview`, `body`, `received_at`, `category`, `source(gmail|manual)`, `gmail_id`, `is_read` |
| `meetings` | `id`, `owner_id`, `client_id?`, `title`, `starts_at`, `status`, `source(gcal|manual)`, `gcal_event_id` |
| `automations` | `id`, `owner_id`, `name`, `description`, `trigger`, `action`, `status`, `last_run_at`, `total_runs`, `is_custom` |
| `automation_runs` | `id`, `automation_id`, `ran_at`, `summary`, `output jsonb` |
| `ai_generations` | `id`, `owner_id`, `tool(quick_action|studio|bookkeeping)`, `format`, `inputs jsonb`, `output`, `created_at` |
| `assistant_threads` | `id`, `owner_id`, `title`, `created_at` |
| `assistant_messages` | `id`, `thread_id`, `role(user|assistant)`, `content`, `created_at` |
| `google_credentials` | `id`, `owner_id`, `refresh_token` (encrypted), `scopes`, `connected_at` |

**RLS:** every table policy = `owner_id = auth.uid()` (via join for `automation_runs`/`assistant_messages`). Seed data is inserted per-user on first login (a `seed_demo_data()` function) so new users see the populated demo state from the prototype.

---

## 4. Edge Functions (server tier)

| Function | Purpose | Calls |
|---|---|---|
| `generate` | Unified generator for Quick Actions, Communication Studio (5 formats), Bookkeeping (4 types). Takes `{tool, format, inputs}`, builds a format-specific prompt, streams Claude output, logs to `ai_generations`. | Anthropic |
| `assistant-chat` | Streaming chat. Injects user context (today's tasks, client summaries) into system prompt; persists to `assistant_*`. | Anthropic |
| `gmail-sync` | Pull recent inbox → upsert `messages`; auto-categorize (urgent/reply/delegate/archive) via a cheap Claude/Haiku pass or rules. | Gmail |
| `send-email` | Send an approved AI draft reply. | Gmail |
| `calendar-sync` | Pull upcoming events → upsert `meetings`; derive `status`. | Calendar |
| `run-automation` | Execute one automation (priority alignment / meeting prep / inbox triage); write `automation_runs`, bump counters. | Anthropic + Gmail/Cal |
| (cron) `pg_cron` | Schedule automations (7:30 AM brief, every-2h triage, pre-meeting prep). | invokes `run-automation` |

**Prompt design:** one system prompt per format (cached), with the field placeholders from the extraction doc (§9–§10) as the input contract. Each format's prompt encodes the executive-EA voice (British spelling, concise, formal-by-default, tone-aware).

---

## 5. Phased delivery

### Phase 0 — Foundation
- Init Vite+TS app from existing component code; add Tailwind + shadcn config.
- Create Supabase project; wire `supabase-js`; env (`.env.local` for anon key/url; secrets in Edge Function env).
- Migrations: all tables + enums + RLS + `seed_demo_data()`.
- Auth: email/password + **Google OAuth** (request Gmail+Calendar scopes, `access_type=offline` to capture refresh token → `google_credentials`).
- App shell: protected routes, sidebar/topbar/right-rail, login screen.
- **Acceptance:** a new user signs up, lands on Dashboard seeded with the demo clients/tasks/meetings, data is RLS-isolated.

### Phase 1 — Core operations (DB-backed views)
- **Dashboard:** stat cards, Priority Queue, Upcoming Meetings, Client Snapshot — all from DB queries (TanStack Query).
- **Task Manager:** kanban (To Do / In Progress / Done), Add Task, status toggles, drag-between-columns → persisted; priority/due fields.
- **Client Vault:** card grid + full-profile modal (fix DialogTitle a11y); CRUD for profiles, tags, bio, preferences, active tasks (joined), schedule.
- **Acceptance:** all three views fully interactive and persistent; refresh keeps state.

### Phase 2 — Claude integration (the core "make it functional")
- `generate` Edge Function + streaming UI in the output panes.
- **AI Quick Actions** (26 actions across 5 groups) → each posts a templated prompt; output rendered with copy button; saved to history.
- **Communication Studio** — all 5 formats (Executive Email, Technical Writing, Report, Proposal/Pitch, Press Release) with their exact forms (extraction §9).
- **Bookkeeping AI** — all 4 types (Expense Report, Invoice, Budget Summary, Financial Brief) (extraction §10) + PDF export for invoices/expense reports.
- **AI Assistant chat** — `assistant-chat`, suggested-prompt chips functional, context-aware.
- **Acceptance:** every Generate/Draft/Chat button returns real streamed Claude output and persists to history.

### Phase 3 — Google integrations
- `gmail-sync` → **Communication Center**: real inbox, filter tabs (All/Urgent/Awaiting Reply/Delegated), auto-categorization, message reading pane.
- **AI Draft Response** wired (uses client tone/preferences from Client Vault) → `send-email` to send approved replies.
- `calendar-sync` → real **Upcoming Meetings** on Dashboard + meeting list; meeting status derivation.
- **Acceptance:** Communication Center shows the user's real recent mail; Dashboard meetings reflect Google Calendar.

### Phase 4 — Automations engine
- **Automation Dashboard:** 3 core automations (Priority Alignment, Meeting Prep, Inbox Triage) with real toggle, Run Now, last-run/total-runs.
- `run-automation` logic for each; `pg_cron` schedules (7:30 AM, pre-meeting 24h, every 2h business hours).
- **Custom Automation Builder:** persist trigger+action+name; validate; show in list.
- **Acceptance:** Run Now produces a real run + logged output; scheduled runs fire; toggle pauses cron.

### Phase 5 — Polish
- **Global search** (top bar) across clients/tasks/messages.
- **Notifications** (bell) — automation results, urgent messages.
- **A11y pass** (all dialogs titled), responsive layout, loading/empty/error states.
- Export/share for generated docs; settings (Google connect/disconnect, profile).
- **Acceptance:** no console a11y errors; works on tablet width; graceful failures.

---

## 6. Cross-cutting concerns

- **Security:** secrets only in Edge Functions; RLS on every table; validate Google scopes; encrypt stored refresh tokens; rate-limit `generate`/`assistant-chat`.
- **Cost control:** default to Sonnet for high-volume (triage, categorization), Opus for user-facing drafts; prompt caching on system prompts; per-user usage tracking via `ai_generations`.
- **Streaming:** SSE from Edge Functions → progressive render in output panes/chat.
- **Testing:** unit (prompt builders, categorizers), integration (Edge Functions w/ mocked Anthropic/Google), e2e (Playwright over the same flows captured in extraction).
- **Observability:** log Edge Function errors; surface automation failures in Notifications.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Google refresh token not captured (only returned on first consent) | Force `access_type=offline&prompt=consent`; re-consent flow in Settings if missing |
| Gmail/Calendar scope review (Google verification for sensitive scopes) | Start in testing mode w/ allow-listed users; submit for verification before public launch |
| Claude cost spikes from automations/triage | Tiered models, caching, per-user quotas, batch where possible |
| Inbox categorization accuracy | Hybrid rules + LLM; let users re-tag; feed corrections back |
| RLS gaps / data leakage | Policy tests per table; default-deny |

---

## 8. Suggested sequencing

Phase 0 → 1 deliver a real multi-user app with persistent core ops. Phase 2 delivers the headline AI value (independent of Google, so it can ship even before scope verification). Phase 3 layers in live mail/calendar. Phase 4 automations. Phase 5 hardening. Phases 2 and 3 can partly parallelize once Phase 0/1 land.

**First PR target:** Phase 0 + Dashboard read-only from seeded data — proves auth, RLS, seeding, and the shell end-to-end.
