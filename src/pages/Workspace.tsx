import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Brain, CalendarDays, CheckSquare, FileText, Lock, Pin, PinOff, Plus, Trash2, Upload } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { atLeast, useEodReports, useFiles, useMemories, useMemoryMutations, useMyRole, useTasks, useWorkspaceMembers } from "@/data/hooks";
import { useAuth } from "@/hooks/useAuth";
import { isMine, sortTasks } from "@/lib/taskSort";
import { todayIso } from "@/lib/eodDraft";
import { KIND_LABEL, MEMORY_KINDS, type MemoryKind } from "@/lib/memory";
import { cn } from "@/lib/utils";

/**
 * A workspace per member (21 Oct 2026).
 *
 * Everyone has their own: their open tasks, their EOD reports, and their own
 * Madeline memory and knowledge base, which are private to them (0090 / 0067).
 * Managers and up (Rowena, Prince) can open any member's workspace to see
 * their work and reports. A member's memory and personal shelf stay private
 * even then: they're notes to Madeline, not work output.
 */
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", employee: "Employee", ea: "EA" };
const PRIORITY: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

function daysAgo(iso: string, n: number): boolean {
  return Date.parse(`${iso}T12:00:00Z`) >= Date.parse(`${todayIso()}T12:00:00Z`) - n * 864e5;
}

export default function Workspace() {
  const { user } = useAuth();
  const { data: role } = useMyRole();
  const canSeeTeam = atLeast(role, "manager");
  const { data: members = [] } = useWorkspaceMembers();
  const [params, setParams] = useSearchParams();
  const requested = params.get("member");
  const meId = members.find((m) => m.is_me)?.user_id ?? user?.id ?? null;
  const memberId = canSeeTeam && requested ? requested : meId;
  const member = members.find((m) => m.user_id === memberId) ?? null;
  const isMe = memberId === meId;
  const name = member?.name ?? user?.name ?? "You";
  const firstName = name.split(" ")[0];

  const { data: tasks = [] } = useTasks();
  const { data: reports = [] } = useEodReports();

  const theirTasks = useMemo(() => tasks.filter((t) => isMine(t, memberId)), [tasks, memberId]);
  const open = sortTasks(theirTasks.filter((t) => t.status !== "done"));
  const today = todayIso();
  const overdue = open.filter((t) => t.due_at && t.due_at.slice(0, 10) < today).length;
  const doneWeek = theirTasks.filter((t) => t.status === "done" && t.completed_at && daysAgo(t.completed_at.slice(0, 10), 7)).length;

  const theirReports = useMemo(
    () => reports
      .filter((r) => (r.owner_id && r.owner_id === memberId) || (!r.owner_id && r.person === member?.name))
      .sort((a, b) => b.report_date.localeCompare(a.report_date)),
    [reports, memberId, member?.name],
  );
  const reportedToday = theirReports.some((r) => r.report_date === today);
  const reportsWeek = theirReports.filter((r) => daysAgo(r.report_date, 7)).length;

  return (
    <div>
      <PageHeader
        title={isMe ? "My workspace" : `${firstName}'s workspace`}
        subtitle={isMe
          ? "Your work, your reports, and what Madeline remembers for you. Your memory and personal files are private to you."
          : `${firstName}'s work and reports. Their memory and personal files stay private to them.`}
        action={canSeeTeam && members.length > 1 ? (
          <select
            className="input w-auto"
            value={memberId ?? ""}
            onChange={(e) => setParams(e.target.value === meId ? {} : { member: e.target.value })}
            aria-label="Whose workspace"
          >
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.is_me ? `${m.name} (you)` : m.name}</option>)}
          </select>
        ) : undefined}
      />

      {canSeeTeam && members.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2" aria-label="Team members">
          {members.map((m) => (
            <button
              key={m.user_id}
              onClick={() => setParams(m.user_id === meId ? {} : { member: m.user_id })}
              className={cn("flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                m.user_id === memberId ? "border-accent bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]" : "border-border text-muted hover:text-text")}
            >
              <Avatar name={m.name} className="h-5 w-5 text-[9px]" />
              {m.is_me ? "You" : m.name.split(" ")[0]}
              <span className="text-faint">{ROLE_LABEL[m.role] ?? m.role}</span>
            </button>
          ))}
        </div>
      )}

      <div className="card mb-5 grid grid-cols-2 overflow-hidden sm:grid-cols-4">
        {[
          { label: "Open tasks", value: String(open.length) },
          { label: "Overdue", value: String(overdue), alert: overdue > 0 },
          { label: "Done this week", value: String(doneWeek) },
          { label: "EOD today", value: reportedToday ? "Sent" : "Not yet", alert: !reportedToday },
        ].map((k) => (
          <div key={k.label} className="border-b border-r border-border px-4 py-3 last:border-r-0 sm:border-b-0">
            <p className={cn("text-xl font-bold tabular-nums", k.alert && "text-amber-500")}>{k.value}</p>
            <p className="text-xs text-muted">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Tasks */}
        <section className="card p-5" aria-labelledby="ws-tasks">
          <div className="mb-3 flex items-center gap-2">
            <CheckSquare size={16} className="text-accent" />
            <h2 id="ws-tasks" className="flex-1 font-semibold">{isMe ? "Your open tasks" : `${firstName}'s open tasks`}</h2>
            <Link to={isMe ? "/tasks?who=mine" : `/tasks?who=${memberId}`} className="text-xs font-medium text-accent-soft hover:underline">Open board</Link>
          </div>
          {open.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">No open tasks.</p>
          ) : (
            <ul className="divide-y divide-border">
              {open.slice(0, 8).map((t) => {
                const sub = t.subtasks.length;
                const subDone = t.subtasks.filter((s) => s.done).length;
                const late = t.due_at && t.due_at.slice(0, 10) < today;
                return (
                  <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
                    <Link to={`/tasks?task=${t.id}`} className="min-w-0 flex-1 truncate hover:text-accent">{t.title}</Link>
                    {sub > 0 && <span className="text-xs text-faint">{subDone}/{sub}</span>}
                    {t.due_at && (
                      <span className={cn("flex items-center gap-1 text-xs", late ? "text-red-500" : "text-faint")}>
                        <CalendarDays size={11} />
                        {new Date(t.due_at).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}
                      </span>
                    )}
                    <Badge tone={t.priority}>{PRIORITY[t.priority]}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
          {open.length > 8 && <p className="mt-2 text-xs text-faint">and {open.length - 8} more on the board</p>}
        </section>

        {/* EOD reports */}
        <section className="card p-5" aria-labelledby="ws-eod">
          <div className="mb-3 flex items-center gap-2">
            <FileText size={16} className="text-accent" />
            <h2 id="ws-eod" className="flex-1 font-semibold">EOD reports</h2>
            <span className="text-xs text-faint">{reportsWeek} in the last 7 days</span>
            <Link to="/eod" className="text-xs font-medium text-accent-soft hover:underline">All reports</Link>
          </div>
          {theirReports.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">No reports yet.</p>
          ) : (
            <ul className="space-y-2">
              {theirReports.slice(0, 5).map((r) => (
                <li key={r.id} className={cn("rounded-lg border px-3 py-2", r.blockers.length ? "border-amber-500/40" : "border-border")}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{new Date(`${r.report_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                    <span className="text-xs text-faint">{r.done.length} done · {r.blockers.length} blocked · {r.plans.length} planned</span>
                  </div>
                  {r.done[0] && <p className="mt-0.5 truncate text-xs text-muted">{r.done[0]}</p>}
                  {r.blockers[0] && <p className="mt-0.5 truncate text-xs text-amber-500">Blocked: {r.blockers[0]}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {isMe ? <MemoryPanel /> : <PrivatePanel icon={<Brain size={16} className="text-accent" />} title="Madeline's memory" who={firstName} />}
        {isMe ? <KnowledgePanel userId={meId} /> : <PrivatePanel icon={<Upload size={16} className="text-accent" />} title="Personal knowledge base" who={firstName} />}
      </div>
    </div>
  );
}

function PrivatePanel({ icon, title, who }: { icon: React.ReactNode; title: string; who: string }) {
  return (
    <section className="card p-5">
      <div className="mb-2 flex items-center gap-2">{icon}<h2 className="font-semibold">{title}</h2></div>
      <p className="flex items-center gap-2 text-sm text-faint"><Lock size={14} /> Private to {who}.</p>
    </section>
  );
}

/* Your own memory: what Madeline remembers for you and uses in her answers. */
function MemoryPanel() {
  const { data: memories = [] } = useMemories();
  const { create, update, remove } = useMemoryMutations();
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [body, setBody] = useState("");
  const sorted = [...memories].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  const add = () => {
    const b = body.trim();
    if (!b) return;
    create.mutate({ kind, body: b, source: "Added in My workspace" });
    setBody("");
  };

  return (
    <section className="card p-5" aria-labelledby="ws-mem">
      <div className="mb-1 flex items-center gap-2">
        <Brain size={16} className="text-accent" />
        <h2 id="ws-mem" className="flex-1 font-semibold">Madeline's memory</h2>
        <span className="flex items-center gap-1 text-xs text-faint"><Lock size={11} /> Only you</span>
      </div>
      <p className="mb-3 text-xs text-muted">What Madeline remembers for you: how you like things done, facts about your clients, promises you've made. She checks it before drafting.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} aria-label="Kind of memory">
          {MEMORY_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input
          className="input min-w-[12rem] flex-1"
          placeholder="e.g. Acme's CEO prefers calls before 10am Dubai time"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          aria-label="Something for Madeline to remember"
        />
        <button className="btn-primary" onClick={add} disabled={!body.trim() || create.isPending}><Plus size={14} /> Remember</button>
      </div>
      {sorted.length === 0 ? (
        <p className="py-4 text-center text-sm text-faint">Nothing yet. Add something above, or tell Madeline "remember that…".</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {sorted.map((m) => (
            <li key={m.id} className="group flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="pill shrink-0 bg-[var(--chip-bg)] text-[11px] text-muted">{KIND_LABEL[m.kind]}</span>
              <span className="min-w-0 flex-1">{m.body}</span>
              <button className="icon-btn text-faint hover:text-accent" onClick={() => update.mutate({ id: m.id, pinned: !m.pinned })}
                aria-label={m.pinned ? "Unpin" : "Pin"} title={m.pinned ? "Unpin" : "Pin to the top"}>
                {m.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
              <button className="icon-btn text-faint hover:text-red-500" onClick={() => { if (window.confirm("Forget this?")) remove.mutate(m.id); }}
                aria-label="Forget this" title="Forget">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* Your own knowledge base: the personal shelf, plus how much is on the team's. */
function KnowledgePanel({ userId }: { userId: string | null }) {
  const { data: files = [] } = useFiles();
  const mine = files.filter((f) => f.scope === "personal" && f.uploaded_by === userId);
  const team = files.filter((f) => f.scope === "team").length;
  return (
    <section className="card p-5" aria-labelledby="ws-kb">
      <div className="mb-1 flex items-center gap-2">
        <Upload size={16} className="text-accent" />
        <h2 id="ws-kb" className="flex-1 font-semibold">Your knowledge base</h2>
        <Link to="/uploads" className="text-xs font-medium text-accent-soft hover:underline">Open uploads</Link>
      </div>
      <p className="mb-3 text-xs text-muted">
        Your personal shelf is private to you; the team shelf ({team} {team === 1 ? "file" : "files"}) is shared. Madeline can find files on both by name.
      </p>
      {mine.length === 0 ? (
        <p className="py-4 text-center text-sm text-faint">Nothing on your personal shelf yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {mine.slice(0, 6).map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-2 text-sm">
              <FileText size={14} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-faint">{new Date(f.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
