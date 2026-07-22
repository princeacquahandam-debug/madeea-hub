import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, ArrowLeft, UserPlus, Trash2, ArrowUpCircle, ArrowDownCircle, Users, Lock } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useMyRole, useWorkspaceMembers, useMemberMutations, useInviteMember, useTasks } from "@/data/hooks";
import { AssigneeAvatar } from "@/components/Assignee";
import { teamWorkload, unassignedCount } from "@/lib/team";

function fmtDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function Admin() {
  const nav = useNavigate();
  const { data: role, isLoading: roleLoading } = useMyRole();
  const { data: members = [], isLoading } = useWorkspaceMembers();
  const { setRole, remove } = useMemberMutations();
  const invite = useInviteMember();
  const { data: tasks = [] } = useTasks();
  const workload = teamWorkload(members, tasks);
  const unclaimed = unassignedCount(tasks);

  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // UI gate only — RLS is the real boundary (admins-only writes, workspace isolation).
  if (!roleLoading && role !== "admin") {
    return (
      <div className="mx-auto max-w-md pt-10 text-center">
        <div className="card p-8">
          <Lock size={28} className="mx-auto text-faint" />
          <h2 className="mt-3 font-display text-xl">Admins only</h2>
          <p className="mt-2 text-sm text-muted">This area is for workspace administrators. Ask an admin if you need access.</p>
          <button className="btn-primary mt-5" onClick={() => nav("/")}>Back to app</button>
        </div>
      </div>
    );
  }

  const adminCount = members.filter((m) => m.role === "admin").length;
  const eaCount = members.length - adminCount;
  const openTasks = members.reduce((n, m) => n + m.open_tasks, 0);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setNotice(null);
    try {
      await invite.mutateAsync(addr);
      setNotice({ kind: "ok", text: `Invitation sent to ${addr}. They'll join as an EA once they accept.` });
      setEmail("");
    } catch {
      setNotice({
        kind: "err",
        text: "Invite service isn't enabled yet. Deploy the invite-member function (or add the user from Supabase → Authentication). Role management below works now.",
      });
    }
  }

  function changeRole(user_id: string, role: "admin" | "ea") {
    setNotice(null);
    setRole.mutate({ user_id, role }, {
      onError: () => setNotice({ kind: "err", text: "Couldn't update role — your account may not have admin rights." }),
    });
  }

  function removeMember(user_id: string, name: string) {
    if (!window.confirm(`Remove ${name} from the workspace? They'll lose access immediately.`)) return;
    setNotice(null);
    remove.mutate({ user_id }, {
      onError: () => setNotice({ kind: "err", text: "Couldn't remove member — admin rights required." }),
    });
  }

  return (
    <div>
      <PageHeader
        title="Admin"
        subtitle="Manage team accounts, roles and access for your workspace"
        action={
          <button className="btn-ghost border border-border" onClick={() => nav("/")}>
            <ArrowLeft size={15} /> Switch to user view
          </button>
        }
      />

      {/* Stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Team members", value: members.length, icon: Users },
          { label: "Admins", value: adminCount, icon: ShieldCheck },
          { label: "EAs", value: eaCount, icon: Users },
          { label: "Open tasks", value: openTasks, icon: ArrowUpCircle },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <s.icon size={16} className="text-accent-soft" />
            <p className="mt-2 font-display text-2xl">{s.value}</p>
            <p className="text-xs text-faint">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Invite */}
            {/* Who is carrying what — derived from real assignments, not a stored number. */}
      <section className="card mb-4 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Team Workload</h2>
          {unclaimed > 0 && (
            <span className="pill bg-amber-500/15 text-amber-400">{unclaimed} unassigned</span>
          )}
        </div>
        {workload.length === 0 ? (
          <p className="text-sm text-faint">No team members yet.</p>
        ) : (
          <div className="space-y-2">
            {workload.map((w) => (
              <div key={w.member.user_id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <AssigneeAvatar member={w.member} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {w.member.name}
                    {w.member.is_me && <span className="text-faint"> (you)</span>}
                  </p>
                  <p className="truncate text-xs text-faint capitalize">{w.member.role}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-xs">
                  <span className="text-center">
                    <span className="block text-base font-semibold">{w.open}</span>
                    <span className="text-faint">open</span>
                  </span>
                  <span className="text-center">
                    <span className={`block text-base font-semibold ${w.overdue ? "text-red-400" : ""}`}>{w.overdue}</span>
                    <span className="text-faint">overdue</span>
                  </span>
                  <span className="text-center">
                    <span className={`block text-base font-semibold ${w.urgent ? "text-amber-400" : ""}`}>{w.urgent}</span>
                    <span className="text-faint">urgent</span>
                  </span>
                  <span className="text-center">
                    <span className="block text-base font-semibold text-emerald-400">{w.completedThisWeek}</span>
                    <span className="text-faint">done 7d</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mb-5 p-5">
        <p className="field-label">Invite a team member</p>
        <p className="mb-3 text-sm text-muted">Send an email invite. They join the shared team workspace as an EA and can see the whole team's work.</p>
        <form onSubmit={sendInvite} className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            className="input flex-1"
            aria-label="Email address of the team member to invite"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn-primary" disabled={invite.isPending}>
            <UserPlus size={15} /> {invite.isPending ? "Sending…" : "Send invite"}
          </button>
        </form>
      </section>

      {notice && (
        <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${notice.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
          {notice.text}
        </div>
      )}

      {/* Members */}
      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <p className="font-medium">Accounts</p>
        </div>

        {isLoading ? (
          <p className="px-5 py-6 text-sm text-faint">Loading team…</p>
        ) : (
          <div className="divide-y divide-border">
            {members.map((m) => {
              const lastAdmin = m.role === "admin" && adminCount <= 1;
              return (
                <div key={m.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-soft">
                    {m.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {m.name}
                      {m.is_me && <span className="pill bg-surface-2 text-[10px] text-faint">You</span>}
                    </p>
                    <p className="text-xs text-faint">Joined {fmtDate(m.joined_at)} · {m.open_tasks} open · {m.clients} clients</p>
                  </div>

                  <span className={`pill text-[10px] ${m.role === "admin" ? "bg-accent/15 text-accent-soft" : "bg-surface-2 text-muted"}`}>
                    {m.role === "admin" ? "Admin" : "EA"}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {m.role === "ea" ? (
                      <button className="btn-ghost border border-border py-1 text-xs" onClick={() => changeRole(m.user_id, "admin")}>
                        <ArrowUpCircle size={14} /> Make admin
                      </button>
                    ) : (
                      <button
                        className="btn-ghost border border-border py-1 text-xs disabled:opacity-40"
                        disabled={lastAdmin}
                        title={lastAdmin ? "Keep at least one admin" : ""}
                        onClick={() => changeRole(m.user_id, "ea")}
                      >
                        <ArrowDownCircle size={14} /> Make EA
                      </button>
                    )}
                    <button
                      className="btn-ghost border border-border py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                      disabled={m.is_me || lastAdmin}
                      title={m.is_me ? "You can't remove yourself" : lastAdmin ? "Keep at least one admin" : "Remove from workspace"}
                      onClick={() => removeMember(m.user_id, m.name)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-faint">
        <Lock size={12} /> Access is enforced server-side: only admins can change roles or remove members, and each workspace is fully isolated.
      </p>
    </div>
  );
}
