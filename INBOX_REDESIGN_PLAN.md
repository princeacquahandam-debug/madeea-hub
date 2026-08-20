# Inbox redesign — plan

Status: **awaiting approval. No code written yet.**
Date: 20 August 2026

Critique provenance: **two isolated sub-agents** (Assessment A design review, Assessment B detector + browser evidence), run in parallel, neither seeing the other. Not a degraded run.

---

## 1. Stack, as found

| | |
|---|---|
| Build | Vite 5, React 18, TypeScript, React Router 6 |
| Styling | Tailwind, CSS custom properties (54 tokens in `src/index.css`, wired via `theme.extend`) |
| State/data | TanStack Query v5, Zustand, Supabase |
| Icons | `lucide-react` + hand-drawn brand marks in `src/components/BrandIcons.tsx` |
| UI kit | **No shadcn/Radix.** `src/components/ui.tsx` is a small hand-rolled set |
| Screen | `src/pages/Communication.tsx`, route `/communication` (`src/App.tsx:62`), lazy |
| Data | **Real, not mocked.** 96 Gmail messages, 84 threads, live Supabase |

Children: `MessageRow`, `ChannelRail`, `ComposeWindow`, `SlackComposer`, `ClientSwitcher`, `ChannelConnections`, `GuideCard`, `lib/channels.ts`, `lib/clientMatch.ts`, `lib/relativeTime.ts`, `lib/sla.ts`.

---

## 2. Baseline critique scores (before)

Nielsen heuristics **19/40 — Poor**. Cognitive load: **5 of 8 checks fail — critical**.

| Heuristic | Score | | Heuristic | Score |
|---|---|---|---|---|
| Visibility of status | 2 | | Recognition vs recall | 2 |
| Match to real world | 2 | | Flexibility / efficiency | 1 |
| User control & freedom | 1 | | Aesthetic & minimalist | 2 |
| Consistency & standards | 2 | | Error recovery | 3 |
| Error prevention | 1 | | Help & documentation | 3 |

Detector CLI on the Communication surface: **clean (0 findings)**. In-page at-rest scan: 25 findings light / 38 dark, of which 9 light / 22 dark are in Communication itself.

---

## 3. Critique vs. the brief's §5 diagnosis

### Confirmed, and worse than stated

| §5 claim | Evidence |
|---|---|
| 1. Two competing navigations | Confirmed. 5 filter tabs + 5 rail tiles = **10 filter affordances before the first message**. `guides.ts:36` has to say "Two separate questions" in prose. |
| 2. Instruction banner | Confirmed, though it is collapsed by default and persists per page. |
| 3. Two search bars | Confirmed, both search email, no scope distinction. |
| 4. Compose floats over the reader | Confirmed. Also: **Escape does not close it**, no discard confirm, no autosave, no drafts. |
| 6. Redundant per-row channel logos | Confirmed. Gmail mark on **96/96** rows when all 96 are Gmail. |
| 7. No thread grouping or dedupe | Confirmed. 15 identical CI-failure rows, 3 identical password-reset rows. `thread_id` is populated and unused for grouping. |
| 8. Flat row anatomy | Confirmed. No unread state, no priority, no hover actions, no multi-select. |
| 10. "Soon" channels hold prime space | Confirmed. |
| 11. Contrast problems | **Far worse than stated.** 39 of 49 text pairs fail AA in light, 19 of 49 in dark. |

### Found by critique, missed by the brief — and more severe than anything in §5

| # | Finding | Evidence |
|---|---|---|
| **A** | **Clicking a message often shows nothing.** The grid declares **2 columns for 3 children** at `lg`, so between 1024–1279px the reader is auto-placed into the 56px rail column. Reader widths measured: 1920→487px · 1440→295px · 1280→231px · **1100→56px**. The reader is never `sticky`, so after scrolling a 6108px list, the message you clicked sits **3201px above the viewport**. | `Communication.tsx:287` |
| **B** | **The inbox opens on the oldest mail in the account.** Sorted `ascending: true`, no sort control. Today's mail is ~6000px down; the top four rows are duplicated Gmail onboarding spam from 8 July. | `hooks.ts:447` |
| **C** | **The reader resolves against the *unfiltered* list.** Search nonsense → header says "0 found", list says "Nothing matches", and the pane beside it still shows a live email with working Reply buttons. **Under a client scope this means replying to another client's mail from a screen that says "Showing Acme only."** | `Communication.tsx:108` |
| **D** | **The app header is clipped and unreachable at ≤1024px.** `<header>` overflows its `overflow-hidden` ancestor by 101px at 1024 and 62px at 375, with no scrollbar. **Notifications is fully off-screen at both.** | `TopBar.tsx:33` |
| **E** | **Avatar initials fail AA on every row, both themes.** `avatarHue()` fixes L/S across all 360 hues, so contrast floats with hue: measured **1.58:1 – 5.56:1**. 26 of 39 light-theme failures are this one component. | `MessageRow.tsx:71`, `relativeTime.ts:66` |
| **F** | **22 of 96 rows render raw HTML entities as text** — `&#39;`, `&amp;` appear literally in subjects. | Stored unescaped by `gmail-sync` |
| **G** | **AI Draft Response is a dead end.** Renders into `<pre>` in `ui-monospace` — an email styled as a code block. Not editable, no copy, no "use in reply". `generateDraft()` has no `catch`, so a failure looks like "nothing happened". | `Communication.tsx:406-429` |
| **H** | **Compose never shows who the email is from.** No From row at all. `useMyEmail()` is imported and used *only* to strip your own address from reply-all. For a product where one EA writes on behalf of several executives, the one field that must not be wrong is absent. | `ComposeWindow.tsx` |
| **I** | **No `aria-live` anywhere.** "0 found", "Loading…", "Drafting…", "Sent." are all silent to a screen reader. No focus-visible ring on any control; the search input declares a **transparent** 2px outline. | `index.css:533` |
| **J** | **`setCategory` has zero callers.** A wrong AI triage cannot be corrected. `is_bulk` and `triage_confidence` are computed on every message and rendered nowhere. | `hooks.ts:664` |
| **K** | `.btn-primary` is **3.19:1** — the primary button fails AA in both themes. | `index.css:541` |
| **L** | `now` never ticks: `useMemo(() => Date.now(), [messages])`. Left open all day, "5h" stays "5h". | `Communication.tsx:77` |

### Claimed in §5, **not supported by evidence**

| §5 claim | What was actually measured |
|---|---|
| **5. "Decorative orange gradient washes on list rows"** | **0 gradient backgrounds in the message list**, across 1345 elements, both themes, all three widths. There are 11 page-wide gradients. The wash is `body { background: var(--ambient-base) fixed }` showing through **translucent card surfaces** (`--card-bg: rgba(19,30,46,0.82)`, and 50% white in light). The complaint is real; the cause and therefore the fix are not what §5 says. Restyling rows would change nothing. |
| **9. "No app-level navigation… no way to get to Projects / Tasks / Clients / Time / Reporting"** | **False.** A persistent grouped sidebar already exists: 21 destinations across My Day / Clients & Files / Playbook / Insights / Setup, collapsible to an icon rail, state persisted (`lib/constants.ts:56`, `layout/Sidebar.tsx`). The screenshots were cropped. **§6's centrepiece is largely already built.** |

### One correction to the critique itself

Assessment B reported `--border-strong` as "resolves to empty string". It queried `--c-border-strong`, which does not exist; the real token is `--border-strong` and it **is** defined in both themes (`index.css:26`, `:62`). The **measurement stands** — the light-theme selected-row ring is 1.07:1 because the light value is a 17%-alpha brown on a light card — but the diagnosis was wrong. Fix is the value, not a missing declaration.

---

## 4. Target information architecture

§6 as written would ship dead links, which §6 itself forbids. Adapted to what exists:

```
Global sidebar (ALREADY EXISTS — adapt, do not rebuild)
└── Inbox  ← renamed from "Communication Center", unread badge added
    ├── Views rail — the ONLY nav inside Inbox
    │     All · Needs follow-up · Urgent · Awaiting reply · Delegated · Done
    ├── Toolbar — filters that narrow the current view
    │     Source chips (Gmail · Slack · + Connect) · Search this view · Sort · Density
    ├── Message list — threaded, virtualized
    └── Reader — sticky, own scroll, docked reply composer
```

**The key move stands:** source stops being navigation and becomes a filter. That alone deletes banner bullets 1 and 3.

**Three deviations from §6, each with a reason:**

1. **No new global sidebar.** One exists with 21 real destinations. Building Teamwork's taxonomy (Projects, Templates, People, Resourcing, Reporting, Finance) means six dead links. I will rename Communication Center → Inbox and add the unread badge, nothing more.
2. **Six views, not seven.** §6 lists Snoozed; there is no snooze in the schema and inventing one is a data-model change, which §12 forbids without asking. Dropped until you say otherwise.
3. **The client scope is a third filter** that §6 does not know about (`ClientSwitcher`, added earlier). It stays in the sidebar as app-wide context, and the Inbox toolbar shows it as a removable chip so all active filters read in one line.

---

## 5. Component tree

```
src/pages/Inbox.tsx                     (renamed from Communication.tsx)
├── InboxToolbar.tsx            NEW     search + source chips + sort + density + active-filter chips
├── ViewsRail.tsx               NEW     the single in-Inbox nav, with live counts
├── ThreadList.tsx              NEW     virtualized, grouped by thread
│   └── ThreadRow.tsx           REWRITE of MessageRow: unread dot, count chip, hover actions
├── ThreadReader.tsx            NEW     sticky, own scroll, collapsible quoted history
│   ├── AiDraftPanel.tsx        NEW     generate → drafting → inserted (Regenerate/Discard)
│   └── ReplyComposer.tsx       NEW     DOCKED in the reader, never floats
├── ComposeWindow.tsx           KEEP    compose-new only; add From, Escape, draft guard
├── GetStartedChecklist.tsx     NEW     replaces GuideCard on this route
└── ShortcutsSheet.tsx          NEW     the `?` sheet
```

Reused unchanged: `channels.ts`, `clientMatch.ts`, `relativeTime.ts`, `sla.ts`, `BrandIcons.tsx`, `SlackComposer.tsx`, `ClientSwitcher.tsx`, `ui.tsx`.

---

## 6. File-by-file change list

**Ship as 8 reviewable commits, in this order. Commits 1–2 are the P0 fixes and stand alone — they are worth merging even if you reject the rest.**

### Commit 1 — P0 correctness (no visual change)
| File | Change |
|---|---|
| `hooks.ts:447` | Sort `descending`. Newest first. |
| `Communication.tsx:108` | Resolve the reader against `list`, not `messages`. Clear selection when it leaves the filter. |
| `Communication.tsx:287` | Grid declares 3 columns at `lg`, not 2. |
| `Communication.tsx:77` | `now` ticks on an interval so relative ages stay true. |

### Commit 2 — P0 layout + a11y floor
| File | Change |
|---|---|
| `Communication.tsx` | Reader becomes `sticky top-0 max-h-[calc(100dvh-Xpx)] overflow-y-auto`. |
| `TopBar.tsx:33` | Header collapses to an overflow menu at ≤1024px so Notifications stays reachable. |
| `index.css` | `--c-faint` and `--c-muted` raised to pass AA; `--border-strong` light value raised to 3:1; `.btn-primary` text/bg to 4.5:1; real `:focus-visible` ring; remove the transparent outline at `:533`. |
| `relativeTime.ts:66` | `avatarHue` clamps lightness per hue so every avatar passes AA. |

### Commit 3 — one navigation
`ViewsRail.tsx` + `InboxToolbar.tsx` new; `ChannelRail` demoted to source chips inside the toolbar; `GuideCard` removed from this route; second search field gets `Search this view` + scope chip, global stays `Search everything`.

### Commit 4 — threads
`ThreadList.tsx` + `ThreadRow.tsx`; group by `thread_id`, count chip, unread = weight + dot (never a wash); channel badge only when >1 source is active; decode HTML entities.

### Commit 5 — reader + docked composer
`ThreadReader.tsx`, `ReplyComposer.tsx`, `AiDraftPanel.tsx`. Drafts land in the editable composer. `ComposeWindow` gains a From row, Escape, and a discard guard.

### Commit 6 — virtualization *(only if you approve the dependency)*

### Commit 7 — keyboard + shortcuts sheet
`j k Enter r c e # s d / g-i ⌘K ? Esc`, suppressed inside inputs.

### Commit 8 — rename to Inbox
`/inbox` added, `/communication` 301-style redirect kept. 17 strings across 8 files, 17 route refs across 13 files (incl. command palette, global search, notifications, focus, followups).

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Sorting newest-first changes what every user sees on open | It is the fix, but it is also the most visible single change. Ships in commit 1, alone, so it can be reverted independently. |
| Raising `--c-faint`/`--c-muted` affects **every page**, not just Inbox | Token change with app-wide blast radius. Screenshot 6 high-traffic pages before/after. |
| Thread grouping hides messages if `thread_id` is wrong | 84 threads / 96 messages, so grouping is shallow. Ungrouped fallback when `thread_id` is null. |
| Virtualization + `@dnd-kit` elsewhere | Inbox has no drag; contained. |
| Rename touches command palette and notifications | Redirect first, rename second, so a stale link never 404s. |

---

## 8. Assumption log

| # | Assumption | How to confirm |
|---|---|---|
| 1 | "Done" means `category='archive'`, which exists in `categoryLabel` but has no tab and no action | Confirm the intended semantics before wiring |
| 2 | Snooze is out of scope (no schema support) | Confirm; adding it is a data-model change |
| 3 | Unread = `direction !== 'outbound' && !first_reply_at`. There is no real `is_read` flag despite the column existing | Confirm this proxy is acceptable |
| 4 | 5,000-message perf target is aspirational; production holds 96 | Confirm whether to seed 5,000 to prove it |
| 5 | The EA sends from their own address (no delegation), so From is display-only for now | Confirm — this is the highest-stakes unknown |
| 6 | Client scope stays app-wide rather than becoming an Inbox view | Confirm |

---

## 9. Questions — I need answers to 1 and 2 before starting

1. **Do I add `@tanstack/react-virtual`?** §13.13 requires smooth at 5,000 messages; production has 96. Without it, commit 6 is dropped and acceptance criterion 13 fails. §12 requires your approval for new dependencies. **My recommendation: yes, but ship it last** so everything else lands regardless.
2. **Do I raise `--c-faint` and `--c-muted` globally?** It is the only honest fix for 39 failing pairs, and it restyles **every page in the app**, well beyond this brief's scope. **My recommendation: yes** — 2.21:1 body text is not defensible — but it needs your explicit sign-off because the blast radius is app-wide.
3. **Whose name goes on an outgoing email?** Assumption 5. If EAs ever send on behalf of an executive, From is not display-only and the composer needs an identity picker.
4. **Is "Done" the existing `archive` category, or a new state?**
5. **Do you want Snoozed?** It needs a schema column, which §12 says I must ask about.

---

## 10. What I would do differently from the brief

Per §15, building your version and showing you mine:

The brief spends most of its length on a **new global sidebar**, which already exists — while the two defects that actually break the screen (the reader is invisible at three of six widths; the inbox opens on the oldest mail) appear nowhere in §5. If you only approve one thing, approve **commit 1 and 2**. They are half a day, they fix what makes the screen unusable, and they are independent of the redesign.

The banner is a symptom worth keeping in view: it exists because two filter systems needed a sentence of prose to disambiguate. Collapsing source into a filter deletes the reason for the sentence. That part of the brief is exactly right.
