import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Sparkles, Mail, AlertTriangle, MailQuestion, Wand2, Lock, Inbox, Hash } from "lucide-react";
import type { Message } from "@/types/db";
import { Badge, PageHeader } from "@/components/ui";
import { initials, cn } from "@/lib/utils";
import { generate } from "@/lib/ai";
import { useClients, useMessages } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { dayLength, formatDuration, isBreaching, responseHours, waitingHours } from "@/lib/sla";
import { useFollowUps } from "@/hooks/useFollowUps";
import { SlackComposer } from "@/components/SlackComposer";
import { ChannelRail, ChannelNotice } from "@/components/ChannelRail";
import { MessageRow } from "@/components/MessageRow";
import { REAL_CHANNELS, channelById, type ChannelId } from "@/lib/channels";
import { EmailComposer } from "@/components/EmailComposer";

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
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);
  const { data: messages = [], isLoading, refetch: refetchMessages } = useMessages();
  const { data: clients = [] } = useClients();
  const cfg = useSlaSettings((s) => s.config);
  const dl = dayLength(cfg);
  const clientFor = (m: Message) =>
    clients.find((c) => c.id === m.client_id || c.name === m.client_name) ?? null;
  const { flags } = useFollowUps();
  const deadThreads = flags.filter((f) => f.kind === "dead_thread");
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [channel, setChannel] = useState<ChannelId>("all");
  const [slackOpen, setSlackOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const deadIds = new Map(deadThreads.map((f) => [f.itemId, f]));

  /* Two independent questions, applied in order.
     The channel says WHERE a message came from; the view says WHICH of them you
     want to see. Keeping them separate is what lets Slack, WhatsApp and Discord
     drop in without touching the filters. */
  const active = channelById(channel);
  const inChannel = (m: Message) =>
    !active.source || (m as { source?: string }).source === active.source;

  const list = (
    tab === "Needs Follow-up"
      ? messages.filter((m) => deadIds.has(m.id))
      : messages.filter(TAB_FILTER[tab])
  ).filter(inChannel);

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
      <PageHeader title="Communication Center" subtitle="Triage, draft, and manage executive communications" />

      {/* One toolbar. The old page stacked a how-it-works strip, an AI action
          row, a compose row and a Slack panel before you reached a single
          message: four bands of chrome above the content. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => setComposing(true)}>
          <Wand2 size={15} /> Compose
        </button>
        {active.id === "slack" || active.id === "all" ? (
          <button className="btn-ghost border border-border" onClick={() => setSlackOpen((v) => !v)}>
            <Hash size={14} /> Slack
          </button>
        ) : null}
        <span className="mx-1 h-5 w-px bg-[var(--border-strong)]" />
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
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
        <span className="ml-auto text-xs tabular-nums text-faint">{list.length} in view</span>
      </div>

      <EmailComposer
        open={composing}
        onClose={() => setComposing(false)}
        to={selected?.sender_email ?? ""}
        subject={selected ? `Re: ${selected.subject}` : ""}
        context={selected ? `From ${selected.sender_name}: ${selected.body}` : ""}
      />

      {slackOpen && <SlackComposer onSent={() => void refetchMessages()} />}

      {isLoading ? (
        <p className="text-sm text-faint">Loading messages…</p>
      ) : messages.length === 0 ? (
        <div className="card p-10 text-center text-sm text-faint">No messages yet. Connect Gmail from Integrations to populate your inbox.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[186px_minmax(0,1fr)] xl:grid-cols-[186px_minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* Channels. Primary navigation, kept apart from the view filters. */}
          <aside className="card h-fit p-2">
            <ChannelRail active={channel} counts={counts} onSelect={setChannel} />
            {active.note && (
              <div className="mt-2 px-1">
                <ChannelNotice channel={active} />
              </div>
            )}
          </aside>

          <div className="card overflow-hidden p-0">
            <div className="divide-y divide-border">
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
                    {tab === "Needs Follow-up" ? "Nothing is waiting on a reply." : `No ${active.label === "All" ? "" : active.label + " "}messages in this view.`}
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-faint">
                    {active.id === "slack"
                      ? "Post in the channel the bot is in, then hit Slack to pull it."
                      : "Try another channel or view, or pull the latest from Integrations."}
                  </p>
                </div>
              )}
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
