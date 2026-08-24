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
   # Token encryption. 32 random bytes, base64. Every OAuth token is
   # AES-256-GCM ciphertext before it reaches the database, so a database dump
   # is not a set of working credentials. Generate with:
   #   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   supabase secrets set INTEGRATION_ENCRYPTION_KEY=...
   supabase secrets set SLACK_CLIENT_ID=... SLACK_CLIENT_SECRET=...
   # Outlook. MICROSOFT_TENANT is optional and defaults to "common", which
   # accepts both work/school and personal accounts. Set it to a tenant id
   # only for a single-tenant deployment.
   supabase secrets set MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
   supabase secrets set MICROSOFT_TENANT=common
   # Discord. The BOT token from the Developer Portal's Bot tab, not the
   # application's client secret. This is how the bot authenticates; the
   # client id/secret below are how somebody installs it into their server.
   supabase secrets set DISCORD_BOT_TOKEN=...
   # App identities for the Connect buttons. These are MADEEA's registrations
   # with each provider, set once by whoever owns this deployment. They are not
   # anybody's account credential: a person connects by signing in, and their
   # token arrives over TLS and is stored server-side.
   supabase secrets set SLACK_CLIENT_ID=... SLACK_CLIENT_SECRET=...
   supabase secrets set DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=...
   supabase secrets set META_APP_ID=...
   supabase secrets set LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=...
   # Meta: Instagram DMs and WhatsApp. One app, one business, two channels.
   # META_PAGE_ID is the Facebook Page the Instagram Professional account is
   # linked to; WHATSAPP_PHONE_NUMBER_ID is from WhatsApp Manager and is NOT
   # the phone number itself.
   supabase secrets set META_PAGE_ID=... META_PAGE_ACCESS_TOKEN=...
   supabase secrets set WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_TOKEN=...
   # Webhook handshake and signature check. META_VERIFY_TOKEN is any string you
   # invent and also type into Meta's webhook setup; META_APP_SECRET is from the
   # app's Basic Settings and is what proves an inbound POST really came from
   # Meta. Without it whatsapp-webhook refuses everything, on purpose.
   supabase secrets set META_VERIFY_TOKEN=... META_APP_SECRET=...
   # Every OAuth redirect is validated against this list, so an origin missing
   # here fails the connection rather than redirecting anywhere unexpected.
   supabase secrets set APP_ORIGINS=https://your-app.vercel.app,http://localhost:5173
   ```
4. **Deploy Edge Functions:**
   ```bash
   supabase functions deploy generate
   supabase functions deploy assistant-chat
   ```
5. **Enable Google OAuth** in Supabase Auth (provider scopes for Gmail +
   Calendar are requested at sign-in; `access_type=offline` captures the refresh
   token). The app switches from demo to live automatically once env is present.
6. **Register the Outlook app** (only if you want Microsoft mailboxes). In the
   Azure portal → App registrations → New registration:
   - **Supported account types:** whichever `MICROSOFT_TENANT` says. "Accounts
     in any organizational directory and personal Microsoft accounts" matches
     the default of `common`.
   - **Redirect URI (Web):**
     `https://<project-ref>.supabase.co/functions/v1/microsoft-oauth-callback`
   - **Certificates & secrets:** create a client secret; its *value* is
     `MICROSOFT_CLIENT_SECRET`.
   - Delegated Graph permissions `Mail.ReadWrite`, `Mail.Send` and
     `offline_access`. Consent is per user, so no admin consent is needed unless
     the tenant restricts it. `Mail.ReadWrite` (not just `Mail.Read`) is what
     lets a reply thread: Graph will not let an app write In-Reply-To headers,
     so a threaded reply has to be created as a draft in the mailbox.

   Then deploy its functions:
   ```bash
   supabase functions deploy microsoft-oauth-url
   supabase functions deploy microsoft-oauth-callback
   supabase functions deploy microsoft-oauth-claim
   supabase functions deploy outlook-sync
   supabase functions deploy outlook-send
   ```
   `microsoft-oauth-callback` must have **Verify JWT off** (Microsoft redirects
   the browser to it with no session). The other four keep the default, on.

7. **Teams** needs no setup of its own. It runs on the Microsoft consent from
   step 6 (`Chat.Read` and `ChatMessage.Send`, both delegated), so anyone who
   connected Outlook before Teams shipped reconnects once and gets it. Deploy
   its two functions:
   ```bash
   supabase functions deploy teams-sync
   supabase functions deploy teams-send
   ```
   Team CHANNELS are deliberately not included. Reading those needs
   `ChannelMessage.Read.All`, which is admin-consent and tenant-wide: one click
   by an IT admin would grant this app every channel message in the
   organisation. Chats are personal and consented by the person whose chats
   they are.

8. **Discord** (only if a client lives there). In the
   [Developer Portal](https://discord.com/developers/applications):
   - New Application → **Bot** → Reset Token → copy it into
     `DISCORD_BOT_TOKEN`. This is not the OAuth2 client secret.
   - Same Bot tab → **Privileged Gateway Intents** → switch on **Message
     Content**. Without it every message arrives with an empty body;
     `discord-sync` detects that case and says so rather than writing blank rows.
   - **OAuth2 → URL Generator** → scope `bot`, permissions **View Channels**,
     **Read Message History**, **Send Messages** → open the generated URL and
     invite the bot to the server.
   - Per channel, the bot's role still needs Read Message History to pull from
     it and Send Messages to reply. The Integrations card lists every channel
     with those two stated separately, so a gap is visible rather than guessed.

   ```bash
   supabase functions deploy discord-channels
   supabase functions deploy discord-sync
   supabase functions deploy discord-send
   ```

9. **Instagram and WhatsApp** (one Meta app covers both).
   - In the [Meta app dashboard](https://developers.facebook.com/apps): add the
     **Messenger** product with your Facebook Page, and **WhatsApp** with your
     Cloud API number. Generate a Page access token (Instagram) and a
     system-user token (WhatsApp); a system-user token is the one that does not
     expire in 60 days.
   - Permissions: `instagram_basic`, `instagram_manage_messages`,
     `pages_manage_metadata`, `pages_read_engagement` for Instagram;
     `whatsapp_business_messaging` for WhatsApp.
   - **WhatsApp webhook** (this is the whole inbound path, not an extra):
     Webhooks → WhatsApp Business Account → Callback URL
     `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`, verify
     token = your `META_VERIFY_TOKEN`, subscribe to the **messages** field.

   ```bash
   supabase functions deploy meta-status
   supabase functions deploy instagram-sync
   supabase functions deploy instagram-send
   supabase functions deploy whatsapp-send
   supabase functions deploy whatsapp-webhook   # Verify JWT OFF
   ```

   `whatsapp-webhook` must have **Verify JWT off**, like the OAuth callback:
   Meta posts to it with no session. It is not unprotected as a result. Every
   POST is authenticated by its `X-Hub-Signature-256` HMAC, and a request that
   fails that check is refused rather than written.

   **Connecting is a login, not a pasted token.** Every card on Integrations
   opens the provider's own consent screen in a popup, and what comes back is
   stored server-side against the workspace (`workspace_integrations`, migration
   0056) with the account's name beside it, so the card can say *which* Slack
   workspace or Instagram account it is attached to. The `META_PAGE_*`,
   `WHATSAPP_*` and `SLACK_BOT_TOKEN` secrets above are still read as a fallback
   for a deployment configured before this existed; once somebody presses
   Connect, the stored login wins and those can be removed.

   Each provider needs one redirect URI registered, all pointing at the same
   place:
   `https://<project-ref>.supabase.co/functions/v1/integration-oauth-callback`

   ```bash
   supabase functions deploy integration-oauth-url
   supabase functions deploy integration-oauth-callback   # Verify JWT OFF
   ```

   **What is still Meta's to grant, not ours:** both channels work in
   development mode against accounts with a role on the app, and reaching real
   customers needs App Review. The Integrations cards read the live state from
   Meta (Page name, Instagram handle, WhatsApp display number), so what is
   actually reachable is visible rather than assumed.

   **Two rules that are Meta's and cannot be coded around.** Instagram allows a
   reply only within 24 hours of the person's last message, extended to 7 days
   for a human-written one (`instagram-send` applies the HUMAN_AGENT tag
   automatically when the window has closed). WhatsApp allows freeform text for
   24 hours and, after that, nothing but a template approved in advance in
   WhatsApp Manager. Both functions report those refusals as what they are
   rather than as generic failures, because retrying cannot fix either.

   **LinkedIn is not on this list and is not coming.** It publishes no messaging
   API at all: reading or sending DMs requires Partner Program access, which is
   invite-only and routinely refused. Its card says so plainly rather than
   implying a queue it is not in.

   **Google vs Microsoft, one difference worth knowing:** a Google account must
   be the same address you sign into MadeEA with, and Microsoft does not have to
   be. The Google callback enforces the match because it is the only thing
   stopping one person's tokens being filed under another's; Microsoft closes
   the same hole with a claim step in the app instead, so a work Outlook mailbox
   connects fine to a Gmail login. See `supabase/migrations/0048_outlook.sql`.

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
