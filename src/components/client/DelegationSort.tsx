import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, Sparkles, UserPlus, Users } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { arr, lines, obj, runQuickAction, str, strs } from "@/lib/quickAi";
import { cn } from "@/lib/utils";
import type { OrgPerson } from "./ClientOrg";

/**
 * Keep or hand over: the founder's desk, sorted (11 Nov 2026 call).
 *
 * Prince: "four things the founder should be focused on every single day ...
 * everything else needs to be correctly delegated to the correct members of
 * that particular team ... or it may also just propose a new position."
 * Abder: the coach works from what the platform already knows, "indicating for
 * the founder: you need to delegate this one ... with one action", after which
 * it shows as assigned to someone else. Rowena: where nobody covers a function
 * yet, say which part the EA can take until somebody does.
 *
 * So:
 *  - the founder's focus areas and desk are kept on their login (0102); next
 *    week's meetings come from their own connected calendar (client_calendar);
 *    the people come from their organisation (client_org, 0102);
 *  - it sorts by itself once a day when the founder opens Delegate (one AI call
 *    a day, inside the daily budget), and on demand with "Sort again";
 *  - each suggestion hands over in one click: a task on the assistant's board or
 *    on a team member's (client_quick_delegate), or a full plan.
 */

export type Decision = "keep" | "assistant" | "team" | "new_role";

export interface SortPick {
  task: string;
  decision: Exclude<Decision, "keep">;
  /** The person, when the coach named one from the organisation. */
  person: OrgPerson | null;
}

interface Row { ref: string; decision: Decision; who: string | null; reason: string; ea_part: string | null }
interface NewRole { role: string; refs: string[]; reason: string }
interface Sorted { summary: string; rows: Row[]; new_roles: NewRole[] }
interface Meeting { id: string; title: string | null; starts_at: string; all_day: boolean | null }
interface Stored { day: string; key: string; sorted: Sorted; items: Record<string, string> }

const DECISIONS: Decision[] = ["keep", "assistant", "team", "new_role"];
const MAX_DESK = 25;
const today = () => new Date().toISOString().slice(0, 10);

/* Per-viewer conveniences only (the day's sort, what was handed over); the
   tasks themselves are the record. Every access is guarded: storage can be off. */
function load<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function keep(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ }
}

export function DelegationSort({
  assistantName, founderName, org, onPlan, onEditOrg,
}: {
  assistantName: string | null | undefined;
  founderName?: string | null;
  org: OrgPerson[];
  onPlan: (pick: SortPick) => void;
  onEditOrg: () => void;
}) {
  const qc = useQueryClient();
  const assistant = assistantName?.trim() || "your assistant";

  const [focus, setFocus] = useState<string[]>(["", "", "", ""]);
  const [desk, setDesk] = useState("");
  const [withMeetings, setWithMeetings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ sorted: Sorted; items: Record<string, string> } | null>(null);
  const [handed, setHanded] = useState<Record<string, { to: string; at: number }>>({});
  const [handing, setHanding] = useState<string | null>(null);
  const [uid, setUid] = useState<string>("");
  const autoRan = useRef(false);
  /* Set once the saved focus and desk are in state, so the daily sort sorts them. */
  const [hydrated, setHydrated] = useState(false);

  const { data: saved } = useQuery({
    queryKey: ["client-portal", "delegation-context"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data: u } = await supabase!.auth.getUser();
      const id = u.user?.id ?? "";
      const [{ data: me }, { data: last }] = await Promise.all([
        supabase!.from("client_users").select("focus_areas, desk_items").eq("user_id", id).maybeSingle(),
        supabase!.from("client_delegation_assessments")
          .select("draining_tasks, tasks_not_delegating")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const m = me as { focus_areas?: string[]; desk_items?: string[] } | null;
      const a = last as { draining_tasks: string | null; tasks_not_delegating: string | null } | null;
      return {
        uid: id,
        focus: m?.focus_areas ?? [],
        desk: m?.desk_items?.length
          ? m.desk_items
          : [a?.draining_tasks, a?.tasks_not_delegating].filter(Boolean).join("\n")
              .split(/\n|,|;/).map((s) => s.trim()).filter(Boolean),
      };
    },
  });

  useEffect(() => {
    if (!saved) return;
    setUid(saved.uid);
    if (saved.focus.length) setFocus([...saved.focus, "", "", "", ""].slice(0, 4));
    setDesk((d) => (d.trim() ? d : saved.desk.join("\n")));
    const h = load<Record<string, { to: string; at: number }>>(`madeea.deleg.handed.${saved.uid}`) ?? {};
    const fresh = Object.fromEntries(Object.entries(h).filter(([, v]) => Date.now() - v.at < 14 * 864e5));
    setHanded(fresh);
    setHydrated(true);
  }, [saved]);

  const { data: meetings = [], isFetched: meetingsReady } = useQuery({
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
  const cleanFocus = focus.map((f) => f.trim()).filter(Boolean);
  const mtgs = withMeetings ? meetings : [];

  const items = useMemo(() => {
    const out: Record<string, string> = {};
    deskItems.forEach((t, i) => { out[`D${i + 1}`] = t; });
    mtgs.forEach((m, i) => { out[`M${i + 1}`] = `${m.title?.trim() || "Untitled meeting"} (${when(m)})`; });
    return out;
  }, [deskItems, mtgs]);

  const inputs = {
    founder: founderName?.trim() || "(not given)",
    focus_areas: cleanFocus.length ? cleanFocus.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(none given)",
    assistant,
    team: org.length
      ? org.map((p) => `${p.name}${p.title ? `, ${p.title}` : ""}${p.area ? ` (${p.area})` : ""}${p.handles ? `: ${p.handles}` : ""}`).join("\n")
      : "(nobody listed besides the assistant)",
    desk: lines(deskItems.map((t, i) => `D${i + 1}: ${t}`)),
    meetings: mtgs.length ? lines(mtgs.map((m, i) => `M${i + 1}: ${when(m)} ${m.title?.trim() || "Untitled meeting"}`)) : "(none)",
  };
  const inputsKey = JSON.stringify(inputs);
  const storeKey = uid ? `madeea.deleg.sort.${uid}` : "";

  async function sort(remember = true) {
    setError("");
    setBusy(true);
    try {
      if (remember && isSupabaseConfigured) {
        /* Remembered for next time; the sort does not depend on it. */
        const { error: fErr } = await supabase!.rpc("client_set_delegation_context", { p_focus: cleanFocus, p_desk: deskItems });
        if (fErr) console.warn("client_set_delegation_context", fErr.message);
        else void qc.invalidateQueries({ queryKey: ["client-portal", "delegation-context"] });
      }
      const snapshot = { ...items };
      const { data } = await runQuickAction<Sorted>({
        tool: "delegation_sort",
        format: "Sort the founder's desk: keep or hand over",
        page: "client_delegate",
        inputs,
        check: (v) => check(v, snapshot, org, assistant),
        demo: () => demo(snapshot, cleanFocus, assistant),
      });
      setResult({ sorted: data, items: snapshot });
      if (storeKey) keep(storeKey, { day: today(), key: inputsKey, sorted: data, items: snapshot } satisfies Stored);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Madeline couldn't sort that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /* Once a day, by itself: today's stored sort if nothing changed, else a new one. */
  useEffect(() => {
    if (autoRan.current || !hydrated || !meetingsReady || !uid) return;
    autoRan.current = true;
    const stored = load<Stored>(`madeea.deleg.sort.${uid}`);
    if (stored && stored.day === today()) {
      setResult({ sorted: stored.sorted, items: stored.items });
      return;
    }
    if (Object.keys(items).length) void sort(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, meetingsReady, uid]);

  /** One action: a task for the assistant or a team member on MadeEA. */
  async function handOver(ref: string, title: string, why: string, to: { name: string; email: string | null }) {
    setError("");
    setHanding(ref);
    try {
      const notes = `From the Delegation Coach. ${why}`.trim();
      const { error: e } = await supabase!.rpc("client_quick_delegate", {
        p_title: title, p_notes: notes, p_member_email: to.email,
      });
      if (e) throw new Error(e.message);
      const next = { ...handed, [title]: { to: to.name, at: Date.now() } };
      setHanded(next);
      if (uid) keep(`madeea.deleg.handed.${uid}`, next);
      /* Off the founder's desk once it is someone else's. */
      if (ref.startsWith("D")) {
        const rest = deskItems.filter((d) => d !== title);
        setDesk(rest.join("\n"));
        void supabase!.rpc("client_set_delegation_context", { p_focus: cleanFocus, p_desk: rest });
      }
      void qc.invalidateQueries({ queryKey: ["client-portal", "tasks"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't hand that over.");
    } finally {
      setHanding(null);
    }
  }

  const count = Object.keys(items).length;
  const person = (name: string | null) =>
    name ? org.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null : null;

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="text-[15px] font-semibold">What should stay on your desk?</h2>
        <p className="text-faint mt-1 text-sm">
          Name the few things only you should be spending your days on. Madeline sorts the rest
          once a day: what to keep, what {assistant} can take, who in your organisation it belongs
          to, and where you may need a new role. Hand anything over in one click.
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
          placeholder={"Approve the new website copy\nChase the overdue invoice from Acme\nMonthly budget review\nReply to investor questions"}
        />
        {deskItems.length >= MAX_DESK ? <p className="text-faint mt-1 text-xs">The first {MAX_DESK} lines are sorted.</p> : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-faint flex items-center gap-1.5">
          <Users size={14} />
          {org.length
            ? `Sorting with your organisation: ${assistant} and ${org.length} ${org.length === 1 ? "person" : "people"}`
            : `Only ${assistant} so far. Add who reports to you for better routing.`}
        </span>
        <button type="button" onClick={onEditOrg} className="text-sm font-medium hover:underline" style={{ color: "var(--c-accent)" }}>
          {org.length ? "Edit organisation" : "Add your organisation"}
        </button>
      </div>

      {meetings.length ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withMeetings} onChange={(e) => setWithMeetings(e.target.checked)} />
          Include my {meetings.length} meeting{meetings.length === 1 ? "" : "s"} in the next 7 days
        </label>
      ) : null}

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <button onClick={() => void sort()} disabled={busy || count === 0} className="btn-primary whitespace-nowrap">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {result ? "Sort again" : "Sort it for me"}
      </button>

      {result ? (
        <SortResult
          sorted={result.sorted}
          items={result.items}
          assistant={assistant}
          handed={handed}
          handing={handing}
          person={person}
          onHand={handOver}
          onPlan={onPlan}
        />
      ) : null}
    </section>
  );
}

function SortResult({
  sorted, items, assistant, handed, handing, person, onHand, onPlan,
}: {
  sorted: Sorted;
  items: Record<string, string>;
  assistant: string;
  handed: Record<string, { to: string; at: number }>;
  handing: string | null;
  person: (name: string | null) => OrgPerson | null;
  onHand: (ref: string, title: string, why: string, to: { name: string; email: string | null }) => void;
  onPlan: (p: SortPick) => void;
}) {
  const title: Record<Decision, string> = {
    keep: "Keep on your desk",
    assistant: `Hand to ${assistant}`,
    team: "Hand to your team",
    new_role: "No one covers this yet",
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
              {rows.map((r) => {
                const text = items[r.ref];
                const p = d === "team" ? person(r.who) : null;
                const done = handed[text] ?? (r.ea_part ? handed[r.ea_part] : undefined);
                const busy = handing === r.ref;
                return (
                  <li key={r.ref} className={cn("rounded-lg border border-border p-3", d === "keep" && "bg-accent/5")}>
                    <div className="text-sm font-medium">{text}</div>
                    {p ? <div className="text-faint text-xs">To {p.name}{p.title ? `, ${p.title}` : ""}</div> : null}
                    <div className="text-faint mt-0.5 text-xs">{r.reason}</div>
                    {d === "new_role" && r.ea_part ? (
                      <div className="mt-2 rounded-md p-2 text-xs" style={{ background: "var(--c-surface-2)" }}>
                        <span className="font-medium">Until then, {assistant} can:</span> {r.ea_part}
                      </div>
                    ) : null}

                    {d !== "keep" ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {done ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                            <Check size={13} /> Handed to {done.to}
                          </span>
                        ) : (
                          <>
                            {d === "assistant" ? (
                              <HandBtn busy={busy} label={`Hand to ${assistant}`}
                                       onClick={() => onHand(r.ref, text, r.reason, { name: assistant, email: null })} />
                            ) : null}
                            {d === "team" && p?.member_email ? (
                              <HandBtn busy={busy} label={`Hand to ${p.name}`}
                                       onClick={() => onHand(r.ref, text, r.reason, { name: p.name, email: p.member_email })} />
                            ) : null}
                            {d === "new_role" && r.ea_part ? (
                              <HandBtn busy={busy} label={`Hand this part to ${assistant}`}
                                       onClick={() => onHand(r.ref, r.ea_part!, `${text}. ${r.reason}`, { name: assistant, email: null })} />
                            ) : null}
                            <button
                              type="button"
                              onClick={() => onPlan({ task: text, decision: d, person: p })}
                              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                              style={{ border: "1px solid var(--c-border)" }}
                            >
                              Plan it first <ArrowRight size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
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

function HandBtn({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
            className="btn-primary flex items-center gap-1 whitespace-nowrap px-2.5 py-1.5 text-xs">
      {busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
      {label}
    </button>
  );
}

/* ── the answer, checked before it is shown ── */

function check(v: unknown, items: Record<string, string>, org: OrgPerson[], assistant: string): Sorted {
  const o = obj(v);
  const names = new Set(org.map((p) => p.name.toLowerCase()));
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const x of arr(o.rows)) {
    const r = obj(x);
    const ref = str(r.ref, 8);
    let decision = str(r.decision, 12) as Decision;
    if (!items[ref] || seen.has(ref) || !DECISIONS.includes(decision)) continue;
    let who = str(r.who, 80) || null;
    /* "team" must name someone who is actually in the organisation. */
    if (decision === "team" && (!who || !names.has(who.toLowerCase()))) decision = "new_role";
    if (decision === "assistant") who = assistant;
    if (decision !== "team") who = decision === "assistant" ? who : null;
    seen.add(ref);
    rows.push({
      ref, decision, who,
      reason: str(r.reason, 160),
      ea_part: decision === "new_role" ? str(r.ea_part, 160) || null : null,
    });
  }
  if (Object.keys(items).length && rows.length === 0) {
    throw new Error("Madeline's answer couldn't be read. Try again.");
  }
  const order = (r: Row) => DECISIONS.indexOf(r.decision);
  rows.sort((a, b) => order(a) - order(b));
  const new_roles: NewRole[] = arr(o.new_roles).slice(0, 2).map((x) => {
    const n = obj(x);
    return { role: str(n.role, 60), refs: strs(n.refs, 8).filter((r) => items[r]), reason: str(n.reason, 200) };
  }).filter((n) => n.role);
  return { summary: summarise(rows, assistant), rows, new_roles };
}

/* The counts line is worked out here, never taken from the model: in the first
   live test (12 Nov) it said "3 go to Prince" over a list of 5. */
function summarise(rows: Row[], assistant: string): string {
  const n = (d: Decision) => rows.filter((r) => r.decision === d).length;
  const people = new Map<string, number>();
  for (const r of rows) if (r.decision === "team" && r.who) people.set(r.who, (people.get(r.who) ?? 0) + 1);
  const parts = [
    n("assistant") ? `${n("assistant")} to ${assistant}` : "",
    ...[...people].map(([who, c]) => `${c} to ${who}`),
    n("new_role") ? `${n("new_role")} need${n("new_role") === 1 ? "s" : ""} someone you don't have yet` : "",
  ].filter(Boolean);
  return `Keep ${n("keep")} of ${rows.length}${parts.length ? `; ${parts.join(", ")}` : ""}.`;
}

/** Demo mode (no Supabase): a rough sort from the same facts. */
function demo(items: Record<string, string>, focus: string[], assistant: string): Sorted {
  const words = focus.join(" ").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const rows: Row[] = Object.entries(items).map(([ref, t]) => {
    const k = words.some((w) => t.toLowerCase().includes(w));
    return k
      ? { ref, decision: "keep", who: null, reason: "Serves one of your focus areas.", ea_part: null }
      : { ref, decision: "assistant", who: assistant, reason: "Routine work an assistant can run.", ea_part: null };
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
  return m.all_day ? `${day}, all day` : `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}
