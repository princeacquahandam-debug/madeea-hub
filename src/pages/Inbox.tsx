import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/hooks/useNow";
import { useSearchParams } from "react-router-dom";
import { Sparkles, Mail, Wand2, Lock, Search, X, Reply, ReplyAll, Forward, ArrowLeft, Keyboard } from "lucide-react";
import { SlackMark } from "@/components/BrandIcons";
import type { Message } from "@/types/db";
import { Badge } from "@/components/ui";
import { initials, cn } from "@/lib/utils";
import { generate } from "@/lib/ai";
import { useClients, useMessages, useMyEmail, useMessageMutations, MESSAGE_FETCH_LIMIT } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { dayLength, formatDuration, isBreaching, responseHours, waitingHours } from "@/lib/sla";
import { useFollowUps } from "@/hooks/useFollowUps";
import { SlackComposer } from "@/components/SlackComposer";
import { ChannelNotice } from "@/components/ChannelRail";
import { SourceChips } from "@/components/SourceChips";
import { ThreadList } from "@/components/ThreadList";
import { REAL_CHANNELS, channelById, type ChannelId } from "@/lib/channels";
import { ComposeWindow, type ComposeSeed } from "@/components/ComposeWindow";
import { useClientContext } from "@/store/clientContext";
import { clientForMessage, messageInClient } from "@/lib/clientMatch";
import { groupThreads, decodeEntities } from "@/lib/threads";
import { useInboxKeys, INBOX_SHORTCUTS } from "@/hooks/useInboxKeys";
import { ClientScopeBanner } from "@/components/ClientSwitcher";

/* The only navigation inside the inbox. A view is a saved question about what
   needs you; it is not a place messages live. Source used to be a second
   navigation beside this one and is now a filter, which is what it always was.
   "Done" surfaces the archive category, which existed in the schema and in
   categoryLabel but had no tab and no action, so archived messages were
   unreachable from any filter. */
const TABS = ["All", "Needs Follow-up", "Urgent", "Awaiting Reply", "Delegated", "Done"] as const;
const categoryLabel: Record<string, string> = { urgent: "Urgent", reply: "Reply", delegate: "Delegate", archive: "Archive" };
// "Needs Follow-up" is resolved against the flag list, not a field on the message,
// so it stays in lockstep with the badge count everywhere else.
const TAB_FILTER: Record<(typeof TABS)[number], (m: Message) => boolean> = {
  All: (m) => m.category !== "archive",
  "Needs Follow-up": () => true,
  Urgent: (m) => m.category === "urgent",
  "Awaiting Reply": (m) => m.category === "reply",
  Delegated: (m) => m.category === "delegate",
  Done: (m) => m.category === "archive",
};

export default function Communication() {
  const [composing, setComposing] = useState(false);
  const [seed, setSeed] = useState<ComposeSeed | undefined>(undefined);
  const { data: messages = [], isLoading, refetch: refetchMessages } = useMessages();
  const { data: clients = [] } = useClients();
  const cfg = useSlaSettings((s) => s.config);
  const dl = dayLength(cfg);
  /* Resolves a stored link first, then the sender's address, then their
     domain. The old lookup only checked a stored client_id or a legacy name,
     and nothing writes either, so it returned null for every message and the
     SLA had no client to measure against. */
  const clientFor = (m: Message) => clientForMessage(m, clients);
  const { clientId: scopeId } = useClientContext();
  const myEmail = useMyEmail();
  const { flags } = useFollowUps();
  const deadThreads = flags.filter((f) => f.kind === "dead_thread");
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  /* A SET, because sources are now a filter and filters combine. Empty means
     all of them, which is the resting state. */
  const [sources, setSources] = useState<Set<ChannelId>>(new Set());
  const [slackOpen, setSlackOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* Distinct from `selected`, which falls back to list[0] so the desktop pane
     is never blank. On mobile the reader is an overlay, and an overlay that
     opens by itself because a fallback fired would cover the inbox the moment
     the page loaded. Only a real click opens it. */
  const [readerOpen, setReaderOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Deep link from the client activity timeline: /inbox?message=<id>
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get("message");
    if (!id) return;
    setSelectedId(id);
    setReaderOpen(true);
    setTab("All"); // the linked email may not be in the current tab
    setParams({}, { replace: true });
  }, [params, setParams]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  /* Announced to a screen reader. Nothing on this surface had aria-live, so
     "89 of 96", "Loading", "Drafting" and "Sent" were all silent, and the
     result of every action had to be discovered by hunting for it. */
  const [announcement, setAnnouncement] = useState("");
  const { setCategory } = useMessageMutations();
  const [busy, setBusy] = useState(false);

  /* Picking Slack in the rail should BE picking Slack, not picking Slack and
     then finding the button that turns Slack on. */
  const deadIds = new Map(deadThreads.map((f) => [f.itemId, f]));

  /* One clock for the whole render, and it ticks.
     Every row shows a relative age. This was `useMemo(() => Date.now(),
     [messages])`, which recomputes only when the query refetches, so a screen
     left open all morning kept insisting a message was "5h" old. A minute is
     the smallest unit any row displays, so a minute is how often it needs to
     move. Still one clock, so two rows can never disagree about the time. */
  const now = useNow(60_000);

  const inChannel = (m: Message) => {
    if (sources.size === 0) return true;
    const src = (m as { source?: string }).source;
    return [...sources].some((id) => channelById(id).source === src);
  };
  /* Named only so the empty state and the notice can say something specific
     when exactly one source is selected. With several, there is nothing
     truthful to say about "the" channel. */
  const soleSource = sources.size === 1 ? channelById([...sources][0]) : null;

  /* Picking Slack, and only Slack, opens its composer. Declared after
     soleSource because it reads it: the effect used to sit above and hit the
     temporal dead zone. */
  useEffect(() => { setSlackOpen(soleSource?.id === "slack"); }, [soleSource]);

  const q = query.trim().toLowerCase();
  const matches = (m: Message) =>
    !q ||
    [m.sender_name, m.sender_email, m.subject, m.preview, m.body]
      .some((v) => typeof v === "string" && v.toLowerCase().includes(q));

  const list = (
    tab === "Needs Follow-up"
      ? messages.filter((m) => deadIds.has(m.id))
      : messages.filter(TAB_FILTER[tab])
  )
    .filter(inChannel)
    .filter((m) => messageInClient(m, scopeId, clients))
    .filter(matches);

  /* Grouped AFTER filtering, never before. Grouping first would let a thread
     survive a filter because one old message in it matched, so "Urgent" would
     show conversations that are not urgent. */
  const threads = useMemo(() => groupThreads(list), [list]);

  /* Keyed off what is actually on screen, not off the filter.
     The first version asked whether exactly one source was SELECTED, which is
     the wrong question: with no filter at all, every message was still Gmail,
     so the badge repeated itself 89 times to say something no row disagreed
     with. Count the sources actually present in the visible list instead. */
  const showChannel = useMemo(
    () => new Set(list.map((m) => (m as { source?: string }).source ?? "")).size > 1,
    [list],
  );

  /* Per-channel counts for the rail. Counted off the unfiltered set so the
     number does not change as you move between views, which would make it
     read as a filter result rather than a channel size. */
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: messages.length };
    for (const c of REAL_CHANNELS) {
      out[c.id] = messages.filter((m) => (m as { source?: string }).source === c.source).length;
    }
    return out;
  }, [messages]);
  /* Resolved against the FILTERED list, never the whole mailbox.
     This searched `messages`, so the reader kept displaying a message the
     active filters excluded: search for nonsense and the header said "0 found"
     and the list said "Nothing matches" while a full email sat beside them with
     working Reply buttons. Under a client scope that meant replying to another
     client's mail from a screen headed "Showing Acme only", which is the kind
     of mistake you cannot take back. */
  const selected = list.find((m) => m.id === selectedId) ?? list[0] ?? null;

  useEffect(() => { setDraftError(null); }, [selectedId]);

  /* Result counts, spoken. A search that narrows 89 conversations to 2 is a
     large change that was previously visible only as a number on screen. */
  useEffect(() => {
    if (isLoading) { setAnnouncement("Loading messages"); return; }
    setAnnouncement(`${threads.length} conversation${threads.length === 1 ? "" : "s"}${q ? ` matching ${query}` : ""}`);
    // Deliberately not depending on `query`: the announcement should follow the
    // RESULT, not every keystroke, or a screen reader reads the whole alphabet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.length, isLoading]);

  /* Quoting, the way every mail client does it. Kept plain text: the body we
     hold is a Gmail snippet, and dressing a snippet up as the full original
     would imply we are quoting more than we actually have. */
  function quoted(m: Message): string {
    const when = m.received_at ? new Date(m.received_at).toLocaleString() : "earlier";
    const who = m.sender_email ? `${m.sender_name} <${m.sender_email}>` : m.sender_name;
    const esc = escapeHtml;
    const original = esc(m.body ?? m.preview ?? "")
      .split("\n")
      .map((l) => `<div>${l || "<br>"}</div>`)
      .join("");
    // Two blank lines first, so there is somewhere to type above the quote.
    return `<div><br></div><div><br></div><div>On ${esc(when)}, ${esc(who)} wrote:</div><blockquote>${original}</blockquote>`;
  }

  /* Somebody else's text becomes markup in an editable body, so it is escaped
     once, here, and both the quote and the AI draft use it. Two copies of an
     escaper is how one of them ends up missing a case. */
  const escapeHtml = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const reSubject = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);
  const fwdSubject = (s: string) => (/^fwd?:/i.test(s) ? s : `Fwd: ${s}`);

  function openReply(m: Message, all: boolean) {
    /* Reply-all means everyone who was on it, minus yourself. Leaving your own
       address in mails you a copy of everything you send, which reads as a
       product bug rather than a header mistake.
       Only YOUR address is removed. An earlier version also stripped every
       client address, which would have quietly dropped the actual recipient
       from a reply to a client: exactly backwards. */
    const me = (myEmail ?? "").toLowerCase();
    const others = all
      ? [...((m as { to_emails?: string[] }).to_emails ?? []), ...((m as { cc_emails?: string[] }).cc_emails ?? [])]
          .map((e) => e.toLowerCase())
          .filter((e) => e && e !== (m.sender_email ?? "").toLowerCase() && e !== me)
      : [];
    setSeed({
      title: all ? "Reply all" : "Reply",
      to: m.sender_email ?? "",
      cc: [...new Set(others)].join(", "),
      subject: reSubject(m.subject ?? ""),
      html: quoted(m),
      context: `From ${m.sender_name}: ${m.body}`,
      threadId: (m as { thread_id?: string | null }).thread_id ?? null,
      inReplyTo: (m as { rfc_message_id?: string | null }).rfc_message_id ?? null,
    });
    setComposing(true);
  }

  function openForward(m: Message) {
    setSeed({
      title: "Forward",
      to: "",
      subject: fwdSubject(m.subject ?? ""),
      html: quoted(m),
      context: `Forwarding a message from ${m.sender_name}: ${m.body}`,
      // A forward starts a new conversation, so deliberately no threading here.
      threadId: null,
      inReplyTo: null,
    });
    setComposing(true);
  }

  /* Generates a reply and OPENS IT, already written, in the editable composer.
     It used to render into a read-only <pre> in a monospace font: an email
     styled as a code block, with no edit, no copy button and no route into a
     reply. The product's headline feature dead-ended in text you had to select
     with a mouse. Nothing about "AI Draft Response" implies "and then retype
     it".
     The catch matters too. There was none, so a failed generate left the empty
     state showing and read to the user as "nothing happened". */
  async function generateDraft() {
    if (!selected) return;
    setBusy(true);
    setDraftError(null);
    try {
      const out = await generate({
        tool: "quick_action",
        format: "AI Draft Response",
        inputs: { from: selected.sender_name, subject: selected.subject, message: selected.body },
      });
      const written = out
        .split("\n")
        .map((l) => `<div>${l ? escapeHtml(l) : "<br>"}</div>`)
        .join("");
      setSeed({
        title: "Reply",
        to: selected.sender_email ?? "",
        subject: reSubject(selected.subject ?? ""),
        html: written + quoted(selected),
        context: `From ${selected.sender_name}: ${selected.body}`,
        threadId: (selected as { thread_id?: string | null }).thread_id ?? null,
        inReplyTo: (selected as { rfc_message_id?: string | null }).rfc_message_id ?? null,
      });
      setComposing(true);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /* The reader's contents, rendered in two places: the sticky desktop column
     and the mobile overlay below. Extracted rather than duplicated, so a
     change to how a message reads cannot silently apply to only one of the
     two screens people actually use. */
  const readerBody = (
    <>
            {selected ? (
              <>
                <div className="flex items-center gap-3 border-b border-border pb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-soft">
                    {initials(selected.sender_name)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{selected.sender_name}</p>
                    {selected.client_title && <p className="text-xs text-faint">{selected.client_title}</p>}
                  </div>
                  <Badge tone={selected.category}>{categoryLabel[selected.category]}</Badge>
                </div>

                {/* What the pane never had. The "Reply" chip above is the triage
                    CATEGORY, not an action, and there was no way to answer a
                    message from the screen you read it on. */}
                {/* Compact enough to stay on one line in a narrow reading
                    pane. At full button size these wrapped onto two rows and
                    pushed the message itself further down the very column that
                    exists to show it. */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => openReply(selected, false)}>
                    <Reply size={13} /> Reply
                  </button>
                  <button
                    className="btn-ghost border border-border px-2.5 py-1.5 text-xs"
                    onClick={() => openReply(selected, true)}
                    // Only meaningful when somebody else was actually on it.
                    disabled={
                      ([...((selected as { to_emails?: string[] }).to_emails ?? []),
                        ...((selected as { cc_emails?: string[] }).cc_emails ?? [])].length < 2)
                    }
                    title={
                      ([...((selected as { to_emails?: string[] }).to_emails ?? []),
                        ...((selected as { cc_emails?: string[] }).cc_emails ?? [])].length < 2)
                        ? "Only one recipient, so this is the same as Reply"
                        : "Reply to everyone on this message"
                    }
                  >
                    <ReplyAll size={13} /> Reply all
                  </button>
                  <button className="btn-ghost border border-border px-2.5 py-1.5 text-xs" onClick={() => openForward(selected)}>
                    <Forward size={13} /> Forward
                  </button>
                  {/* One control, not a label and a button saying the same six
                      words 40px apart, and it opens the reply rather than
                      printing text beside it. */}
                  <button
                    className="btn-ghost border border-border px-2.5 py-1.5 text-xs"
                    onClick={generateDraft}
                    disabled={busy}
                  >
                    <Sparkles size={13} /> {busy ? "Writing…" : "Draft a reply"}
                  </button>
                </div>

                {selected.triage_reason && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-faint">
                    {selected.category_locked ? <Lock size={12} className="mt-px shrink-0" /> : <Wand2 size={12} className="mt-px shrink-0" />}
                    <span>
                      {selected.triage_reason}
                      {selected.triage_source === "ai" && " · sorted by AI"}
                      {selected.triage_source === "rules" && " · matched a team rule"}
                    </span>
                  </p>
                )}

                <div className="mt-4">
                  <p className="field-label">Original Message</p>
                  <div className="rounded-lg bg-surface-2 p-3">
                    <p className="text-sm font-medium">{decodeEntities(selected.subject ?? "")}</p>
                    <p className="mt-1 text-sm text-muted">{decodeEntities(selected.body ?? "")}</p>
                  </div>
                </div>

                {draftError && (
                  <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-200">
                    Could not write a draft. {draftError.slice(0, 160)}
                  </p>
                )}
              </>
            ) : <p className="py-10 text-center text-sm text-faint">Select a message.</p>}
    </>
  );

  /* Moving selection is state, not focus. The list is virtualized, so the row
     you want may not be in the DOM at all, and focus-based movement would stall
     at the edge of the rendered window. */
  function move(delta: number) {
    if (threads.length === 0) return;
    const i = threads.findIndex((t) => t.head.id === selected?.id);
    const next = threads[Math.min(Math.max((i < 0 ? 0 : i) + delta, 0), threads.length - 1)];
    if (!next) return;
    setSelectedId(next.head.id);
    setAnnouncement(`${decodeEntities(next.head.sender_name ?? "")}. ${decodeEntities(next.head.subject ?? "")}`);
  }

  /* Triage from the keyboard, and the first callers setCategory has ever had.
     The mutation existed with none, so a wrong AI triage could not be corrected
     and archived mail was unreachable. */
  function triage(category: Message["category"], said: string) {
    if (!selected) return;
    setCategory.mutate({ id: selected.id, category });
    setAnnouncement(`${said}: ${decodeEntities(selected.subject ?? "")}`);
  }

  useInboxKeys({
    next: () => move(1),
    prev: () => move(-1),
    open: () => { if (selected) { setSelectedId(selected.id); setReaderOpen(true); } },
    reply: () => { if (selected) openReply(selected, false); },
    compose: () => { setSeed({ title: "Write an email" }); setComposing(true); },
    archive: () => triage("archive", "Archived"),
    done: () => triage("archive", "Marked done"),
    delegate: () => triage("delegate", "Delegated"),
    search: () => (document.getElementById("inbox-search") as HTMLInputElement | null)?.focus(),
    help: () => setShowHelp((v) => !v),
    escape: () => {
      if (showHelp) { setShowHelp(false); return; }
      if (readerOpen) { setReaderOpen(false); return; }
      if (query) setQuery("");
    },
  }, !composing);

  function toggleSource(id: ChannelId) {
    setSources((prev) => {
      if (id === "all") return new Set();
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {/* ONE row where there were three.
          The page opened with a 3xl heading, a subtitle, a search row and a tab
          row: roughly 380px of chrome before the first message, on a screen
          where the messages ARE the page. Title, search and actions share a
          line now, the way a mail client does it, because "Communication
          Center" is already the highlighted item in the sidebar and repeating
          it at 30px tells nobody anything they learned two seconds ago. */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h1 className="shrink-0 text-lg font-semibold">Communication Center</h1>

        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <label htmlFor="inbox-search" className="sr-only">Search this inbox</label>
          <input
            id="inbox-search"
            className="input h-10 pl-9 pr-9"
            placeholder="Search sender, subject or message…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-[var(--chip-bg)] hover:text-text"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          className="btn-primary h-10 shrink-0"
          onClick={() => { setSeed({ title: "Write an email" }); setComposing(true); }}
        >
          <Wand2 size={15} /> Compose
        </button>
        {/* A visible way into the shortcuts, because a keyboard feature nobody
            can find is not a feature. Hidden below sm on purpose rather than by
            accident: a phone has no physical keyboard, so the sheet would list
            eleven things you cannot press. `?` still opens it anywhere a
            keyboard exists. */}
        <button
          onClick={() => setShowHelp(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-faint transition-colors hover:bg-[var(--chip-bg)] hover:text-text sm:grid"
        >
          <Keyboard size={16} />
        </button>
        {(sources.size === 0 || sources.has("slack")) && (
          <button
            className="btn-ghost h-10 shrink-0 border border-border"
            aria-pressed={slackOpen}
            onClick={() => setSlackOpen((v) => !v)}
          >
            <SlackMark size={14} /> {slackOpen ? "Hide Slack" : "Slack"}
          </button>
        )}
      </div>

      {/* View filters. Quieter than before: these narrow a list you are already
          looking at, so they are secondary to it and should not compete with
          the primary action beside them (§9 nav-hierarchy). */}
      {/* Source, as a filter under the views. One hierarchy: the row above says
          WHAT you are looking at, this row narrows it. Neither is a place. */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <SourceChips active={sources} counts={counts} onToggle={toggleSource} />
      </div>

      <div className="mb-2.5 flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "min-h-[30px] rounded-full px-2.5 text-xs font-medium transition-colors",
              tab === t
                ? "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]"
                : "text-faint hover:bg-[var(--chip-bg)] hover:text-text",
            )}
          >
            {t}
            {t === "Needs Follow-up" && deadThreads.length > 0 && (
              <span className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                tab === t ? "bg-amber-500/25 text-amber-300" : "bg-amber-500/20 text-amber-400",
              )}>
                {deadThreads.length}
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs tabular-nums text-faint">
          {threads.length} {q ? "found" : threads.length === list.length ? "in view" : `of ${list.length}`}
          {messages.length >= MESSAGE_FETCH_LIMIT && (
            /* The cap was invisible before. A mailbox bigger than the fetch
               limit looked complete, which is the kind of quiet lie that makes
               someone conclude a message was never received. */
            <span className="ml-2" title={`Only the newest ${MESSAGE_FETCH_LIMIT} messages are loaded`}>
              · newest {MESSAGE_FETCH_LIMIT}
            </span>
          )}
        </span>
      </div>

      <ClientScopeBanner note="Messages are matched to a client by their sender's email domain." />

      {/* Announced, never shown. Selection changes, triage results and load
          states were all silent to a screen reader, so the only way to learn
          what an action did was to go looking for it. `polite` so it waits for
          a pause rather than interrupting. */}
      <div aria-live="polite" role="status" className="sr-only">{announcement}</div>

      {showHelp && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowHelp(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[var(--border-strong)] bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Keyboard size={16} className="text-accent" />
              <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
              <button
                onClick={() => setShowHelp(false)}
                aria-label="Close"
                className="ml-auto grid h-7 w-7 place-items-center rounded text-faint hover:bg-[var(--chip-bg)] hover:text-text"
              >
                <X size={14} />
              </button>
            </div>
            <dl className="space-y-1.5">
              {INBOX_SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-baseline gap-3 text-[12.5px]">
                  <dt className="w-24 shrink-0">
                    <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">{s.keys}</kbd>
                  </dt>
                  <dd className="text-muted">{s.does}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-border pt-2.5 text-[11.5px] text-faint">
              Shortcuts do not fire while you are typing in a field or writing an email.
            </p>
          </div>
        </div>
      )}

      {/* Below lg the reader is an overlay, not a third column.
          Squashing three panes into a phone gives a 56px reader; stacking them
          puts the message 6000px below the list, which is what used to happen
          and made tapping a row look like a no-op. An overlay is the only
          arrangement where tapping a message on a phone shows the message. */}
      {readerOpen && selected && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg lg:hidden" role="dialog" aria-label="Message">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <button
              onClick={() => setReaderOpen(false)}
              className="btn-ghost border border-border px-2.5 py-1.5 text-xs"
              autoFocus
            >
              <ArrowLeft size={14} /> Inbox
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{selected.sender_name}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{readerBody}</div>
        </div>
      )}

      <ComposeWindow
        open={composing}
        onClose={() => setComposing(false)}
        seed={seed}
      />

      {slackOpen && <SlackComposer onSent={() => void refetchMessages()} />}

      {isLoading ? (
        <p className="text-sm text-faint">Loading messages…</p>
      ) : messages.length === 0 ? (
        <div className="card p-10 text-center text-sm text-faint">No messages yet. Connect Gmail from Integrations to populate your inbox.</div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {soleSource?.note && (
              <div className="mb-2">
                <ChannelNotice channel={soleSource} />
              </div>
            )}
            <ThreadList
              threads={threads}
              selectedId={selected?.id ?? null}
              clients={clients}
              cfg={cfg}
              now={now}
              showChannel={showChannel}
              clientFor={clientFor}
              onSelect={(m) => { setSelectedId(m.id); setReaderOpen(true); }}
              emptyState={
  <div className="px-4 py-10 text-center">
                      <p className="text-sm font-medium">
                        {q
                          ? `Nothing matches "${query}".`
                          : tab === "Needs Follow-up"
                            ? "Nothing is waiting on a reply."
                            : `No ${soleSource ? soleSource.label + " " : ""}messages in this view.`}
                      </p>
                      <p className="mx-auto mt-1 max-w-sm text-xs text-faint">
                        {/* Names the actual reason a Slack inbox is empty. Nine
                            times out of ten it is not that nobody has spoken, it
                            is that the bot was never invited, and those look
                            identical from here. */}
                        {scopeId
                          ? "You are filtered to one client, and a message only counts as theirs once their email domain is set on the client record."
                          : q
                          ? "Try a different word, or clear the search."
                          : soleSource?.id === "slack"
                            ? "Slack only shows channels the bot was invited to. Run /invite @MadeEA OS in the channel, then Pull messages."
                            : "Try another channel or view, or pull the latest from Integrations."}
                      </p>
                    </div>
              }
            />
          </div>

          {/* Sticky, with its own scroll.
              The list runs to 6108px and both grid children stretch to match,
              so a reader pinned to the top of that column sat thousands of
              pixels above the viewport the moment you scrolled. Measured after
              a 4000px scroll: the message you had just clicked was 3594px off
              screen. Clicking a row appeared to do nothing, which is the single
              most common action here. */}
          <div className="card hidden max-h-[calc(100dvh-7rem)] self-start overflow-y-auto p-5 lg:sticky lg:top-4 lg:block">
            {readerBody}
          </div>
        </div>
      )}
    </div>
  );
}
