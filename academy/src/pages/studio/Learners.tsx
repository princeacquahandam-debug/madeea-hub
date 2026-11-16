import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Search, UserPlus, Users, X } from "lucide-react";
import { fmtDate, pct, usePeople, type Person, type Role } from "@/lib/api";
import { errText, supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Empty, Loading, PageTitle } from "@/components/Shell";

const ROLE_LABEL: Record<Role, string> = { learner: "Learner", trainer: "Trainer", admin: "Admin" };

/**
 * Learners (Abder, 16 Nov): everyone, their Academy role, region and team,
 * progress and certificates; pick the ones not progressing and email them a
 * reminder; invite new people as a learner, trainer or admin.
 */
export default function Learners() {
  const { isAdmin, me } = useAuth();
  const people = usePeople();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<"all" | "stuck" | "done">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [invite, setInvite] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const list = useMemo(() => (people.data ?? []).filter((p) => {
    if (search && !`${p.name} ${p.email} ${p.region ?? ""} ${p.team ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (only === "stuck") return p.lessons_total > 0 && p.lessons_done < p.lessons_total && p.certificates === 0;
    if (only === "done") return p.certificates > 0;
    return true;
  }), [people.data, search, only]);

  if (people.isLoading) return <Loading />;

  const update = async (p: Person, patch: Partial<Pick<Person, "role" | "region" | "team">>) => {
    setErr(null);
    const row = { user_id: p.user_id, role: patch.role ?? p.role, region: (patch.region ?? p.region)?.trim() || null, team: (patch.team ?? p.team)?.trim() || null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("acad_members").upsert(row, { onConflict: "workspace_id,user_id" });
    if (error) setErr(errText(error));
    await qc.invalidateQueries({ queryKey: ["people"] });
  };

  const remind = () => {
    const to = (people.data ?? []).filter((p) => sel.has(p.user_id)).map((p) => p.email);
    const subject = "A reminder from MadeEA Academy";
    const body = `Hi,\n\nA quick reminder that you have learning waiting for you in MadeEA Academy:\n${window.location.origin}\n\nOpen it from the Hub (Learn > MadeEA Academy) to sign in without a password.\n\nThanks`;
    window.location.href = `mailto:?bcc=${encodeURIComponent(to.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };

  return (
    <>
      <PageTitle title="Learners" sub="Everyone on the team, their progress, and who needs a nudge."
        actions={<>
          <button className="btn" disabled={!sel.size} onClick={remind} title="Opens your email with the selected people in BCC"><Mail size={15} />Email a reminder{sel.size ? ` (${sel.size})` : ""}</button>
          {isAdmin && <button className="btn-primary" onClick={() => setInvite(true)}><UserPlus size={15} />Invite</button>}
        </>} />
      {err && <p className="mb-3 text-sm text-accent-soft">{err}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !pl-9" placeholder="Search name, email, region, team" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input !w-auto" value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
          <option value="all">Everyone</option>
          <option value="stuck">Not finished</option>
          <option value="done">Certified</option>
        </select>
        {only === "stuck" && list.length > 0 && <button className="btn" onClick={() => setSel(new Set(list.map((p) => p.user_id)))}>Select all {list.length}</button>}
      </div>

      {list.length === 0 ? <Empty icon={Users} title="Nobody matches">Try another search or filter.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all" checked={list.length > 0 && list.every((p) => sel.has(p.user_id))}
                  onChange={(e) => setSel(e.target.checked ? new Set(list.map((p) => p.user_id)) : new Set())} /></th>
                <th className="px-3 py-2">Person</th><th className="px-3 py-2">Academy role</th><th className="px-3 py-2">Region</th><th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Progress</th><th className="px-3 py-2">Certificates</th><th className="px-3 py-2">Last active</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.user_id} className="border-t border-border">
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${p.name}`} checked={sel.has(p.user_id)} onChange={() => toggle(p.user_id)} /></td>
                  <td className="px-3 py-2"><p className="font-semibold">{p.name}</p><p className="text-xs text-faint">{p.email}</p></td>
                  <td className="px-3 py-2">
                    {isAdmin && p.user_id !== me?.user_id ? (
                      <select className="input !h-8 !w-auto" value={p.role} onChange={(e) => update(p, { role: e.target.value as Role })}>
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : <span className="chip">{ROLE_LABEL[p.role]}</span>}
                  </td>
                  <td className="px-3 py-2"><EditCell value={p.region} can={isAdmin} placeholder="Region" onSave={(v) => update(p, { region: v })} /></td>
                  <td className="px-3 py-2"><EditCell value={p.team} can={isAdmin} placeholder="Team" onSave={(v) => update(p, { team: v })} /></td>
                  <td className="px-3 py-2">
                    {p.lessons_total ? (
                      <div className="w-36"><div className="bar"><span style={{ width: `${pct(p.lessons_done, p.lessons_total)}%` }} /></div>
                        <p className="mt-1 text-xs text-faint">{p.lessons_done}/{p.lessons_total} lessons · {p.paths_assigned} path{p.paths_assigned === 1 ? "" : "s"}</p></div>
                    ) : <span className="text-xs text-faint">No path assigned</span>}
                  </td>
                  <td className="px-3 py-2">{p.certificates ? <span className="chip-good">{p.certificates}</span> : <span className="text-faint">0</span>}</td>
                  <td className="px-3 py-2 text-xs text-faint">{p.last_active ? fmtDate(p.last_active) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invite && <InviteDialog onClose={() => setInvite(false)} />}
    </>
  );
}

function EditCell({ value, can, placeholder, onSave }: { value: string | null; can: boolean; placeholder: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value ?? "");
  if (!can) return <span>{value ?? <span className="text-faint">—</span>}</span>;
  return <input className="input !h-8 !w-28" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== (value ?? "")) onSave(v); }} />;
}

/**
 * New people get a MadeEA account through the Hub's own invite (same
 * accounts for both apps), with a starting password you pass on to them.
 */
function InviteDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("learner");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.functions.invoke("invite-member", { body: { email: email.trim(), password, role: "employee" } });
    if (error || (data && (data as { error?: string }).error)) {
      let m = (data as { error?: string } | null)?.error ?? error?.message ?? "Couldn't invite.";
      try { const ctx = (error as { context?: Response } | null)?.context; if (ctx) m = ((await ctx.json()) as { error?: string }).error ?? m; } catch { /* keep m */ }
      setErr(m.includes("already") ? "That person already has a MadeEA account; they're in the list. Change their Academy role there." : m);
      setBusy(false);
      return;
    }
    if (role !== "learner") {
      const { data: ppl } = await supabase.rpc("acad_people");
      const p = (ppl as Person[] | null)?.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (p) await supabase.from("acad_members").upsert({ user_id: p.user_id, role }, { onConflict: "workspace_id,user_id" });
    }
    await qc.invalidateQueries({ queryKey: ["people"] });
    setBusy(false);
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Invite">
        <div className="mb-3 flex items-center"><h2 className="flex-1 text-lg font-bold">Invite to the Academy</h2><button className="btn-ghost" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        {done ? (
          <>
            <p className="text-sm">Invited <b>{email}</b>. Send them their email and starting password; they sign in to the Hub or the Academy with it.</p>
            <button className="btn-primary mt-4 w-full" onClick={onClose}>Done</button>
          </>
        ) : (
          <div className="space-y-3">
            <div><label className="label" htmlFor="ie">Email</label><input id="ie" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label className="label" htmlFor="ip">Starting password</label><input id="ip" className="input" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="mt-1 text-xs text-faint">You choose it and pass it on. They can change it in the Hub's Settings.</p></div>
            <div><label className="label" htmlFor="ir">Academy role</label>
              <select id="ir" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="learner">Learner: takes courses</option>
                <option value="trainer">Trainer: builds courses and paths, sees progress</option>
                <option value="admin">Admin: everything, plus roles and settings</option>
              </select></div>
            <p className="text-xs text-faint">They also get a MadeEA Hub account as an employee, the same as inviting from the Hub's Admin Panel.</p>
            {err && <p className="text-sm text-accent-soft">{err}</p>}
            <button className="btn-primary w-full" disabled={busy || !email.trim() || !password} onClick={send}>{busy ? "Inviting…" : "Invite"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
