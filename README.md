# MadeEA EA Hub

MadeEA "Command Center" — an AI-powered dashboard
for an Elite Executive Assistant. Vite + React + Supabase, OpenAI server-side,
multi-user from day one.

See `madeea-hub-build-plan.md` for the full plan and `madeea-hub-extraction.md`
for the feature spec the UI was rebuilt from.

## Stack
- **Frontend:** Vite + React + TypeScript, Tailwind, React Router, TanStack Query
- **Branding:** navy `#09141f` + MadeEA orange `#fd5812`, Cormorant Garamond display / DM Sans body (sampled from the reference app)
- **Backend:** Supabase (Postgres + RLS + Auth + Edge Functions)
- **AI:** OpenAI via Edge Functions (`gpt-4o` premium / `gpt-4o-mini` cheap), behind a one-file adapter
- **Deploy target:** Vercel

## Run locally (demo mode)
```bash
npm install
npm run dev
```
With no Supabase env set, the app runs in **demo mode**: auto-signed-in as the
seeded persona, all data from `src/data/seed.ts`, AI actions return labelled
placeholders. Fully browsable with zero credentials.

## Go live (connect your keys)
1. **Create a Supabase project**, then set frontend env in `.env.local`:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
2. **Apply migrations** (`supabase/migrations/`): creates tables, RLS, and the
   per-user demo seed that runs automatically on signup.
   ```bash
   supabase db push
   ```
3. **Set server secrets** (never exposed to the browser):
   ```bash
   supabase secrets set OPENAI_API_KEY=sk-...
   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
   supabase secrets set SLACK_CLIENT_ID=... SLACK_CLIENT_SECRET=...
   ```
4. **Deploy Edge Functions:**
   ```bash
   supabase functions deploy generate
   supabase functions deploy assistant-chat
   ```
5. **Enable Google OAuth** in Supabase Auth (provider scopes for Gmail +
   Calendar are requested at sign-in; `access_type=offline` captures the refresh
   token). The app switches from demo to live automatically once env is present.

## Deploy to Vercel

The repo is Vercel-ready: `vercel.json` sets the Vite framework, build command,
output dir, an SPA rewrite (so client routes like `/tasks` and refreshes don't
404), and immutable caching for hashed assets. The backend stays on Supabase —
Vercel only serves the static SPA.

**Via the Vercel dashboard (recommended):**
1. **Add New… → Project → Import** `princeacquahandam-debug/madeea-hub`.
2. Framework preset auto-detects **Vite**. Leave build command (`npm run build`)
   and output dir (`dist`) as-is.
3. **Environment Variables** — add for Production + Preview:
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
   (Do **not** add `OPENAI_API_KEY` here — it lives only in Supabase Edge
   Function secrets, never in the frontend.)
4. **Deploy.**

**Via CLI** (from the project root):
```bash
vercel link          # one-time, links to the project
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel --prod
```

**After the first deploy — update auth allow-lists** (or Google login + redirects break):
- **Supabase → Authentication → URL Configuration:** add your Vercel URL
  (`https://<app>.vercel.app`) to **Site URL** and **Redirect URLs**.
- **Google Cloud → OAuth client:** add the Vercel URL to **Authorized JavaScript
  origins** and the Supabase callback to **Authorized redirect URIs**.

## Status (this build)
- ✅ **Phase 0–1:** app shell, routing, auth (email + Google), all 9 views ported
  and interactive on seed data, responsive layout, brand-matched theme.
- ✅ **Backend foundation:** full schema + RLS + per-user seed migrations.
- ✅ **AI server tier:** `generate` + `assistant-chat` Edge Functions (OpenAI),
  with output logged to `ai_generations` (history is first-class).
- ⏳ **Next:** wire live Supabase queries into the pages (swap seed → DB),
  Gmail/Calendar/Slack sync functions, automation scheduler (pg_cron), PDF export.

## Project layout
```
src/
  components/   layout shell, generator tool, assistant widget, ui primitives
  pages/        Dashboard, Tasks, Communication, QuickActions, ClientVault,
                Automation, Integrations, CommunicationStudio, BookkeepingAI, Login
  data/seed.ts  demo dataset (mirrors the live seed_demo_data() SQL)
  lib/          supabase client, ai client, constants, utils
  hooks/        useAuth (demo + live)
supabase/
  migrations/   0001 schema+RLS, 0002 seed + signup trigger
  functions/    generate, assistant-chat, _shared (llm adapter, prompts)
```
