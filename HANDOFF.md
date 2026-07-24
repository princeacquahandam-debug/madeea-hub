# MadeEA Command Center — Developer Handoff

**Date:** 2026-07-23 · **Branch:** `main` (in sync with `origin/main`)
**App version:** `1.7.0` (see `src/lib/changelog.ts`)

> **What changed since the 2026-07-02 handoff.** The app grew a whole **"Second Brain"**
> group and a **command center**, none of which existed at that handoff. New pages:
> Email/Meeting/Focus Helpers, Voice-Note Helper, Daily Briefing, **Memory Helper**,
> Decision Helper, Homework, Investor-Update, Scoreboard, Travel — plus a new
> **Notes** area, and **voice input** in the ⌘K command bar. Migrations went from
> `0012` to **`0019`**. The sections below are updated to match; anything not touched
> still holds.

A multi-user "Command Center" web app for outsourced Executive Assistants. This doc is the handoff for a new developer picking the project up.

---

## 1) Stack & services
- **Frontend:** Vite + React 18 + TypeScript + Tailwind (custom classes: `.card`, `.input`, `.field-label`, `.btn-primary`, `.btn-ghost`, `.pill`, `text-muted`/`text-faint`, `bg-surface-2`, `accent`). Brand: navy `#09141f`, MadeEA orange `#fd5812`, Cormorant Garamond + DM Sans, logo `public/logo.png`.
- **State/data:** TanStack React Query + Zustand stores (`src/store/*`), React Router, @dnd-kit (kanban).
- **Backend:** Supabase — Postgres + RLS + Auth + Edge Functions + Storage. Project ref **`bglduxferbjmoeqzyypx`**.
- **AI:** OpenAI server-side (`gpt-4o` / `gpt-4o-mini`) via the `generate` edge function. ("Powered by Claude" badges are decorative only — the spec mandated OpenAI.)
- **Hosting:** Vercel (auto-deploys on push to `main`). GitHub is the source of truth.

## 2) Local setup
```bash
npm install
# create .env.local with (values in the Supabase dashboard → Project Settings → API):
#   VITE_SUPABASE_URL=...
#   VITE_SUPABASE_ANON_KEY=...
npm run dev        # http://localhost:5173
npx tsc -b         # type-check
npm run build      # production build
```
> With **no** `.env.local`, the app runs in **demo mode** against `src/data/seed.ts` (fully browsable, no backend). Once the env vars are set it switches to live Supabase automatically.

Testing was done with **local Playwright `.cjs` scripts** (the Playwright MCP was unreliable). None are committed (they contained the login password). Recreate ad-hoc as needed.

## 3) ⚠️ Manual / ops steps (NOT automatic on deploy)
These are the things a new dev must know are done outside `git push`:

1. **Database migrations** live in `supabase/migrations/` and are applied by **pasting them into the Supabase SQL editor** (or `npx supabase db push`). The latest is **`0020_security_followups.sql`** — and that one is **security-critical, apply it**: it makes workspace membership require a *confirmed* email (closing an invite-squatting path to full workspace takeover), requires membership to spend AI budget, de-races the AI rate limiter, makes `task_events` a real audit trail, and stops `owner_id` being spoofed. **Confirm with the owner (Kyle) exactly which migrations are live** — the frontend degrades gracefully for the newer isolated tables (reminders, snoozes, memories, notes fall back to a local overlay if their table is missing), but the features are inert until the migration is run. In particular:
   - `0017_memory.sql` — the **Memory Helper** store.
   - `0018_goals.sql` — the **Focus Helper**'s goal-drift ('goal' memory kind).
   - `0019_notes.sql` — the new **Notes** area.
   - `0020_security_followups.sql` — **security follow-ups** (see above). Depends on 0016 being applied first.
   Note: since a recent change, a *refused* memory/notes write (RLS/constraint) is now **surfaced** rather than silently stashed locally — so an un-applied migration shows as an on-screen error, not a vanished entry.
2. **Edge functions** are deployed manually:
   ```bash
   npx supabase login
   npx supabase link --project-ref bglduxferbjmoeqzyypx
   npx supabase functions deploy <name> --no-verify-jwt
   ```
   All browser-called functions are deployed **`--no-verify-jwt`** with auth enforced **in-code** (getUser → 401) — this is required so the CORS preflight (OPTIONS) passes. `invite-member` was deployed this session.
3. **Email (invites/auth):** Supabase → Authentication → Emails → **custom SMTP** (Brevo or Mailgun recommended) + set **Site URL / Redirect URLs** to the Vercel app. Built-in Supabase email works but is heavily rate-limited.

## 4) Security model (important)
- **The real access boundary is Postgres RLS**, not the UI. Client role checks (`useMyRole`) only show/hide buttons.
- Every workspace-scoped table: `using (workspace_id = my_workspace())`. Helpers `my_workspace()` / `is_admin()` are `SECURITY DEFINER`.
- `memberships` writes are admin-only (`is_admin()`), so a tampered client still can't change roles or remove members.
- `invite-member` verifies the caller is an admin **server-side** and reads `workspace_id` from the DB, never from the client. Service-role key stays in the function env.

## 5) What changed in the most recent sessions
- **Guided tour** (`src/components/GuidedTour.tsx`): 4-way bubble placement that never covers the target; picks the *visible* instance of a target; auto-opens the mobile sidebar drawer (via new `src/store/ui.ts`) for the nav steps.
- **Admin panel** (`src/pages/Admin.tsx`, route `/admin`): lists workspace accounts with role + activity (open tasks/clients), invite by email, promote/demote, remove — with last-admin & self guards. Admin-only nav link in `Sidebar.tsx`; entry point also in `Settings.tsx`. Gated by `useMyRole()`.
- **Version history** (`src/lib/changelog.ts` + `src/pages/Changelog.tsx`, route `/changelog`): in-app "What's new", reached from Settings. `APP_VERSION` currently `1.6.0`.
- **Shared workspace** (`0012_shared_workspace.sql`): consolidated any per-signup workspaces into one; opened RLS from per-owner to workspace-wide on clients/tasks/messages/meetings/automations/ai_generations/assistant_threads/sop_runs/reminders; new signups JOIN the single workspace as `ea`.
- **Reliable role changes** (`src/data/hooks.ts`): `setRole`/`remove` use `.select()` to detect silent RLS no-ops and surface a clear error; `useMyRole` refetches on focus.
- **Secure invites** (`supabase/functions/invite-member/index.ts`).

## 6) Two "role" fields — don't confuse them
- `profiles.role` = a **display job title** ("Elite EA"), cosmetic, no permissions.
- `memberships.role` = the **permission** (`admin` | `ea`) — the only thing that grants admin access.
Make someone admin: `update memberships set role='admin' where user_id=(select id from auth.users where email='…');` (run in SQL editor, which bypasses RLS).

## 7) Open decisions / follow-ups for the new dev
- **Gmail privacy in a shared workspace:** with one shared workspace, if an EA connects their personal Gmail (Integrations → `gmail-sync`), those synced `messages` become visible to the whole team. Decide: keep fully shared, or scope Gmail-sourced messages to `owner_id` while keeping tasks/clients shared.
- **Demo/sample data:** the workspace was seeded with sample clients/tasks/messages (`seed_demo_data()` in `0003`). A new invited EA sees them (shared workspace). Clear with `delete from messages;` etc. if a clean slate is wanted.
- **`useMyRole` hardening (optional):** it reads one membership row; harmless now that 0012 makes it one-per-user, but could be made deterministic as belt-and-suspenders.
- **Integrations** (Gmail/Calendar/Slack via Google OAuth): functions exist (`google-oauth-*`, `gmail-sync`, `calendar-sync`, `slack-sync`); the Google app is in "published/testing" mode — @gmail users click through "Advanced → continue". Keep ≤100 users to avoid Google verification.
- **Notes** module — **now built** (`src/pages/Notes.tsx`, `src/lib/notes.ts`, migration `0019_notes.sql`, in-app search + guide card). A shared free-text pad, deliberately separate from the Memory Helper (nothing reads a note but a human). Apply `0019` to make it live.
- **Voice input** — the ⌘K command bar mic now dictates via the browser's own Web Speech engine (`src/lib/speech.ts`); no backend, no audio leaves the browser. Disabled with an honest reason in browsers that don't support it (e.g. Firefox).
- **Still procurement-blocked, not code** (out of scope until the services exist): Homework's external **Clay** person/company research, and Scoreboard's live **Stripe/BI** metric alerts. The internal, data-derived versions of both pages are built.

## 8) Key docs already in the repo
`madeea-hub-extraction.md` (original prototype crawl) · `madeea-hub-build-plan.md` · `madeea-hub-functional-plan.md` · `feedback-implementation-plan.md` (Reich's feedback → phases) · `working-sops-plan.md` · `SOPS-LIBRARY.md` · `PROGRESS-REPORT.md` (client-facing, non-technical) · this `HANDOFF.md`.

## 9) Test account
Login credentials for the QA/admin account are in `.env.local` (not committed) — get them from Kyle.
