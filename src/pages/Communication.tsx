import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles, Mail, Wand2, Lock, Search, X, Reply, ReplyAll, Forward } from "lucide-react";
import { SlackMark } from "@/components/BrandIcons";
import type { Message } from "@/types/db";
import { Badge, PageHeader } from "@/components/ui";
import { initials, cn } from "@/lib/utils";
import { generate } from "@/lib/ai";
import { useClients, useMessages, useMyEmail } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { dayLength, formatDuration, isBreaching, responseHours, waitingHours } from "@/lib/sla";
import { useFollowUps } from "@/hooks/useFollowUps";
import { SlackComposer } from "@/components/SlackComposer";
import { ChannelRail, ChannelNotice } from "@/components/ChannelRail";
import { MessageRow } from "@/components/MessageRow";
import { REAL_CHANNELS, channelById, type ChannelId } from "@/lib/channels";
import { ComposeWindow, type ComposeSeed } from "@/components/ComposeWindow";
import { useClientContext } from "@/store/clientContext";
import { clientForMessage, messageInClient } from "@/lib/clientMatch";
import { ClientScopeBanner } from "@/components/ClientSwitcher";

const TABS = ["All", "Needs Follow-up", "Urgent", "Awaiting Reply", "Delegated"] as const;
const categoryLabel: Record<string, string> = { urgent: "Urgent", reply: "Reply", delegate: "Delegate", archive: "Archive" };
// "Needs Follow-up" is resolved against the flag list, not a field on the message,
// so it stays in lockstep with the badge count everywhere else.
const TAB_FILTER: Record<(typeof TABS)[number], (m: Message) => boolean> = {
  All: () => true,
  "Needs Follow-up": () => true,
  Urgent: (m) => m.category === "urgent",
  "Awaiting Reply": (m) => m.category === "reply",
  Delegated: (m) => m.category === "delegate",
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
  const [channel, setChannel] = useState<ChannelId>("all");
  const [slackOpen, setSlackOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Deep link from the client activity timeline: /communication?message=<id>
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get("message");
    if (!id) return;
    setSelectedId(id);
    setTab("All"); // the linked email may not be in the current tab
    setParams({}, { replace: true });
  }, [params, setParams]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  /* Picking Slack in the rail should BE picking Slack, not picking Slack and
     then finding the button that turns Slack on. */
  useEffect(() => { setSlackOpen(channel === "slack"); }, [channel]);

  const deadIds = new Map(deadThreads.map((f) => [f.itemId, f]));

  /* One clock for the whole render. Every row shows a relative age, and letting
     each compute its own Date.now() means two rows a millisecond apart can
     disagree about which minute it is. */
  const now = useMemo(() => Date.now(), [messages]);

  const active = channelById(channel);
  const inChannel = (m: Message) =>
    !active.source || (m as { source?: string }).source === active.source;

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
  const selected = messages.find((m) => m.id === selectedId) ?? list[0] ?? null;

  useEffect(() => { setDraft(""); }, [selectedId]);

  /* Quoting, the way every mail client does it. Kept plain text: the body we
     hold is a Gmail snippet, and dressing a snippet up as the full original
     would imply we are quoting more than we actually have. */
  function quoted(m: Message): string {
    const when = m.received_at ? new Date(m.received_at).toLocaleString() : "earlier";
    const who = m.sender_email ? `${m.sender_name} <${m.sender_email}>` : m.sender_name;
    /* Escaped before it is embedded. The original is somebody else's text, and
       a subject or body containing markup would otherwise become live markup in
       the editor and then in what we send. */
    const esc = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const original = esc(m.body ?? m.preview ?? "")
      .split("\n")
      .map((l) => `<div>${l || "<br>"}</div>`)
      .join("");
    // Two blank lines first, so there is somewhere to type above the quote.
    return `<div><br></div><div><br></div><div>On ${esc(when)}, ${esc(who)} wrote:</div><blockquote>${original}</blockquote>`;
  }

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

  async function generateDraft() {
    if (!selected) return;
    setBusy(true);
    setDraft("");
    try {
      const out = await generate({
        tool: "quick_action",
        format: "AI Draft Response",
        inputs: { from: selected.sender_name, subject: selected.subject, message: selected.body },
      });
      setDraft(out);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Communication Center" subtitle="Every channel your clients reach you on, in one inbox" />

      {/* Search across the inbox. Distinct from the global search in the top
          bar, which spans clients and tasks: this one narrows the list you are
          looking at, which is why it sits with the list. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
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
        {(active.id === "slack" || active.id === "all") && (
          <button
            className="btn-ghost h-10 shrink-0 border border-border"
            aria-pressed={slackOpen}
            onClick={() => setSlackOpen((v) => !v)}
          >
            <SlackMark size={14} /> {slackOpen ? "Hide Slack" : "Slack"}
          </button>
        )}
      </div>

      {/* View filters, kept apart from the channel rail: the rail picks WHERE
          messages came from, these pick WHICH of them you are looking at. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "min-h-[34px] rounded-full px-3 text-xs font-medium transition-colors",
              tab === t ? "bg-accent text-white" : "text-muted hover:bg-[var(--chip-bg)] hover:text-text",
            )}
          >
            {t}
            {t === "Needs Follow-up" && deadThreads.length > 0 && (
              <span className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                tab === t ? "bg-white/20" : "bg-amber-500/20 text-amber-400",
              )}>
                {deadThreads.length}
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs tabular-nums text-faint">
          {list.length} {q ? "found" : "in view"}
        </span>
      </div>

      <ClientScopeBanner note="Messages are matched to a client by their sender's email domain." />

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
        <div className="grid gap-3 lg:grid-cols-[60px_minmax(0,1fr)] xl:grid-cols-[60px_minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* The rail. Its own column so it reads as an edge, not a panel. */}
          <aside className="card h-fit p-2">
            <ChannelRail active={channel} counts={counts} onSelect={setChannel} />
          </aside>

          <div className="min-w-0">
            {active.note && (
              <div className="mb-2">
                <ChannelNotice channel={active} />
              </div>
            )}
            <div className="card p-1.5">
              <div className="space-y-0.5">
                {list.map((m) => {
                  const late = isBreaching(m, clientFor(m), cfg);
                  const waiting = waitingHours(m, cfg);
                  // Only an UNANSWERED breach is actionable. An answered-but-late
                  // thread is history: worth recording, but flagging it red
                  // implies work that no longer exists.
                  const breached = late && waiting !== null;
                  return (
                    <MessageRow
                      key={m.id}
                      m={m}
                      now={now}
                      selected={selected?.id === m.id}
                      breached={breached}
                      waitingLabel={waiting !== null ? formatDuration(waiting, dl) : undefined}
                      onSelect={() => setSelectedId(m.id)}
                    />
                  );
                })}
                {list.length === 0 && (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium">
                      {q
                        ? `Nothing matches "${query}".`
                        : tab === "Needs Follow-up"
                          ? "Nothing is waiting on a reply."
                          : `No ${active.label === "All" ? "" : active.label + " "}messages in this view.`}
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
                        : active.id === "slack"
                          ? "Slack only shows channels the bot was invited to. Run /invite @MadeEA OS in the channel, then Pull messages."
                          : "Try another channel or view, or pull the latest from Integrations."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card p-5">
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
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-primary py-1.5" onClick={() => openReply(selected, false)}>
                    <Reply size={14} /> Reply
                  </button>
                  <button
                    className="btn-ghost border border-border py-1.5"
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
                    <ReplyAll size={14} /> Reply all
                  </button>
                  <button className="btn-ghost border border-border py-1.5" onClick={() => openForward(selected)}>
                    <Forward size={14} /> Forward
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
                    <p className="text-sm font-medium">{selected.subject}</p>
                    <p className="mt-1 text-sm text-muted">{selected.body}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="field-label mb-0">AI Draft Response</p>
                    <button className="btn-primary py-1.5" onClick={generateDraft} disabled={busy}>
                      <Sparkles size={14} /> {busy ? "Drafting…" : "AI Draft Response"}
                    </button>
                  </div>
                  {draft ? (
                    <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm text-zinc-200">{draft}</pre>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-center text-faint">
                      <Mail size={24} />
                      <p className="text-xs">Click "AI Draft Response" to generate a professional reply</p>
                    </div>
                  )}
                </div>
              </>
            ) : <p className="py-10 text-center text-sm text-faint">Select a message.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
