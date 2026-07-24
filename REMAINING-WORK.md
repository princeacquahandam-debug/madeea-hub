# MadeEA Command Center — Remaining Work

**As of 2026-07-23 · App version 1.7.0**

This is the state of play for the client presentation: what just shipped, what only
you can action (ops/access), what needs a client decision, and what's blocked on
paid services.

---

## 1. Shipped this session (code complete, build green)

| Item | What it is | Status |
|---|---|---|
| **Notes area** | A shared team scratchpad — pin, search, link to a client. Separate from the Memory Helper on purpose (nothing but a human reads a note). | ✅ Built. Live once migration `0019` is applied (works in demo/preview now). |
| **Voice input** | The ⌘K command bar mic now dictates commands via the browser's own speech engine. No backend, no audio leaves the browser. | ✅ Built. Works today in Chrome/Edge/Safari; shows a disabled reason in Firefox. |
| **Accessibility** | Every form field has a proper screen-reader label (76 → 0 unlabelled). | ✅ Shipped. |
| **Reliable saves** | Memory Helper no longer silently loses a refused save — it shows the error and keeps your text. | ✅ Shipped. |
| **Version history** | Changelog updated to **1.7.0** so the team sees this update in-app. | ✅ Shipped. |

> All of the above is committed to code and the production build passes
> (`tsc` + `vite build`). Nothing here is blocked on me.

---

## 2. Your action items — ops / access (I can't do these; they need the Supabase & hosting dashboards)

These make already-written features actually work in production. **None happen on `git push`.**

- [ ] **Apply the database migrations in Supabase** (SQL editor, or `npx supabase db push`).
      Confirm with Kyle exactly which are already live, then run any missing ones **in order** through **`0020`**. The features that stay inert until then:
  - `0017_memory.sql` → Memory Helper
  - `0018_goals.sql` → Focus Helper goal tracking
  - `0019_notes.sql` → the new **Notes** area
  - `0020_security_followups.sql` → **security-critical, apply this one.** Membership now requires a confirmed email (closes invite squatting → workspace takeover), AI spend requires membership, the rate limiter is de-raced, `task_events` becomes a real audit trail, `owner_id` can't be spoofed. Requires `0016` first.

- [ ] **Confirm these three Supabase/Vercel settings** — the security audit found these are the config that the whole model rests on:
  - **"Allow new users to sign up" is OFF** in Supabase Auth
  - **`VITE_ALLOW_DEMO` is NOT set** in Vercel production (if set, everyone gets passwordless admin)
  - **`0016_security_hardening.sql` is applied** — all the invite-gating and token lockdown lives in it
  > Note: a not-yet-applied table now shows an on-screen error when you try to save,
  > rather than quietly losing the entry — so this is easy to spot.
- [ ] **Deploy any new edge functions** (`npx supabase functions deploy <name> --no-verify-jwt`), if not already deployed.
- [ ] **Email / invites:** set custom SMTP + Site/Redirect URLs in Supabase Auth (built-in email is rate-limited).

---

## 3. Client decisions needed (not code — questions for the meeting)

- [ ] **Gmail privacy in the shared workspace** — if an EA connects personal Gmail, synced
      messages become visible to the whole team. Decide: keep shared, or scope Gmail-sourced
      messages to their owner while keeping tasks/clients shared.
- [ ] **Demo/sample data** — clear the seeded sample clients/tasks/messages before real
      onboarding, or keep them for training.
- [ ] **Google OAuth verification** — Integrations run in "testing" mode; keep ≤100 users
      or start Google's verification process.

---

## 4. Blocked on paid services (present as optional add-ons)

Both have a **working internal version already built**; these are the external-data upgrades:

- **Homework Helper** — external **Clay** person/company research enrichment.
- **Scoreboard Helper** — live **Stripe / BI** revenue-metric alerts.

These need external subscriptions that don't exist in the project yet — a budget/procurement
call, not a development task.

---

*Priority for the client conversation: Section 2 is the only thing that can make paid,
already-built features fail in production — confirm the migration state with Kyle first.
Section 4 is a spend decision. Sections 1 and 3 are the story of what's done and what's next.*
