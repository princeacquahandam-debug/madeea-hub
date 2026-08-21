import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, ArrowLeft, UserPlus, Trash2, ArrowUpCircle, ArrowDownCircle, Users, Lock } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ROLE_LABEL, ROLE_RANK, ROLE_BLURB, useGrantableRoles, useRoleCapabilities, type MemberRole, useMyRole, useWorkspaceMembers, useMemberMutations, useInviteMember, useTasks } from "@/data/hooks";
import { AssigneeAvatar } from "@/components/Assignee";
import { teamWorkload, unassignedCount } from "@/lib/team";

function fmtDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function Admin() {
  const nav = useNavigate();
  const { data: role, isLoading: roleLoading } = useMyRole();
  const { data: grantable = [] } = useGrantableRoles();
  const { data: capabilities = [] } = useRoleCapabilities();
  const { data: members = [], isLoading } = useWorkspaceMembers();
  const { setRole, remove } = useMemberMutations();
  const invite = useInviteMember();
  const [inviteRole, setInviteRole] = useState<MemberRole>("employee");
  const { data: tasks = [] } = useTasks();
  const workload = teamWorkload(members, tasks);
  const unclaimed = unassignedCount(tasks);

  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // UI gate only. RLS is the real boundary (admins-only writes, workspace isolation).
  if (!roleLoading && !["owner", "admin"].includes(role ?? "")) {
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

  const ownerCount = members.filter((m) => m.role === "owner").length;
  /* Counted by rank rather than by an equality test, so an owner is included
     in "admins or above" instead of vanishing from both tallies. */
  const adminCount = members.filter((m) => ROLE_RANK[m.role] >= 30).length;
  const eaCount = members.filter((m) => ROLE_RANK[m.role] <= 10).length;
  const openTasks = members.reduce((n, m) => n + m.open_tasks, 0);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setNotice(null);
    try {
      const res = await invite.mutateAsync({ email: addr, role: inviteRole });
      /* Names the role that was actually chosen. This said "They'll join as an
         EA" regardless, left over from when the function hardcoded that role,
         so choosing Owner and being told EA was the expected outcome. */
      const asRole = ROLE_LABEL[inviteRole] ?? inviteRole;
      setNotice({
        kind: "ok",
        text: res?.reinstated
          ? `${addr} already had an account, so they were added straight back as ${asRole}. No email was sent and their existing password still works.`
          : `Invitation sent to ${addr}. They join as ${asRole} once they accept.`,
      });
      setEmail("");
    } catch (err) {
      /* Say what went wrong. The previous message was a fixed sentence claiming
         the invite function was not deployed, printed for every failure
         including "That person is already a member", which is a 409 from a
         function that had been live for days. */
      const e = err as Error & { missing?: boolean };
      setNotice({
        kind: "err",
        text: e.missing
          ? "The invite function is not deployed. Deploy invite-member, or add the person from Supabase, Authentication."
          : e.message || "Could not send the invitation.",
      });
    }
  }

  function changeRole(user_id: string, role: MemberRole) {
    setNotice(null);
    setRole.mutate({ user_id, role }, {
      onError: () => setNotice({ kind: "err", text: "Couldn't update role. Your account may not have admin rights." }),
    });
  }

  function removeMember(user_id: string, name: string) {
    if (!window.confirm(`Remove ${name} from the workspace? They'll lose access immediately.`)) return;
    setNotice(null);
    remove.mutate({ user_id }, {
      onError: () => setNotice({ kind: "err", text: "Couldn't remove member. Admin rights required." }),
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
          { label: "Admins & owners", value: adminCount, icon: ShieldCheck },
          { label: "Employees", value: eaCount, icon: Users },
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
            {/* Who is carrying what. Derived from real assignments, not a stored number. */}
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
                  <p className="truncate text-xs text-faint">{ROLE_LABEL[w.member.role] ?? w.member.role}</p>
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
        <p className="mb-3 text-sm text-muted">
          They join this workspace at the role you choose. The role decides what they can see and do, and it can be changed later.
        </p>
        <form onSubmit={sendInvite} className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            className="input flex-1"
            aria-label="Email address of the team member to invite"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {/* The list comes from the database, so it can only ever offer roles
              this account may actually grant. The server checks again. */}
          <label className="sr-only" htmlFor="invite-role">Role</label>
          <select
            id="invite-role"
            className="input w-full sm:w-40"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as MemberRole)}
          >
            {grantable.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
            ))}
          </select>
          <button className="btn-primary" disabled={invite.isPending}>
            <UserPlus size={15} /> {invite.isPending ? "Sending…" : "Send invite"}
          </button>
        </form>
        <p className="mt-2 text-xs text-faint">{ROLE_BLURB[inviteRole]}</p>
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
              /* The database refuses to demote or remove the last owner. The
                 UI disables it too, so the failure is visible before the click
                 rather than as an error afterwards. */
              const lastOwner = m.role === "owner" && ownerCount <= 1;
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

                  <span className={`pill text-[10px] ${ROLE_RANK[m.role] >= 30 ? "bg-accent/15 text-accent-soft" : "bg-surface-2 text-muted"}`}>
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {/* A picker over the roles this caller may actually grant,
                        not a promote/demote pair. The list comes from the
                        database, so it can never offer something the server
                        will refuse. */}
                    <label className="sr-only" htmlFor={`role-${m.user_id}`}>Role for {m.name}</label>
                    <select
                      id={`role-${m.user_id}`}
                      className="input h-8 w-auto py-0 text-xs"
                      value={m.role === "ea" ? "employee" : m.role}
                      disabled={lastOwner}
                      title={lastOwner ? "Appoint another owner before changing this one" : undefined}
                      onChange={(e) => changeRole(m.user_id, e.target.value as MemberRole)}
                    >
                      {grantable.map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
                      ))}
                    </select>
                    <button
                      className="btn-ghost border border-border py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                      disabled={m.is_me || lastOwner}
                      title={m.is_me ? "You can't remove yourself" : lastOwner ? "Appoint another owner first" : "Remove from workspace"}
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

      {/* What each role can do, read from the database rather than written
          here. A hand-maintained table of permissions is a document, and
          documents drift: the policies change and the table keeps reassuring
          people about access that no longer exists. */}
      {capabilities.length > 0 && (
        <section className="card mt-5 overflow-hidden">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">What each role can do</h2>
            <p className="mt-0.5 text-xs text-faint">
              Read live from the same ranks the database enforces, so this cannot drift from what is actually allowed.
            </p>
          </div>
          <div className="grid gap-3 border-b border-border px-5 py-3 sm:grid-cols-2 lg:grid-cols-4">
            {(["owner", "admin", "manager", "employee"] as const).map((r) => (
              <div key={r}>
                <p className="text-xs font-semibold">{ROLE_LABEL[r]}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{ROLE_BLURB[r]}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-faint">
                  <th scope="col" className="px-5 py-2 font-medium">Capability</th>
                  {(["owner", "admin", "manager", "employee"] as const).map((r) => (
                    <th key={r} scope="col" className="px-3 py-2 text-center font-medium">{ROLE_LABEL[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capabilities.map((c) => (
                  <tr key={c.capability} className="border-b border-border last:border-0">
                    <td className="px-5 py-1.5">{c.capability}</td>
                    {([c.owner, c.admin, c.manager, c.employee]).map((allowed, i) => (
                      <td key={i} className="px-3 py-1.5 text-center">
                        {/* A word as well as a mark, so the table survives
                            greyscale and a screen reader. */}
                        <span className={allowed ? "text-emerald-400" : "text-faint"}>
                          {allowed ? "Yes" : "No"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-xs text-faint">
        <Lock size={12} className="mt-0.5 shrink-0" />
        <span>
          Enforced in the database, not here. Nobody can grant a role above their own, the last owner cannot be
          demoted or removed, and each workspace is isolated. Turning these controls off in the browser changes nothing.
        </span>
      </p>
    </div>
  );
}
