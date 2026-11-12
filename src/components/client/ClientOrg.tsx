import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Who reports to the founder (11 Nov 2026 call).
 *
 * Abder: "think of it as a tree ... the founder on the top, then the EA, and
 * directors below ... anyone reporting to the client needs to be there." Rowena:
 * it is filled in before the coach is used, so the coach can say "this goes to
 * your finance director", not only "this goes to your assistant".
 *
 * Only the people who report directly to the founder. Each can be linked to
 * their MadeEA login (a member, 0078), which lets the coach put work straight
 * on their board. Saved whole through client_save_org (0102).
 */

export interface OrgPerson {
  id?: string;
  name: string;
  title: string | null;
  area: string | null;
  handles: string | null;
  member_email: string | null;
}

export const ORG_KEY = ["client-portal", "org"] as const;

export const AREAS = [
  "Operations", "Finance", "Commercial / Sales", "Marketing", "Product", "Tech",
  "People / HR", "Legal", "Customer service", "Other",
];

const blank = (): OrgPerson => ({ name: "", title: "", area: "", handles: "", member_email: null });

export function ClientOrg({
  people, members, assistantName, founderName, onDone, intro,
}: {
  people: OrgPerson[];
  members: string[];
  assistantName: string;
  founderName: string;
  onDone?: () => void;
  /** First-time copy ("Before you start") instead of the edit heading. */
  intro?: boolean;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<OrgPerson[]>(people.length ? people : [blank()]);
  const [error, setError] = useState("");

  /* Reload only when the saved list itself changes, not on every parent render
     (a new array each time would wipe what is being typed). */
  const savedKey = JSON.stringify(people);
  useEffect(() => {
    const saved = JSON.parse(savedKey) as OrgPerson[];
    if (saved.length) setRows(saved);
  }, [savedKey]);

  const save = useMutation({
    mutationFn: async () => {
      const clean = rows
        .filter((r) => r.name.trim())
        .map((r) => ({
          name: r.name.trim(), title: r.title?.trim() || null, area: r.area || null,
          handles: r.handles?.trim() || null, member_email: r.member_email || null,
        }));
      const { error } = await supabase!.rpc("client_save_org", { p_people: clean });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORG_KEY });
      onDone?.();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't save."),
  });

  const set = (i: number, patch: Partial<OrgPerson>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Users size={16} /> {intro ? "Before you start: who reports to you?" : "Your organisation"}
        </h2>
        <p className="text-faint mt-1 text-sm">
          List the people who report directly to you, such as your directors or heads of
          department. The coach uses this to send work to the right person, not only to
          {" "}{assistantName}.
        </p>
      </div>

      {/* The tree: founder, then the assistant and the direct reports. */}
      <div className="rounded-lg border border-border p-3 text-sm">
        <div className="font-semibold">{founderName}</div>
        <div className="mt-2 space-y-1 border-l border-border pl-4">
          <div>
            <span className="font-medium">{assistantName}</span>
            <span className="text-faint"> · Executive assistant (MadeEA)</span>
          </div>
          {rows.filter((r) => r.name.trim()).map((r, i) => (
            <div key={i}>
              <span className="font-medium">{r.name}</span>
              <span className="text-faint">
                {r.title ? ` · ${r.title}` : ""}{r.area ? ` · ${r.area}` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="rounded-lg border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder="Name" value={r.name} maxLength={80}
                     aria-label={`Person ${i + 1} name`} onChange={(e) => set(i, { name: e.target.value })} />
              <input className="input" placeholder="Title, e.g. Finance Director" value={r.title ?? ""} maxLength={80}
                     aria-label={`Person ${i + 1} title`} onChange={(e) => set(i, { title: e.target.value })} />
              <select className="input" value={r.area ?? ""} aria-label={`Person ${i + 1} area`}
                      onChange={(e) => set(i, { area: e.target.value })}>
                <option value="">Area</option>
                {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="input" value={r.member_email ?? ""} aria-label={`Person ${i + 1} MadeEA login`}
                      onChange={(e) => set(i, { member_email: e.target.value || null })}>
                <option value="">Not on MadeEA</option>
                {members.map((m) => <option key={m} value={m}>On MadeEA: {m}</option>)}
              </select>
              <input className="input sm:col-span-2" placeholder="What they handle (optional), e.g. invoices, payroll, budgets"
                     value={r.handles ?? ""} maxLength={300} aria-label={`Person ${i + 1} handles`}
                     onChange={(e) => set(i, { handles: e.target.value })} />
            </div>
            <button type="button" onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
                    className="text-faint mt-2 flex items-center gap-1 text-xs hover:underline">
              <Trash2 size={12} /> Remove
            </button>
          </li>
        ))}
      </ul>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRows((all) => [...all, blank()])} disabled={rows.length >= 30}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm"
                style={{ border: "1px solid var(--c-border)" }}>
          <Plus size={14} /> Add a person
        </button>
        <button type="button" onClick={() => { setError(""); save.mutate(); }} disabled={save.isPending}
                className="btn-primary whitespace-nowrap">
          {save.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
          Save
        </button>
        {onDone ? (
          <button type="button" onClick={onDone} className="text-faint px-2 text-sm hover:underline">
            {intro ? "Skip for now" : "Cancel"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
