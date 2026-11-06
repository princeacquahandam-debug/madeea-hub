import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, Loader2, Send } from "lucide-react";
import { AiCard, AiPanel, type AiAction } from "@/components/ai/AiResult";
import { UndoToast } from "@/components/tasks/UndoToast";
import { runQuickAction } from "@/lib/quickAi";
import {
  actionFacts, checkActions, checkReplies, checkSummary, demoActions, demoReplies, demoRewrite, demoSummary,
  replyCandidates, replyFacts, summaryFacts,
  type ProposedTask, type ReplyItem, type SummaryResult,
} from "@/lib/inboxAi";
import { useMailConnections, useTaskMutations, useTasks, useWorkspaceMembers } from "@/data/hooks";
import { useAuth } from "@/hooks/useAuth";
import { useSendEmail, textToHtml, PROVIDER_LABEL } from "@/hooks/useSendEmail";
import { providerOf } from "@/lib/mail";
import { isSupabaseConfigured } from "@/lib/supabase";
import { decodeEntities } from "@/lib/threads";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { Client, Message } from "@/types/db";

/**
 * The Inbox's three ✦ quick actions (Abder's "AI quick actions and cost"
 * deck, 6 Nov 2026): Summarize unread (card), Draft replies and Find action
 * items (side panels). They read what is in view, so the current tab, source,
 * client and search all apply, and never send or create without a click.
 * Email text goes to the model only; analytics get counts.
 */

export const INBOX_AI_HELP: Record<string, string> = {
  "Summarize unread": "the key points of the unread mail in this view and who needs a reply. Newsletters and automated mail are skipped.",
  "Draft replies": "reply drafts in your tone for up to five messages waiting on you. Nothing is sent until you confirm.",
  "Find action items": "turns requests in these emails into proposed tasks. Nothing is created until you click Create.",
};

type Kind = "summary" | "replies" | "actions";

export function useInboxAi({ inView, all, clients, viewLabel, onOpen }: {
  /** The messages the list shows now, after every filter. */
  inView: Message[];
  /** The whole mailbox, for thread history and the user's own replies. */
  all: Message[];
  clients: Client[];
  /** "All", "Needs reply", …, for the source line. */
  viewLabel: string;
  onOpen: (m: Message) => void;
}): { actions: AiAction[]; result: ReactNode } {
  const { user } = useAuth();
  const myName = user?.name ?? "";
  const { data: tasks = [] } = useTasks();
  const { data: members = [] } = useWorkspaceMembers();
  const { create, remove } = useTaskMutations();

  const [open, setOpen] = useState<Kind | null>(null);
  const [at, setAt] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ res: SummaryResult; unread: number; skipped: number } | null>(null);
  const [replies, setReplies] = useState<{ items: ReplyItem[]; candidates: Message[] } | null>(null);
  const [proposed, setProposed] = useState<{ tasks: ProposedTask[]; read: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; undo: () => void } | null>(null);
  const runId = useRef(0);

  async function run(kind: Kind) {
    const id = ++runId.current;
    setOpen(kind);
    setLoading(true);
    setError(null);
    setAt(new Date());
    const now = new Date();
    try {
      if (kind === "summary") {
        const f = summaryFacts(inView, now);
        const res = !f.unread ? { summary: "No unread messages.", rows: [] }
          : (await runQuickAction({ tool: "inbox_summary", format: "Summarize unread", inputs: f.inputs, check: (v) => checkSummary(v, f), demo: () => demoSummary(f), page: "/inbox" })).data;
        if (id === runId.current) setSummary({ res, unread: f.unread, skipped: f.skipped });
      } else if (kind === "replies") {
        const candidates = replyCandidates(inView);
        const f = replyFacts({ candidates, all, myName, now });
        const items = !candidates.length ? []
          : (await runQuickAction({ tool: "inbox_replies", format: "Draft replies", inputs: f.inputs, check: (v) => checkReplies(v, f), demo: () => demoReplies(f, myName), page: "/inbox" })).data;
        if (id === runId.current) setReplies({ items, candidates });
      } else {
        const f = actionFacts({ inView, tasks, clients, now });
        const list = !f.refs.size ? []
          : (await runQuickAction({ tool: "inbox_actions", format: "Find action items", inputs: f.inputs, check: (v) => checkActions(v, f, clients), demo: () => demoActions(f, clients), page: "/inbox" })).data;
        if (id === runId.current) setProposed({ tasks: list, read: f.refs.size });
      }
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : "Madeline couldn't be reached. Try again.");
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }
  const close = useCallback(() => { runId.current++; setOpen(null); setLoading(false); }, []);

  /** "Shorter" / "More formal" on one draft: a re-run for that item only. */
  async function rewrite(item: ReplyItem, how: "Shorter" | "More formal", draft: string): Promise<string> {
    const candidates = replies?.candidates ?? [];
    const f = replyFacts({ candidates, all, myName, now: new Date(), instruction: { ref: item.ref, text: how, draft } });
    const { data } = await runQuickAction({
      tool: "inbox_replies", format: `Draft replies: ${how}`, inputs: f.inputs,
      check: (v) => checkReplies(v, f), demo: () => [{ ...item, draft: demoRewrite(draft, how, item.message) }], page: "/inbox",
    });
    return data[0]?.draft ?? draft;
  }

  async function createTasks(list: ProposedTask[]) {
    const mine = members.find((m) => m.is_me)?.user_id ?? user?.id ?? null;
    const ids: string[] = [];
    for (const p of list) {
      const m = p.message;
      const res = await create.mutateAsync({
        title: p.title,
        client_id: p.client?.id ?? null,
        due_at: p.due,
        assignee_id: mine,
        // The link back to the email it came from (subject and sender only, never the body).
        notes: `From an email from ${decodeEntities(m.sender_name ?? "")}: "${decodeEntities(m.subject ?? "")}" (${window.location.origin}/inbox?message=${m.id})`,
      });
      ids.push(res.id);
      // Demo ids are made from the clock; a beat apart keeps them unique.
      if (!isSupabaseConfigured) await new Promise((r) => setTimeout(r, 3));
    }
    track("ai_result_applied", { action: "inbox_actions", changes_suggested: proposed?.tasks.length ?? list.length, changes_applied: ids.length });
    close();
    setToast({
      message: `Created ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`,
      undo: () => { track("ai_result_dismissed", { action: "inbox_actions", how: "undo" }); for (const id of ids) remove.mutate(id); },
    });
  }

  const hasMail = all.length > 0;
  const actions: AiAction[] = (["Summarize unread", "Draft replies", "Find action items"] as const).map((label, i) => {
    const kind = (["summary", "replies", "actions"] as const)[i];
    return { label, help: INBOX_AI_HELP[label], run: () => void run(kind), busy: loading && open === kind, disabled: !hasMail, disabledHelp: "Nothing in your inbox yet" };
  });

  const common = { at, loading, error, onClose: close, onRefresh: () => open && void run(open) };
  let result: ReactNode = null;
  if (open === "summary") {
    const res = summary?.res;
    const empty = res && !res.rows.length ? "No unread messages." : null;
    result = (
      <AiCard
        {...common}
        title="Summarize unread"
        source={summary ? `${summary.unread} unread in "${viewLabel}"${summary.skipped ? ` (${summary.skipped} automated skipped)` : ""}` : `unread mail in "${viewLabel}"`}
        summary={empty ? undefined : res?.summary}
        empty={empty}
        chat={res && res.rows.length ? `Summary of my unread mail: ${res.summary}\n${res.rows.map((r) => `${decodeEntities(r.message.sender_name ?? "")}: ${r.gist} (${r.needsReply ? "needs reply" : "FYI"})`).join("\n")}\n\nWhat should I answer first?` : undefined}
      >
        {res && (
          <ul className="divide-y divide-border">
            {res.rows.map((r) => (
              <li key={r.message.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-36 shrink-0 truncate font-semibold">{decodeEntities(r.message.sender_name ?? "")}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{r.gist}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", r.needsReply ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-[var(--chip-bg)] text-faint")}>
                  {r.needsReply ? "Needs reply" : "FYI"}
                </span>
                <button className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold transition-colors hover:bg-[var(--chip-bg)]" onClick={() => onOpen(r.message)}>Open</button>
              </li>
            ))}
          </ul>
        )}
      </AiCard>
    );
  } else if (open === "replies") {
    result = <RepliesPanel {...common} items={replies?.items ?? null} viewLabel={viewLabel} onOpen={onOpen} onRewrite={rewrite} />;
  } else if (open === "actions") {
    result = <ActionsPanel {...common} proposed={proposed} viewLabel={viewLabel} onOpen={onOpen} onCreate={createTasks} creating={create.isPending} />;
  }
  return {
    actions,
    result: <>{result}{toast && <UndoToast message={toast.message} onUndo={toast.undo} onDone={() => setToast(null)} />}</>,
  };
}

interface CommonProps { at: Date; loading: boolean; error: string | null; onClose: () => void; onRefresh: () => void }
const smallBtn = "btn-ghost border border-border px-2 py-1 text-xs";

/* ── Draft replies ── */

function RepliesPanel({ items, viewLabel, onOpen, onRewrite, ...common }: CommonProps & {
  items: ReplyItem[] | null; viewLabel: string; onOpen: (m: Message) => void;
  onRewrite: (item: ReplyItem, how: "Shorter" | "More formal", draft: string) => Promise<string>;
}) {
  const { data: conns } = useMailConnections();
  const { send } = useSendEmail();
  const list = useMemo(() => items ?? [], [items]);
  const [drafts, setDrafts] = useState<Record<string, { text: string; edited: boolean }>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, "sent" | "failed">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setDrafts(Object.fromEntries(list.map((i) => [i.ref, { text: i.draft, edited: false }])));
    setStatus({}); setConfirm(null); setErrors({});
  }, [list]);

  async function rewrite(i: ReplyItem, how: "Shorter" | "More formal") {
    setBusy((b) => ({ ...b, [i.ref]: how }));
    setErrors((e) => ({ ...e, [i.ref]: "" }));
    try {
      const text = await onRewrite(i, how, drafts[i.ref]?.text ?? i.draft);
      setDrafts((d) => ({ ...d, [i.ref]: { text, edited: false } }));
    } catch (e) {
      setErrors((x) => ({ ...x, [i.ref]: e instanceof Error ? e.message : "Couldn't rewrite it. Try again." }));
    } finally {
      setBusy((b) => { const { [i.ref]: _drop, ...rest } = b; return rest; });
    }
  }

  async function doSend(i: ReplyItem) {
    const m = i.message;
    const text = drafts[i.ref]?.text ?? "";
    setBusy((b) => ({ ...b, [i.ref]: "Send" }));
    // The same path as the reading pane's reply box: the mailbox it arrived in, threaded.
    const ok = await send({
      to: m.sender_email ?? "", subject: /^re:/i.test(m.subject ?? "") ? m.subject : `Re: ${m.subject ?? ""}`,
      text, html: textToHtml(text), provider: providerOf(m), aiDrafted: true,
      threadId: m.thread_id ?? null, inReplyTo: m.rfc_message_id ?? null, replyToOutlookId: m.outlook_id ?? null,
    });
    setStatus((s) => ({ ...s, [i.ref]: ok ? "sent" : "failed" }));
    setBusy((b) => { const { [i.ref]: _drop, ...rest } = b; return rest; });
    setConfirm(null);
    track("ai_result_applied", { action: "inbox_replies", changes_applied: ok ? 1 : 0, edited: drafts[i.ref]?.edited === true });
  }

  const sentCount = Object.values(status).filter((s) => s === "sent").length;
  return (
    <AiPanel
      {...common}
      title="Draft replies"
      source={`messages waiting on you in "${viewLabel}" and your past replies`}
      summary={list.length ? `${list.length} ${list.length === 1 ? "message needs" : "messages need"} a reply; a draft for each is below.` : undefined}
      empty={items && !list.length ? "Nothing is waiting for your reply." : null}
      chat={list.length ? `Here are reply drafts:\n${list.map((i) => `To ${decodeEntities(i.message.sender_name ?? "")} (${i.ask}): ${drafts[i.ref]?.text ?? i.draft}`).join("\n\n")}\n\nHelp me improve them.` : undefined}
      footer={
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs text-muted">{sentCount ? `${sentCount} sent.` : "Each reply goes only when you click Send and confirm."}</p>
          <button className="btn-ghost border border-border" onClick={common.onClose}>Done</button>
        </div>
      }
    >
      <ul className="space-y-3">
        {list.map((i) => {
          const m = i.message;
          const d = drafts[i.ref];
          if (!d) return null;
          const provider = providerOf(m);
          const connected = Boolean(conns?.[provider]?.connected);
          const sendHelp = !connected ? `Connect ${PROVIDER_LABEL[provider]} in Integrations to send from here.` : !m.sender_email ? "No address on this message to reply to." : "Send this reply";
          return (
            <li key={i.ref} className="rounded-lg border border-border p-3">
              <div className="mb-1.5 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{decodeEntities(m.sender_name ?? "")}</p>
                  <p className="text-xs text-muted">{i.ask}</p>
                </div>
                {status[i.ref] === "sent" && <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check size={12} /> Sent</span>}
                {status[i.ref] === "failed" && <span className="text-xs text-red-500">Not sent</span>}
              </div>
              <textarea
                className={cn("input min-h-[110px] text-xs leading-relaxed", !d.edited && "ai-filled")}
                value={d.text}
                aria-label={`Reply to ${m.sender_name}`}
                disabled={Boolean(busy[i.ref]) || status[i.ref] === "sent"}
                onChange={(e) => setDrafts((x) => ({ ...x, [i.ref]: { text: e.target.value, edited: true } }))}
              />
              {errors[i.ref] && <p className="mt-1 text-xs text-red-500">{errors[i.ref]}</p>}
              {confirm === i.ref ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs">Send to {m.sender_email}?</span>
                  <button className="btn-primary px-2.5 py-1 text-xs" disabled={busy[i.ref] === "Send"} onClick={() => void doSend(i)}>
                    {busy[i.ref] === "Send" ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Confirm send
                  </button>
                  <button className={smallBtn} onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(["Shorter", "More formal"] as const).map((how) => (
                    <button key={how} className={smallBtn} disabled={Boolean(busy[i.ref]) || status[i.ref] === "sent"} onClick={() => void rewrite(i, how)}>
                      {busy[i.ref] === how && <Loader2 size={12} className="animate-spin" />} {how}
                    </button>
                  ))}
                  <span title={sendHelp}>
                    <button className={smallBtn} disabled={!connected || !m.sender_email || !d.text.trim() || status[i.ref] === "sent" || Boolean(busy[i.ref])} onClick={() => setConfirm(i.ref)}>
                      <Send size={12} /> Send
                    </button>
                  </span>
                  <button className={cn(smallBtn, "ml-auto")} onClick={() => onOpen(m)}><ExternalLink size={12} /> Open</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </AiPanel>
  );
}

/* ── Find action items ── */

function ActionsPanel({ proposed, viewLabel, onOpen, onCreate, creating, ...common }: CommonProps & {
  proposed: { tasks: ProposedTask[]; read: number } | null; viewLabel: string;
  onOpen: (m: Message) => void; onCreate: (list: ProposedTask[]) => Promise<void>; creating: boolean;
}) {
  const list = useMemo(() => proposed?.tasks ?? [], [proposed]);
  const [titles, setTitles] = useState<Record<number, { text: string; edited: boolean }>>({});
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    setTitles(Object.fromEntries(list.map((p, i) => [i, { text: p.title, edited: false }])));
    setChecked(new Set(list.map((_, i) => i)));
    setFailed(null);
  }, [list]);
  const chosen = list.flatMap((p, i) => (checked.has(i) && titles[i]?.text.trim() ? [{ ...p, title: titles[i].text.trim() }] : []));
  const n = chosen.length;
  const due = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <AiPanel
      {...common}
      title="Find action items"
      source={`${proposed?.read ?? 0} messages in "${viewLabel}" and your open tasks`}
      summary={list.length ? `${list.length} ${list.length === 1 ? "request" : "requests"} found that ${list.length === 1 ? "isn't" : "aren't"} a task yet.` : undefined}
      empty={proposed && !list.length ? "No new requests found." : null}
      chat={list.length ? `Action items from my email:\n${list.map((p) => `- ${p.title}${p.client ? ` (${p.client.name})` : ""}${p.due ? `, due ${p.due}` : ""}`).join("\n")}\n\nHelp me plan them.` : undefined}
      footer={
        <div>
          {failed && <p className="mb-2 text-xs text-red-500">{failed}</p>}
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1 justify-center"
              disabled={!n || creating}
              onClick={() => { setFailed(null); onCreate(chosen).catch((e) => setFailed(e instanceof Error ? e.message : "Couldn't create the tasks.")); }}
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : null} Create {n} {n === 1 ? "task" : "tasks"}
            </button>
            <button className="btn-ghost border border-border" onClick={common.onClose}>Discard</button>
          </div>
        </div>
      }
    >
      <ul className="divide-y divide-border">
        {list.map((p, i) => {
          const t = titles[i];
          if (!t) return null;
          return (
            <li key={i} className="flex gap-2.5 py-3">
              <input type="checkbox" className="mt-2 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]" checked={checked.has(i)} aria-label={`Create "${t.text}"`}
                onChange={() => setChecked((s) => { const x = new Set(s); if (x.has(i)) x.delete(i); else x.add(i); return x; })} />
              <div className="min-w-0 flex-1">
                <input className={cn("input h-8 text-sm font-semibold", !t.edited && "ai-filled")} value={t.text} aria-label="Task title"
                  onChange={(e) => setTitles((x) => ({ ...x, [i]: { text: e.target.value, edited: true } }))} />
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>{p.client ? p.client.name : "No client"}</span>
                  <span>{p.due ? `Due ${due(p.due)}` : "No date in the email"}</span>
                  <button className="inline-flex items-center gap-1 font-semibold text-accent-soft hover:underline" onClick={() => onOpen(p.message)}>
                    <ExternalLink size={11} /> {decodeEntities(p.message.sender_name ?? "")}: {decodeEntities(p.message.subject ?? "").slice(0, 40)}
                  </button>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </AiPanel>
  );
}
