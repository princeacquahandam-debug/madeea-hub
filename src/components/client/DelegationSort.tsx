import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Sparkles, UserPlus } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { arr, lines, obj, runQuickAction, str, strs } from "@/lib/quickAi";
import { cn } from "@/lib/utils";

/**
 * Keep or hand over: the founder's desk, sorted (11 Nov 2026 call).
 *
 * Prince: "There's four things the founder should be focused on every single
 * day ... everything else needs to be correctly delegated to the correct
 * members of that particular team ... or it may also just propose a new
 * position." And the EA is not the only place work can go: "it can also
 * delegate things to other members of their team as well."
 *
 * So the founder names up to 4 focus areas (kept on their login, 0102), lists
 * what is on their desk, and can add next week's meetings from their own
 * connected calendar (client_calendar). Madeline sorts each item: keep, the
 * assistant, a named team member, or a role they do not have yet. Every item
 * that should go becomes a delegation plan in one click.
 */

export type Decision = "keep" | "assistant" | "team" | "new_role";

export interface SortPick {
  task: string;
  decision: Exclude<Decision, "keep">;
  who: string | null;
}

interface Row { ref: string; decision: Decision; who: string | null; reason: string }
interface NewRole { role: string; refs: string[]; reason: string }
interface Sorted { summary: string; rows: Row[]; new_roles: NewRole[] }

interface Meeting { id: string; title: string | null; starts_at: string; all_day: boolean | null }

const DECISIONS: Decision[] = ["keep", "assistant", "team", "new_role"];
const MAX_DESK = 25;

export function DelegationSort({
  assistantName, members, onPlan,
}: {
  assistantName: string | null | undefined;
  members: string[];
  onPlan: (pick: SortPick) => void;
}) {
  const qc = useQueryClient();
  const assistant = assistantName?.trim() || "your assistant";

  const [focus, setFocus] = useState<string[]>(["", "", "", ""]);
  const [desk, setDesk] = useState("");
  const [team, setTeam] = useState("");
  const [withMeetings, setWithMeetings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ sorted: Sorted; items: Record<string, string> } | null>(null);

  /* What they told us before: their focus (0102) and their last assessment. */
  const { data: saved } = useQuery({
    queryKey: ["client-portal", "delegation-focus"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data: u } = await supabase!.auth.getUser();
      const [{ data: me }, { data: last }] = await Promise.all([
        supabase!.from("client_users").select("focus_areas").eq("user_id", u.user?.id ?? "").maybeSingle(),
        supabase!.from("client_delegation_assessments")
          .select("draining_tasks, tasks_not_delegating, team_members")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        focus: ((me as { focus_areas?: string[] } | null)?.focus_areas ?? []) as string[],
        last: last as { draining_tasks: string | null; tasks_not_delegating: string | null; team_members: string | null } | null,
      };
    },
  });

  useEffect(() => {
    if (!saved) return;
    if (saved.focus.length) setFocus([...saved.focus, "", "", "", ""].slice(0, 4));
    const fromAssessment = [saved.last?.draining_tasks, saved.last?.tasks_not_delegating]
      .filter(Boolean).join("\n")
      .split(/\n|,|;/).map((s) => s.trim()).filter(Boolean);
    setDesk((d) => (d.trim() ? d : fromAssessment.join("\n")));
    setTeam((t) => (t.trim() ? t : saved.last?.team_members ?? ""));
  }, [saved]);

  /* Their own calendar for the coming week (connected under Connected accounts). */
  const { data: meetings = [] } = useQuery({
    queryKey: ["client-portal", "delegation-week"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const now = new Date();
      const week = new Date(now.getTime() + 7 * 864e5);
      const { data, error } = await supabase!.from("client_calendar")
        .select("id, title, starts_at, all_day")
        .gte("starts_at", now.toISOString()).lt("starts_at", week.toISOString())
        .order("starts_at").limit(25);
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
  });

  const deskItems = useMemo(
    () => desk.split("\n").map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, MAX_DESK),
    [desk],
  );

  async function sort() {
    setError("");
    setBusy(true);
    try {
      const cleanFocus = focus.map((f) => f.trim()).filter(Boolean);
      if (isSupabaseConfigured) {
        /* Remembered for next time; the sort itself does not depend on it. */
        const { error: fErr } = await supabase!.rpc("client_set_focus", { p_focus: cleanFocus });
        if (fErr) console.warn("client_set_focus", fErr.message);
        else qc.invalidateQueries({ queryKey: ["client-portal", "delegation-focus"] });
      }

      const items: Record<string, string> = {};
      deskItems.forEach((t, i) => { items[`D${i + 1}`] = t; });
      const mtgs = withMeetings ? meetings : [];
      mtgs.forEach((m, i) => { items[`M${i + 1}`] = m.title?.trim() || "Untitled meeting"; });

      const teamLines = [
        ...members.map((e) => `${e} (on MadeEA)`),
        ...team.split(/\n|;/).map((s) => s.trim()).filter(Boolean),
      ];

      const { data } = await runQuickAction<Sorted>({
        tool: "delegation_sort",
        format: "Sort the founder's desk: keep or hand over",
        page: "client_delegate",
        inputs: {
          focus_areas: cleanFocus.length ? cleanFocus.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(none given)",
          assistant: assistant,
          team: teamLines.length ? teamLines.join("\n") : "(nobody listed besides the assistant)",
          desk: lines(deskItems.map((t, i) => `D${i + 1}: ${t}`)),
          meetings: mtgs.length
            ? lines(mtgs.map((m, i) => `M${i + 1}: ${when(m)} ${m.title?.trim() || "Untitled meeting"}`))
            : "(none)",
        },
        check: (v) => check(v, items),
        demo: () => demo(items, cleanFocus, assistant),
      });
      setResult({ sorted: data, items });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Madeline couldn't sort that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const count = deskItems.length + (withMeetings ? meetings.length : 0);

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="text-[15px] font-semibold">What should stay on your desk?</h2>
        <p className="text-faint mt-1 text-sm">
          Name the few things only you should be spending your days on. Madeline sorts everything
          else: what to keep, what {assistant} can take, who on your team it belongs to, and where
          you may need a new role.
        </p>
      </div>

      <div>
        <div className="field-label mb-1.5">Your focus (up to 4)</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {focus.map((f, i) => (
            <input
              key={i}
              value={f}
              maxLength={120}
              onChange={(e) => setFocus((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={["Closing the funding round", "Key client relationships", "Product direction", "Hiring senior people"][i]}
              className="input"
              aria-label={`Focus area ${i + 1}`}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="field-label mb-1.5">What is on your desk? (one per line)</div>
        <textarea
          value={desk}
          onChange={(e) => setDesk(e.target.value)}
          rows={5}
          className="input resize-y"
          placeholder={"Approve the new website copy\nChase the overdue invoice from Acme\nWeekly product stand-up\nReply to investor questions"}
        />
        {deskItems.length >= MAX_DESK ? (
          <p className="text-faint mt-1 text-xs">The first {MAX_DESK} lines are sorted.</p>
        ) : null}
      </div>

      <div>
        <div className="field-label mb-1.5">Who else is on your team? (optional)</div>
        <input
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="input"
          placeholder="Sam: product; Lee: sales; Priya: finance"
        />
        {members.length ? (
          <p className="text-faint mt-1 text-xs">Already included from MadeEA: {members.join(", ")}.</p>
        ) : null}
      </div>

      {meetings.length ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withMeetings} onChange={(e) => setWithMeetings(e.target.checked)} />
          Include my {meetings.length} meeting{meetings.length === 1 ? "" : "s"} in the next 7 days
        </label>
      ) : null}

      {error ? <p className="text-sm" style={{ color: "var(--c-danger)" }}>{error}</p> : null}

      <button onClick={() => void sort()} disabled={busy || count === 0} className="btn-primary whitespace-nowrap">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {result ? "Sort again" : "Sort it for me"}
      </button>

      {result ? (
        <SortResult
          sorted={result.sorted}
          items={result.items}
          assistant={assistant}
          onPlan={onPlan}
        />
      ) : null}
    </section>
  );
}

function SortResult({
  sorted, items, assistant, onPlan,
}: {
  sorted: Sorted; items: Record<string, string>; assistant: string; onPlan: (p: SortPick) => void;
}) {
  const title: Record<Decision, string> = {
    keep: "Keep on your desk",
    assistant: `Hand to ${assistant}`,
    team: "Hand to your team",
    new_role: "Needs someone you don't have yet",
  };
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <p className="text-sm font-medium">{sorted.summary}</p>
      {DECISIONS.map((d) => {
        const rows = sorted.rows.filter((r) => r.decision === d);
        if (!rows.length) return null;
        return (
          <div key={d}>
            <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">
              {title[d]} · {rows.length}
            </div>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.ref} className={cn("rounded-lg border border-border p-3", d === "keep" && "bg-accent/5")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {items[r.ref]}
                        {r.ref.startsWith("M") ? <span className="text-faint ml-1.5 text-xs font-normal">meeting</span> : null}
                      </div>
                      {r.who && d === "team" ? <div className="text-faint text-xs">To {r.who}</div> : null}
                      <div className="text-faint mt-0.5 text-xs">{r.reason}</div>
                    </div>
                    {d !== "keep" ? (
                      <button
                        onClick={() => onPlan({ task: items[r.ref], decision: d, who: r.who })}
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                        style={{ border: "1px solid var(--c-border)" }}
                      >
                        Plan this <ArrowRight size={12} />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {d === "new_role" && sorted.new_roles.length ? (
              <ul className="mt-2 space-y-2">
                {sorted.new_roles.map((n) => (
                  <li key={n.role} className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-sm">
                    <UserPlus size={15} className="mt-0.5 shrink-0" style={{ color: "var(--c-accent)" }} />
                    <div>
                      <div className="font-medium">Consider a {n.role}</div>
                      <div className="text-faint text-xs">
                        {n.reason}
                        {n.refs.length ? ` Covers: ${n.refs.map((x) => items[x]).filter(Boolean).join("; ")}.` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── the answer, checked before it is shown ── */

function check(v: unknown, items: Record<string, string>): Sorted {
  const o = obj(v);
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const x of arr(o.rows)) {
    const r = obj(x);
    const ref = str(r.ref, 8);
    const decision = str(r.decision, 12) as Decision;
    if (!items[ref] || seen.has(ref) || !DECISIONS.includes(decision)) continue;
    seen.add(ref);
    rows.push({ ref, decision, who: str(r.who, 80) || null, reason: str(r.reason, 160) });
  }
  if (Object.keys(items).length && rows.length === 0) {
    throw new Error("Madeline's answer couldn't be read. Try again.");
  }
  const new_roles: NewRole[] = arr(o.new_roles).slice(0, 2).map((x) => {
    const n = obj(x);
    return { role: str(n.role, 60), refs: strs(n.refs, 8).filter((r) => items[r]), reason: str(n.reason, 200) };
  }).filter((n) => n.role);
  return { summary: str(o.summary, 200), rows, new_roles };
}

/** Demo mode (no Supabase): a rough sort from the same facts. */
function demo(items: Record<string, string>, focus: string[], assistant: string): Sorted {
  const words = focus.join(" ").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const rows: Row[] = Object.entries(items).map(([ref, t]) => {
    const keep = words.some((w) => t.toLowerCase().includes(w));
    return keep
      ? { ref, decision: "keep", who: null, reason: "Serves one of your focus areas." }
      : { ref, decision: "assistant", who: assistant, reason: "Routine work an assistant can run." };
  });
  const kept = rows.filter((r) => r.decision === "keep").length;
  return {
    summary: `Keep ${kept} of ${rows.length}; ${rows.length - kept} go to ${assistant}.`,
    rows: [...rows.filter((r) => r.decision === "keep"), ...rows.filter((r) => r.decision !== "keep")],
    new_roles: [],
  };
}

function when(m: Meeting): string {
  const d = new Date(m.starts_at);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return m.all_day ? `${day} (all day)` : `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}
