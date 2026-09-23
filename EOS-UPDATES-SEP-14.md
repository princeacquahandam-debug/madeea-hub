# MadeEA OS — updates from the 14 Sep call (Prince / Rowena / Laura / Bryan)

Source: Fathom, "Prince MAdeea os 09-14", 67 min.
Context for the deadline: Wilkie Collin (Breakaway Hoops, ex-bank analyst, UAE,
New York business) is a hot lead. Rowena wants the OS demo-ready on standby.
"Process-driven, analytical" — the walkthrough has to hold up to scrutiny.

---

## A. Blockers before the Will C. demo

1. **Retest every AI feature now that OpenAI is topped up.**
   Prince paid $120 (incl. tax) mid-call after two declines on card 6277.
   Nothing AI-backed could be demoed during the walkthrough. Retest, in order:
   AI Quick Actions, the in-app chatbot, EOD report generation, Communication
   Center drafting, Dashboard briefing, voice → task. Laura re-tests after.
   (Prince: "most of the features before are not working, like it's not going
   through" — that was the credit, but confirm it.)

2. **Turn on auto-reload ($5–$20) on the OpenAI account** so a demo never dies
   on an empty balance again. Bryan raised it; needs Prince's go-ahead.

3. **Explain the August burn if it comes up again.** Prince asked twice why
   $100 drained in days. Answer on record: 28 Aug build-and-test of the OS
   automations, plus the Voice AI (sales rep + media buyer) backend. Normal
   client usage is 10–15 min checks, not hours.

---

## B. Client visibility — BUILT (migration 0073 + portal panes)

Shipped: Overview · Activity · Calendar · Notes · the two message channels.
Guarded by `npm run check:client-surface`, which fails if any client view ever
publishes a private column or stops filtering on `my_client()`.

Items 4 and 5 were resolved as decisions, not as straight implementations —
read the two entries below before demoing either.


`src/components/ClientOverview.tsx:13` states EOD reports and screenshots are
**deliberately absent** from the client portal. The call decided the opposite:

4. **EOD → shipped as a per-client daily digest, NOT the EOD report.**
   `eod_reports` has no `client_id` and one report per person per day covers
   every client that assistant touched, so it cannot be sliced. The Activity
   tab rebuilds each day from the two things already tagged by client —
   completed tasks and time entries. Nothing untagged is ever read, so no line
   can belong to another account. **Say "daily activity", not "EOD", in front
   of a client.** Per-line EOD tagging is still the eventual answer (schema +
   EOD form change); this is deliberately not it.

5. **Screenshots → shipped as session proof, no images.** The client sees
   clock-in/out, duration, session count and how many captures are held on
   file. The pictures are not published: a capture taken on this client's time
   still shows whatever else was on the monitor, and no row-level rule reaches
   inside an image. `client_days` has no `storage_path` column and the guard
   script fails if one ever appears. **Rowena should hear this framing before
   the demo**, since the call said "screenshots" out loud.

5b. **Open: the blocked-task reason.** A client sees *that* a task is blocked,
   never *why* — `tasks.blocker_note` is the assistant's own working note and
   stays unpublished. But "waiting on your bank login" is exactly what a client
   needs. Proposed follow-up: a separate `client_visible_blocker` column the EA
   fills deliberately, so nothing private is republished by accident.

6. **Multiple EAs per client.** Rowena: "Kung marami po sila... multi-service
   yung kinuha ni client" — reports must stay trackable per EA. Confirm the
   EOD and hours views group by assistant.

7. **Missed clock-in has no escalation.** `src/lib/clockGates.ts` gates the
   buttons (focus to clock in, EOD to clock out) but nothing tells anyone when
   an EA simply never clocked in. Bryan: "papasok yan kay Rachel kung sakali,
   kasi si Rachel nag-monitor" — that route does not exist yet. Build it.

---

## C. Cost control and gating

8. **Hide Video Instruction from clients.** `src/pages/Videos.tsx` has no role
   gate, no beta flag, nothing. Rowena: "huwag mong ipapakita yan" — the video
   capture can eat ~$100 of tokens in a day. Make it admin-only / feature-
   flagged. Keep the code: agreed as a **future upsell**, not a deletion.

9. **Label Routines as beta.** Bryan: "beta pa lang po ito." No beta badge in
   `src/pages/Routines.tsx` or the nav entry. A client clicking into a beta
   with no warning is a bad look in front of an analyst.

10. **Make paid-only integrations read as "upgrade", not as broken.**
    WhatsApp and Slack both need paid plans. Right now admin sees everything
    unlocked and the client sees a subset with no explanation — Rowena called
    this confusing. Show them locked with an upgrade label. Gmail only for now;
    Google Chat was raised and parked.

11. **Communication Center needs a connect-first state.** It shows nothing
    until Gmail + Calendar are connected via Integrations. Rowena had to be
    walked through why it was empty. Make the empty state say it and link
    straight to Integrations.

---

## D. Copy and positioning

12. **Reposition Uploads as the AI Quick Actions knowledge base.**
    `src/pages/Uploads.tsx:65` says "Knowledge base" but does not say whose or
    what for. Rowena's exact framing, because clients are sensitive about
    handing over documents: *"The reason for the uploads will be the knowledge
    base or database for the AI Quick Actions. YOUR AI Quick Actions."* Drop any
    implication it feeds agency-side automation work.

13. **Keep the in-app chatbot's scope explicit.** Prince asked whether it is
    "like ChatGPT". It is OpenAI-backed but scoped to app context only, and he
    was fine with that once told. Say so in the UI so no client asks twice.

---

## E. Training Center — content, not code

14. **MadeEA Ready and MadeEA Academy both have to land in the Training
    Center.** Rowena: "Dalawa yun, Bryan ah, na i-concentrate natin." Marked
    ASAP — it is already in the sales material, so it will get asked about.

15. **Every lesson has `video_url: null`.** (`src/data/academySeed.ts:33`)
    Modules and titles exist; there is no video anywhere.
    - Rachel has recordings, produced via Rio — Laura to send the documents,
      Bryan to collaborate with Rachel.
    - **FJ** for an intro video for the OS itself, so it introduces itself when
      presented to a client. (Rowena: "Good thinking, Bryan.")
    - Bryan covers the AI side of the Academy content.

16. **SOPs.** Rowena: "kailangan din natin SOP natin" — in preparation for
    incoming leads. Ties to Workflows (`/sops`) and the Playbook claim that an
    EA follows a documented standard.

---

## F. Ads dashboard (separate workstream, same call)

17. **Migrate the ads dashboard from Vercel into GHL** so nobody opens two
    tabs / two apps.

18. **Metrics alone are rejected.** Prince, clearly: *"There's no point just
    having metrics if we can't do anything with the metrics."* He wants a
    clear, concise generated report over CTR, ROAS, CPL/CPA with **action
    steps** — explicitly so the team can check James's recommendations against
    an independent read and push back. Bryan needs the metric feed from James.

---

## G. Housekeeping

19. **GHL cleanup** — deactivate the Sebastian sub-account and any unused
    sub-accounts; remove the WhatsApp charge. Prince is seeing recurring
    charges he cannot account for.
20. **OS domain** — put the OS on madeea.ai (Prince agreed). The landing page
    .io domain is already connected and updated.
21. **CandyPay chatbot** — Voiceflow yearly plan expired, the chatbot is off
    the site. Confirmed as not our responsibility. No action.
22. **Access control** — confirmed working: per-feature control over what each
    account can and cannot see. Prince satisfied.

---

## Confirmed working (no action)

Task Manager (templates, drag-and-drop, priorities, repeat) · Notes two-way
sync client ↔ EA · Saved (done items move here off the board) · Password
Manager, internal only, passphrase recovery · Client Vault / client mode,
admin only · Playbook: client records a process, AI turns it into an SOP for
the EA · Voice capture → task into Task Manager · Meeting Intelligence via
Fathom connect (Bryan adding more features) · Dedicated workspace per client
answers Rowena's opening question about data isolation.
