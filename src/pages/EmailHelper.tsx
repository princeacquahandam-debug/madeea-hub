import { useEffect, useMemo, useState } from "react";
import { Sparkles, Mail, AlertTriangle, ShieldCheck, Clock } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { initials } from "@/lib/utils";
import { useClients, useMemories, useMessages, useTasks } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { generate } from "@/lib/ai";
import {
  assembleEmailContext,
  EMPTY_REPLY_OPTIONS,
  isThinEmailContext,
  REPLY_INTENTS,
  REPLY_LENGTHS,
  replyPromptInputs,
  type ReplyOptions,
} from "@/lib/emailContext";

const FILTERS = ["Needs a reply", "All"] as const;

export default function EmailHelper() {
  const { data: messages = [] } = useMessages();
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const { data: memories = [] } = useMemories();
  const cfg = useSlaSettings((s) => s.config);

  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Needs a reply");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opts, setOpts] = useState<ReplyOptions>(EMPTY_REPLY_OPTIONS);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const list = useMemo(
    () =>
      filter === "All"
        ? messages
        : messages.filter((m) => m.direction !== "outbound" && !m.first_reply_at),
    [messages, filter],
  );
  const selected = messages.find((m) => m.id === selectedId) ?? list[0] ?? null;

  useEffect(() => {
    setDraft("");
    setError("");
  }, [selectedId]);

  const ctx = useMemo(
    () =>
      selected ? assembleEmailContext({ message: selected, clients, messages, tasks, cfg, memories }) : null,
    [selected, clients, messages, tasks, cfg, memories],
  );

  async function run() {
    if (!ctx) return;
    setBusy(true);
    setError("");
    setDraft("");
    try {
      const out = await generate({
        tool: "email_reply",
        format: `${opts.intent} — ${ctx.message.subject}`,
        inputs: replyPromptInputs(ctx, opts),
      });
      setDraft(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draft the reply.");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof ReplyOptions>(k: K, v: ReplyOptions[K]) =>
    setOpts((p) => ({ ...p, [k]: v }));

  return (
    <div>
      <PageHeader
        title="Email Helper"
        subtitle="Drafts a reply that knows the client's tone, the thread so far, what you owe them, and whether you're late."
      />

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === f ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100"
            }`}
          >
            {f}
            {f === "Needs a reply" && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  filter === f ? "bg-white/20" : "bg-amber-500/20 text-amber-400"
                }`}
              >
                {messages.filter((m) => m.direction !== "outbound" && !m.first_reply_at).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {messages.length === 0 ? (
        <div className="card p-10 text-center text-sm text-faint">
          No messages yet. Connect Gmail from Integrations to populate your inbox.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          {/* ---- pick a message ---- */}
          <div className="card h-fit p-3">
            <p className="px-2 pb-2 text-xs text-faint">{list.length} messages</p>
            <div className="space-y-1">
              {list.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`flex w-full gap-3 rounded-lg p-3 text-left transition-colors ${
                    selected?.id === m.id ? "bg-surface-2" : "hover:bg-surface-2"
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[11px] font-semibold text-accent-soft">
                    {initials(m.sender_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.sender_name}</p>
                    <p className="truncate text-xs">{m.subject}</p>
                  </div>
                </button>
              ))}
              {list.length === 0 && (
                <p className="py-6 text-center text-xs text-faint">Nothing waiting on a reply.</p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {ctx && (
              <>
                {/* ---- what the draft will know ---- */}
                <section className="card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldCheck size={15} className="text-emerald-400" />
                    <h2 className="font-semibold">What the draft will know</h2>
                    {isThinEmailContext(ctx) && (
                      <span className="ml-auto text-xs text-faint">
                        Sender isn't in the Vault — limited context
                      </span>
                    )}
                  </div>

                  {ctx.lateness.instruction && (
                    <div
                      className={`mb-3 flex items-start gap-2 rounded-lg border p-3 text-xs ${
                        ctx.lateness.breached
                          ? "border-red-500/40 bg-red-500/5 text-red-200"
                          : "border-amber-500/40 bg-amber-500/5 text-amber-100"
                      }`}
                    >
                      {ctx.lateness.breached ? (
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      ) : (
                        <Clock size={14} className="mt-0.5 shrink-0" />
                      )}
                      <span>{ctx.lateness.instruction}</span>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-surface-2 p-3">
                      <p className="eyebrow mb-1">Client</p>
                      {ctx.client ? (
                        <>
                          <p className="text-sm font-medium">{ctx.client.name}</p>
                          <p className="text-xs text-faint">
                            {ctx.client.title}, {ctx.client.company}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Badge tone="reply">Tone: {ctx.client.tone || "not set"}</Badge>
                            {ctx.client.preferred_channel && (
                              <Badge tone="normal">Prefers {ctx.client.preferred_channel}</Badge>
                            )}
                          </div>
                          {ctx.client.preferences_notes && (
                            <p className="mt-2 text-xs text-muted">{ctx.client.preferences_notes}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-faint">Not in the Client Vault.</p>
                      )}
                    </div>

                    <div className="rounded-lg bg-surface-2 p-3">
                      <p className="eyebrow mb-1">What we owe them</p>
                      {ctx.openItems.length ? (
                        <ul className="space-y-1 text-xs text-muted">
                          {ctx.openItems.map((o, i) => (
                            <li key={i}>
                              {o.title} <span className="text-faint">· due {o.due}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-faint">Nothing open.</p>
                      )}
                    </div>
                  </div>

                  {ctx.memories.length > 0 && (
                    <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
                      <p className="eyebrow mb-1">Remembered about them</p>
                      <ul className="space-y-1 text-xs">
                        {ctx.memories.map((m) => (
                          <li key={m.id} className="text-muted">
                            {m.body} <span className="text-faint">— {m.why}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-3 rounded-lg bg-surface-2 p-3">
                    <p className="eyebrow mb-1">Earlier on this thread</p>
                    {ctx.thread.length ? (
                      <ul className="space-y-1.5 text-xs">
                        {ctx.thread.map((t, i) => (
                          <li key={i}>
                            <span className={t.direction === "outbound" ? "text-sky-400" : "text-accent-soft"}>
                              {t.who}
                            </span>{" "}
                            <span className="text-faint">({t.when})</span>{" "}
                            <span className="text-muted">{t.excerpt}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-faint">No earlier messages found.</p>
                    )}
                  </div>
                </section>

                {/* ---- controls ---- */}
                <section className="card p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Mail size={15} className="text-accent-soft" />
                    <h2 className="font-semibold truncate">Re: {ctx.message.subject}</h2>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="field-label">What should this do?</label>
                      <select
                        className="input"
                        value={opts.intent}
                        onChange={(e) => set("intent", e.target.value as ReplyOptions["intent"])}
                      >
                        {REPLY_INTENTS.map((i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">Length</label>
                      <select
                        className="input"
                        value={opts.length}
                        onChange={(e) => set("length", e.target.value as ReplyOptions["length"])}
                      >
                        {REPLY_LENGTHS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">Tone override</label>
                      <input
                        className="input"
                        placeholder={ctx.client?.tone || "Professional"}
                        value={opts.toneOverride}
                        onChange={(e) => set("toneOverride", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="field-label">Anything to include the app can't know</label>
                    <textarea
                      className="input min-h-[60px]"
                      placeholder="e.g. we can do Thursday but not before 2pm; the invoice went out Monday"
                      value={opts.points}
                      onChange={(e) => set("points", e.target.value)}
                    />
                  </div>

                  <button className="btn-primary mt-4 w-full" onClick={run} disabled={busy}>
                    <Sparkles size={15} />
                    {busy ? "Drafting…" : "Draft the reply"}
                  </button>
                </section>

                <section className="card p-5">
                  <p className="field-label">Draft</p>
                  {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
                  {draft ? (
                    <OutputViewer output={draft} title={`Reply — ${ctx.message.subject}`} />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-faint">
                      <Mail size={26} />
                      <p className="text-sm">Pick the intent, then draft</p>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
