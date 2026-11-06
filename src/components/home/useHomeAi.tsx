import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarPlus, Check, Copy, ExternalLink, Send } from "lucide-react";
import { AiCard, AiPanel, type AiAction } from "@/components/ai/AiResult";
import { runQuickAction } from "@/lib/quickAi";
import {
  catchFacts, checkCatchUp, checkFollowUps, checkPlan, demoCatchUp, demoFollowUps, demoPlan, fetchChanges, followFacts,
  planFacts, readLastVisit, shiftFor, visitLabel, writeLastVisit,
  type CatchResult, type FollowItem, type FollowResult, type PlanResult, type PlanRow,
} from "@/lib/homeAi";
import {
  useCalendarTimezone, useClients, useCreateCalendarEvent, useGoogleConnection, useMailConnections, useMeetings, useMessages,
  useTasks, useTimeEntries, useTimeSettings, useWorkspaceMembers,
} from "@/data/hooks";
import { useAuth } from "@/hooks/useAuth";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useSendEmail, textToHtml } from "@/hooks/useSendEmail";
import { useClientContext } from "@/store/clientContext";
import { providerOf } from "@/lib/mail";
import { instantFor } from "@/lib/workday";
import { isSupabaseConfigured } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { Meeting } from "@/types/db";

/**
 * Home's three ✦ quick actions (Abder's "AI quick actions and cost" deck,
 * 6 Nov 2026, "start the day"): Plan my day and Catch me up are cards above
 * the dashboard; Draft follow-ups is a side panel because it ends in sending.
 * Only one result is open at a time. Returns the buttons for beside the title
 * and the open result for under it.
 */

export const HOME_AI_HELP: Record<string, string> = {
  "Plan my day": "builds a time-blocked plan for today from your meetings, tasks and follow-ups, with the EOD report last.",
  "Catch me up": "what other people changed since you were last here: tasks, emails and the team.",
  "Draft follow-ups": "a short message for each item that has gone quiet. Nothing is sent until you confirm.",
};

type Kind = "plan" | "catch" | "follow";

export function useHomeAi({ onOpenMeeting }: { onOpenMeeting: (m: Meeting) => void }): { actions: AiAction[]; result: ReactNode } {
  const nav = useNavigate();
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings({ mine: true });
  const { data: messages = [] } = useMessages();
  const { data: clients = [] } = useClients();
  const { data: members = [] } = useWorkspaceMembers();
  const { data: entries = [] } = useTimeEntries();
  const { data: timeSettings } = useTimeSettings();
  const { clientId: scopeId } = useClientContext();
  const { flags } = useFollowUps();

  /* Who "me" is: the login, my membership row, and in demo the stand-in actor
     the demo store writes my own edits as. Changes by these are not news. */
  const me = useMemo(() => {
    const s = new Set<string>([uid]);
    const mine = members.find((m) => m.is_me)?.user_id;
    if (mine) s.add(mine);
    if (!isSupabaseConfigured) s.add("demo");
    s.delete("");
    return s;
  }, [uid, members]);
  const name = (id: string | null | undefined) => members.find((m) => m.user_id === id)?.name ?? (id && me.has(id) ? "You" : "A teammate");
  const myTasks = useMemo(
    () => tasks.filter((t) => (t.assignee_id ? me.has(t.assignee_id) : Boolean(t.owner_id && me.has(t.owner_id))) && (!scopeId || t.client_id === scopeId)),
    [tasks, me, scopeId],
  );

  /* "Since you were last here" is read once, on arrival, and written when Home
     is left (or the tab closes). Writing it as soon as Catch me up is shown
     would make Run again say "nothing new since just now" and lose the window
     if the card was closed unread. A ref, so React's dev double-mount cannot
     read back the time its own cleanup just wrote. */
  const since = useRef<Date | null>(null);
  if (uid && !since.current) since.current = readLastVisit(uid);
  useEffect(() => {
    if (!uid) return;
    const save = () => writeLastVisit(uid);
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("pagehide", save); save(); };
  }, [uid]);

  const [open, setOpen] = useState<Kind | null>(null);
  const [at, setAt] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [catchUp, setCatchUp] = useState<CatchResult | null>(null);
  const [follow, setFollow] = useState<FollowResult | null>(null);
  const runId = useRef(0);

  async function run(kind: Kind) {
    const id = ++runId.current;
    setOpen(kind);
    setLoading(true);
    setError(null);
    setAt(new Date());
    const now = new Date();
    try {
      if (kind === "plan") {
        const shift = shiftFor(now, entries.filter((e) => !e.owner_id || me.has(e.owner_id)), timeSettings?.daily_hours ?? 8);
        const f = planFacts({ now, meetings, tasks: myTasks, flags, shift, name });
        // Nothing to plan is answered here: no call, no cost.
        const res = f.empty ? demoPlan(f, now)
          : (await runQuickAction({ tool: "home_plan_day", format: "Plan my day", inputs: f.inputs, check: (v) => checkPlan(v, f), demo: () => demoPlan(f, now), page: "/" })).data;
        if (id === runId.current) setPlan(res);
      } else if (kind === "catch") {
        const s = since.current ?? new Date(Date.now() - 86_400_000);
        const label = visitLabel(s, now);
        const changes = await fetchChanges({ since: s, me, tasks, messages, name });
        const res = !changes.length ? { summary: `Nothing new since ${label}.`, groups: [] }
          : (await runQuickAction({ tool: "home_catch_up", format: "Catch me up", inputs: catchFacts(changes, label), check: (v) => checkCatchUp(v, changes, label), demo: () => demoCatchUp(changes, label), page: "/" })).data;
        if (id === runId.current) setCatchUp(res);
      } else {
        const f = followFacts({ flags, messages, tasks, clients, myName: user?.name ?? "", now });
        const res = !f.items.size ? { summary: "Nothing has gone quiet.", items: [] }
          : (await runQuickAction({ tool: "home_follow_ups", format: "Draft follow-ups", inputs: f.inputs, check: (v) => checkFollowUps(v, f), demo: () => demoFollowUps(f, now), page: "/" })).data;
        if (id === runId.current) setFollow(res);
      }
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : "Madeline couldn't be reached. Try again.");
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }
  const close = () => { runId.current++; setOpen(null); setLoading(false); };

  const actions: AiAction[] = [
    { label: "Plan my day", help: HOME_AI_HELP["Plan my day"], run: () => void run("plan"), busy: loading && open === "plan" },
    { label: "Catch me up", help: HOME_AI_HELP["Catch me up"], run: () => void run("catch"), busy: loading && open === "catch" },
    { label: "Draft follow-ups", help: HOME_AI_HELP["Draft follow-ups"], run: () => void run("follow"), busy: loading && open === "follow" },
  ];

  const common = { at, loading, error, onClose: close, onRefresh: () => open && void run(open) };
  let result: ReactNode = null;
  if (open === "plan") {
    const empty = plan && !plan.rows.length ? "Nothing is due or scheduled today." : null;
    result = (
      <AiCard
        {...common}
        title="Plan my day"
        source="your tasks, today's meetings and follow-ups"
        summary={empty ? undefined : plan?.summary}
        empty={empty}
        chat={plan && plan.rows.length ? `Here is my plan for today:\n${plan.summary}\n${plan.rows.map((r) => `${r.time}–${r.end} ${r.action} (${r.reason})`).join("\n")}\n\nHelp me adjust it.` : undefined}
        footer={plan && plan.rows.length ? <AddToCalendar plan={plan} /> : undefined}
      >
        {plan && <PlanRows rows={plan.rows} onOpen={(r) => {
          if (r.meeting) onOpenMeeting(r.meeting);
          else if (r.task) nav(`/tasks?task=${r.task.id}`);
          else if (r.flag) nav(r.flag.itemType === "message" ? `/inbox?message=${r.flag.itemId}` : `/tasks?task=${r.flag.itemId}`);
          else nav("/eod");
        }} />}
      </AiCard>
    );
  } else if (open === "catch") {
    const empty = catchUp && !catchUp.groups.length ? catchUp.summary : null;
    result = (
      <AiCard
        {...common}
        title="Catch me up"
        source={`changes by others since ${visitLabel(since.current ?? new Date())}`}
        summary={empty ? undefined : catchUp?.summary}
        empty={empty}
        chat={catchUp && catchUp.groups.length ? `Catch me up. ${catchUp.summary}\n${catchUp.groups.map((g) => `${g.group}: ${g.items.map((i) => i.text).join("; ")}`).join("\n")}\n\nWhat should I look at first?` : undefined}
      >
        {catchUp && (
          <div className="grid gap-3 sm:grid-cols-3">
            {catchUp.groups.map((g) => (
              <div key={g.group}>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">{g.group}</p>
                <ul className="space-y-1">
                  {g.items.map((i, n) => (
                    <li key={n}><Link to={i.link} className="text-sm hover:text-accent hover:underline">{i.text}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </AiCard>
    );
  } else if (open === "follow") {
    result = (
      <FollowUpsPanel
        {...common}
        result={follow}
        onOpen={(it) => nav(it.message ? `/inbox?message=${it.message.id}` : `/tasks?task=${it.flag.itemId}`)}
      />
    );
  }
  return { actions, result };
}

/* ── Plan my day ── */

const OPEN_LABEL: Record<PlanRow["kind"], string> = { meeting: "Open meeting", task: "Open task", followup: "Follow up", eod: "Open EOD" };

function PlanRows({ rows, onOpen }: { rows: PlanRow[]; onOpen: (r: PlanRow) => void }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r, i) => (
        <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <span className="w-[92px] shrink-0 text-xs font-semibold tabular-nums text-muted">{r.time}–{r.end}</span>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate font-semibold", r.kind === "meeting" && "text-[color:var(--nav-active-text)]")}>{r.action}</p>
            <p className="truncate text-xs text-muted">{r.reason}</p>
          </div>
          <button className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold transition-colors hover:bg-[var(--chip-bg)]" onClick={() => onOpen(r)}>
            {OPEN_LABEL[r.kind]}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Books the plan's own blocks (not the meetings, which are already there) the
 * way Calendar's "Plan the Calendar" does. Without a Google connection that
 * may write, it opens the Calendar on today instead of failing.
 */
function AddToCalendar({ plan }: { plan: PlanResult }) {
  const nav = useNavigate();
  const { data: google } = useGoogleConnection();
  const { data: calTz } = useCalendarTimezone();
  const create = useCreateCalendarEvent();
  const [state, setState] = useState<{ busy: boolean; done: number; error: string | null }>({ busy: false, done: 0, error: null });
  const blocks = plan.rows.filter((r) => r.kind !== "meeting");
  const canBook = isSupabaseConfigured && Boolean((google as { canCreate?: boolean } | undefined)?.canCreate);

  async function book() {
    if (!canBook) { nav(`/calendar?date=${plan.date}`); return; }
    const tz = calTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    setState({ busy: true, done: 0, error: null });
    let done = 0;
    try {
      // One at a time, as Calendar does: parallel inserts get rate-limited into a half-booked day.
      for (const r of blocks) {
        await create.mutateAsync({ title: r.action, startsAt: instantFor(plan.date, r.time, tz), endsAt: instantFor(plan.date, r.end, tz), timeZone: tz, description: `Planned in MadeEA OS: ${r.reason}` });
        done++;
      }
      track("ai_result_applied", { action: "home_plan_day", changes_applied: done });
      setState({ busy: false, done, error: null });
    } catch (e) {
      setState({ busy: false, done, error: e instanceof Error ? e.message : "Could not add the blocks." });
    }
  }

  if (state.done && !state.error) return <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check size={13} /> Added {state.done} {state.done === 1 ? "block" : "blocks"} to your calendar</span>;
  return (
    <>
      <button
        className="btn-ghost border border-border px-2.5 py-1 text-xs"
        disabled={state.busy || !blocks.length}
        onClick={() => void book()}
        title={canBook ? `Books the ${blocks.length} non-meeting blocks on your Google Calendar` : "Opens today in the Calendar. Connect Google Calendar with permission to add events to book the blocks in one click."}
      >
        <CalendarPlus size={13} /> {state.busy ? "Adding…" : "Add to calendar"}
      </button>
      {state.error && <span className="text-xs text-red-500">{state.error}{state.done ? ` (${state.done} added)` : ""}</span>}
    </>
  );
}

/* ── Draft follow-ups ── */

interface Draft { to: string; subject: string; body: string; edited: boolean }

function FollowUpsPanel({ result, onOpen, ...common }: {
  result: FollowResult | null; onOpen: (it: FollowItem) => void;
  at: Date; loading: boolean; error: string | null; onClose: () => void; onRefresh: () => void;
}) {
  const { data: conns } = useMailConnections();
  const { send } = useSendEmail();
  const items = useMemo(() => result?.items ?? [], [result]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<Record<string, "sent" | "failed">>({});
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    setDrafts(Object.fromEntries(items.map((i) => [i.ref, { to: i.to, subject: i.subject, body: i.body, edited: false }])));
    setChecked(new Set(items.map((i) => i.ref)));
    setStatus({});
    setConfirming(false);
  }, [items]);

  const connected = Boolean(conns?.gmail.connected || conns?.outlook.connected);
  const chosen = items.filter((i) => checked.has(i.ref) && status[i.ref] !== "sent");
  const missing = chosen.filter((i) => !drafts[i.ref]?.to.trim());
  const edit = (ref: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [ref]: { ...d[ref], ...patch, edited: true } }));
  const asText = (i: FollowItem) => { const d = drafts[i.ref]; return `To: ${d?.to || "(add recipient)"}\nSubject: ${d?.subject}\n\n${d?.body}`; };

  async function copy(list: FollowItem[], key: string) {
    try { await navigator.clipboard.writeText(list.map(asText).join("\n\n---\n\n")); } catch { /* clipboard blocked: the text is on screen to copy by hand */ }
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  }

  async function sendAll() {
    setSending(true);
    let ok = 0;
    for (const i of chosen) {
      const d = drafts[i.ref];
      const provider = i.message ? providerOf(i.message) : conns?.gmail.connected ? "gmail" : "outlook";
      const went = await send({
        to: d.to, subject: d.subject, text: d.body, html: textToHtml(d.body), provider, aiDrafted: true,
        // A chase on our own sent mail threads onto it.
        threadId: i.message?.thread_id ?? null, inReplyTo: i.message?.rfc_message_id ?? null, replyToOutlookId: i.message?.outlook_id ?? null,
      });
      if (went) ok++;
      setStatus((s) => ({ ...s, [i.ref]: went ? "sent" : "failed" }));
    }
    track("ai_result_applied", { action: "home_follow_ups", changes_suggested: items.length, changes_applied: ok });
    setSending(false);
    setConfirming(false);
  }

  const n = chosen.length;
  const sendHelp = !connected ? "Connect Gmail or Outlook in Integrations to send. Copy still works."
    : missing.length ? "Add a recipient to every checked item first." : n ? `Send ${n} ${n === 1 ? "email" : "emails"}` : "Tick at least one item.";

  return (
    <AiPanel
      {...common}
      title="Draft follow-ups"
      source="your follow-up list"
      summary={items.length ? result?.summary : undefined}
      empty={result && !items.length ? "Nothing has gone quiet." : null}
      chat={items.length ? `Here are follow-up drafts for items that have gone quiet:\n${items.map((i) => `${i.flag.title} (${i.flag.reason}) to ${drafts[i.ref]?.to || i.contact}: ${drafts[i.ref]?.body ?? i.body}`).join("\n\n")}\n\nHelp me improve them.` : undefined}
      footer={confirming ? (
        <div className="space-y-2">
          <p className="text-sm">Send {n} {n === 1 ? "email" : "emails"} to {chosen.map((i) => drafts[i.ref]?.to).join(", ")}?</p>
          <div className="flex gap-2">
            <button className="btn-primary flex-1 justify-center" disabled={sending} onClick={() => void sendAll()}><Send size={14} /> {sending ? "Sending…" : "Confirm send"}</button>
            <button className="btn-ghost border border-border" disabled={sending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <span className="flex-1" title={sendHelp}>
            <button className="btn-primary w-full justify-center" disabled={!connected || !n || missing.length > 0} onClick={() => setConfirming(true)}>
              <Send size={14} /> Send {n}
            </button>
          </span>
          <button className="btn-ghost border border-border" disabled={!n} onClick={() => void copy(chosen, "all")}>
            {copied === "all" ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy {n}</>}
          </button>
        </div>
      )}
    >
      <ul className="space-y-3">
        {items.map((i) => {
          const d = drafts[i.ref];
          if (!d) return null;
          return (
            <li key={i.ref} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]" checked={checked.has(i.ref)} disabled={status[i.ref] === "sent"}
                  aria-label={`Include the follow-up on ${i.flag.title}`}
                  onChange={() => setChecked((s) => { const x = new Set(s); if (x.has(i.ref)) x.delete(i.ref); else x.add(i.ref); return x; })} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{i.flag.title}</p>
                  <p className="text-xs text-faint">{i.contact} · {i.flag.reason}{i.lastContact ? ` · last contact ${new Date(i.lastContact).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</p>
                </div>
                {status[i.ref] === "sent" && <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check size={12} /> Sent</span>}
                {status[i.ref] === "failed" && <span className="text-xs text-red-500">Not sent</span>}
              </div>
              <input className={cn("input mb-1.5 h-8 text-xs", !d.edited && d.to && "ai-filled")} value={d.to} placeholder="Add recipient" aria-label="Recipient" onChange={(e) => edit(i.ref, { to: e.target.value })} />
              <input className={cn("input mb-1.5 h-8 text-xs", !d.edited && "ai-filled")} value={d.subject} aria-label="Subject" onChange={(e) => edit(i.ref, { subject: e.target.value })} />
              <textarea className={cn("input min-h-[120px] text-xs leading-relaxed", !d.edited && "ai-filled")} value={d.body} aria-label="Message" onChange={(e) => edit(i.ref, { body: e.target.value })} />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button className="btn-ghost border border-border px-2 py-1 text-xs" onClick={() => void copy([i], i.ref)}>
                  {copied === i.ref ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
                <button className="btn-ghost border border-border px-2 py-1 text-xs" onClick={() => onOpen(i)}>
                  <ExternalLink size={12} /> {i.message ? "Open in Inbox" : "Open task"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </AiPanel>
  );
}

