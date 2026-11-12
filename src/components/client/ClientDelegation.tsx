import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Copy, Loader2, Send, Sparkles, Target,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { dateOnly, dayLabel, localDayKey } from "./format";
import { DelegationSort, type SortPick } from "./DelegationSort";
import { ClientOrg, ORG_KEY, type OrgPerson } from "./ClientOrg";

/**
 * The Delegation Coach, in the client portal.
 *
 * WHY HERE AND NOT IN MY DAY, which is where it was asked for. The plan this
 * produces carries team_member, autonomy_level and handoff_message: it coaches
 * the person HANDING WORK OVER. In this business that is the client, and My Day
 * belongs to the assistant, who is the one being handed to. Putting it there
 * would have given the coaching tool to everybody except the person it coaches.
 *
 * WHAT MAKES IT PART OF THE PRODUCT RATHER THAN A WORKSHEET. The last step is
 * not a PDF. Handing a plan over creates a real task on the account, assigned
 * to the accountable assistant, with the handoff message attached as its notes
 * (client_hand_off_plan, 0076). The plan and the work it produced stay linked,
 * so "did anything come of that?" has an answer.
 *
 * THE FOUR ORIGINAL SCREENS ARE ONE. Welcome, Assessment, TaskSelection and
 * PlanBuilder were four routed pages in the standalone app, which needs
 * navigation, a wizard shell and four URLs to hold three text boxes each. A
 * client delegating one task is doing one sitting of work; the step state lives
 * in this component and the portal keeps its flat tab structure.
 *
 * FOR THE FOUNDER, AND NOT ONLY TO THE ASSISTANT (11 Nov 2026 call). Prince:
 * the coach exists so a founder keeps only the few things they should be doing
 * and hands everything else "to the correct members of that particular team",
 * because "the EA can't do everything". So the list screen opens with the
 * keep-or-hand-over sort (DelegationSort), and a plan can go to the assistant
 * (a task on their board), to one of the client's own team members on MadeEA
 * (a task on theirs, 0102), or to someone outside MadeEA (the founder sends the
 * message; the plan is marked handed over).
 */

/** Who the plan goes to. */
type Recipient =
  | { kind: "assistant" }
  | { kind: "member"; email: string; name: string }
  | { kind: "other" };

interface Plan {
  id: string;
  task_name: string;
  team_member: string | null;
  outcome: string | null;
  autonomy_level: string | null;
  deadline: string | null;
  handoff_message: string | null;
  success_criteria: string[];
  best_practices: string[];
  risks: { risk: string; mitigation: string }[];
  check_in_schedule: { frequency?: string; format?: string; topics?: string[] } | null;
  status: "draft" | "active" | "done";
  task_id: string | null;
  created_at: string;
}

type Step = "list" | "assess" | "describe" | "review";

const AUTONOMY = [
  { v: "recommend", label: "Check with me first", hint: "They propose, you approve before it happens." },
  { v: "act_inform", label: "Act, then tell me", hint: "They decide and keep you posted." },
  { v: "own", label: "Own it outright", hint: "They handle it. You see the outcome." },
];

const EMPTY_PLAN = {
  task_name: "", outcome: "", context: "", team_member: "",
  autonomy_level: "act_inform", support_needed: "", deadline: "",
};

export function ClientDelegation({
  readOnly = false, assistantName = null, founderName = null,
}: { readOnly?: boolean; assistantName?: string | null; founderName?: string | null }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("list");
  const [error, setError] = useState("");
  const [to, setTo] = useState<Recipient>({ kind: "assistant" });
  /* Started from the sort: the assessment is skipped, so Back returns to the list. */
  const [fromSort, setFromSort] = useState(false);
  const [copied, setCopied] = useState(false);
  const assistant = assistantName?.trim() || "your assistant";

  /* The client's own team members on MadeEA (0078). Emails are the primary's only (0074). */
  const { data: members = [] } = useQuery({
    queryKey: ["client-portal", "people"],
    enabled: isSupabaseConfigured && !readOnly,
    queryFn: async () => {
      const { data, error } = await supabase!.from("client_people").select("role, email");
      if (error) throw error;
      return (data ?? []) as { role: string; email: string | null }[];
    },
    select: (rows) => rows.filter((p) => p.role === "member" && p.email).map((p) => p.email as string),
  });

  /* Who reports to the founder (0102). Filled in before the coach is used. */
  const { data: org = [], isFetched: orgReady } = useQuery({
    queryKey: ORG_KEY,
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase!.from("client_org")
        .select("id, name, title, area, handles, member_email").order("position");
      if (error) throw error;
      return (data ?? []) as OrgPerson[];
    },
  });
  const [editOrg, setEditOrg] = useState(false);
  const [orgSkipped, setOrgSkipped] = useState(() => {
    try { return localStorage.getItem("madeea.deleg.orgSkipped") === "1"; } catch { return false; }
  });
  const askOrg = !readOnly && orgReady && org.length === 0 && !orgSkipped;

  function startFromSort(pick: SortPick) {
    const p = pick.person;
    const recipient: Recipient =
      pick.decision === "assistant" ? { kind: "assistant" }
      : p?.member_email ? { kind: "member", email: p.member_email, name: p.name }
      : { kind: "other" };
    setTo(recipient);
    setDraft({
      ...EMPTY_PLAN,
      task_name: pick.task,
      team_member:
        recipient.kind === "assistant" ? assistant
        : p ? `${p.name}${p.title ? ` (${p.title})` : ""}`
        : "",
    });
    setFromSort(true);
    setStep("describe");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const [assessment, setAssessment] = useState({
    draining_tasks: "", tasks_not_delegating: "", delegation_barriers: "", team_members: "",
  });
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [insights, setInsights] = useState<string>("");

  const [draft, setDraft] = useState({ ...EMPTY_PLAN });
  const [generated, setGenerated] = useState<Partial<Plan> | null>(null);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["client-portal", "delegation-plans"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_delegation_plans")
        .select("id, task_name, team_member, outcome, autonomy_level, deadline, handoff_message, success_criteria, best_practices, risks, check_in_schedule, status, task_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });

  /** Every AI step goes through one function with a `kind`. See the Edge Function. */
  async function ask(kind: string, data: Record<string, unknown>) {
    const { data: res, error } = await supabase!.functions.invoke("delegation-coach", {
      body: { kind, data },
    });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      let msg = "Madeline couldn't be reached.";
      if (ctx?.text) {
        try {
          const parsed = JSON.parse(await ctx.text()) as { error?: string };
          if (parsed.error) msg = parsed.error;
        } catch { /* keep the fallback */ }
      }
      throw new Error(msg);
    }
    return (res as { result?: Record<string, unknown> })?.result ?? {};
  }

  const runAssessment = useMutation({
    mutationFn: async () => {
      const result = await ask("assessment", assessment);
      const text = String(
        (result as Record<string, unknown>).ai_insights ??
        (result as Record<string, unknown>).insights ??
        (result as Record<string, unknown>).output ?? "",
      );
      const { data, error } = await supabase!.rpc("client_save_assessment", {
        p_draining: assessment.draining_tasks,
        p_not_delegating: assessment.tasks_not_delegating,
        p_barriers: assessment.delegation_barriers,
        p_team: assessment.team_members,
        p_insights: text || null,
      });
      if (error) throw error;
      return { id: data as string, text };
    },
    onSuccess: ({ id, text }) => {
      setAssessmentId(id);
      setInsights(text);
      setDraft((d) => ({ ...d, team_member: d.team_member || assistant }));
      setStep("describe");
    },
  });

  const buildPlan = useMutation({
    mutationFn: async () => {
      const result = await ask("plan", draft);
      return result as Partial<Plan>;
    },
    onSuccess: (r) => { setGenerated(r); setStep("review"); },
  });

  const savePlan = useMutation({
    mutationFn: async (handOff: boolean) => {
      const { data: id, error } = await supabase!.rpc("client_save_plan", {
        p_plan: {
          ...draft,
          assessment_id: assessmentId,
          success_criteria: generated?.success_criteria ?? [],
          best_practices: generated?.best_practices ?? [],
          risks: generated?.risks ?? [],
          check_in_schedule: generated?.check_in_schedule ?? null,
          handoff_message: generated?.handoff_message ?? null,
        },
      });
      if (error) throw error;
      if (handOff) {
        const { error: hoErr } =
          to.kind === "assistant"
            ? await supabase!.rpc("client_hand_off_plan", { p_plan_id: id })
            : to.kind === "member"
              ? await supabase!.rpc("client_hand_off_plan_to_member", { p_plan_id: id, p_email: to.email })
              : await supabase!.rpc("client_mark_plan_sent", { p_plan_id: id });
        if (hoErr) throw hoErr;
      }
      return id as string;
    },
    onSuccess: () => {
      setDraft({ ...EMPTY_PLAN });
      setGenerated(null);
      setAssessmentId(null);
      setInsights("");
      setTo({ kind: "assistant" });
      setFromSort(false);
      setCopied(false);
      setStep("list");
      qc.invalidateQueries({ queryKey: ["client-portal", "delegation-plans"] });
      qc.invalidateQueries({ queryKey: ["client-portal", "tasks"] });
    },
  });

  /* Takes a thunk rather than a mutation, so it works for the ones that take an
     argument and the ones that do not, without a cast at every call site. */
  async function run(fn: () => Promise<unknown>) {
    setError("");
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
  }

  const busy = runAssessment.isPending || buildPlan.isPending || savePlan.isPending;

  if (readOnly) {
    return (
      <div className="space-y-4">
        <p className="text-faint text-sm">
          Delegation plans on this account. Only the primary contact can create them.
        </p>
        <PlanList plans={plans} loading={isLoading} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="flex items-start gap-2 text-sm text-red-500">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}

      {step === "list" ? (
        <>
          {askOrg || editOrg ? (
            <ClientOrg
              people={org}
              members={members}
              assistantName={assistant}
              founderName={founderName?.trim() || "You"}
              intro={askOrg && !editOrg}
              onDone={() => {
                if (askOrg) {
                  setOrgSkipped(true);
                  try { localStorage.setItem("madeea.deleg.orgSkipped", "1"); } catch { /* storage off */ }
                }
                setEditOrg(false);
              }}
            />
          ) : (
            <DelegationSort
              assistantName={assistantName}
              org={org}
              onPlan={startFromSort}
              onEditOrg={() => setEditOrg(true)}
            />
          )}
          <section>
            <h2 className="mb-1 text-[15px] font-semibold">Hand something over</h2>
            <p className="text-faint mb-3 text-sm">
              Work through one task at a time: what to let go of, what good looks like, and
              the message that hands it over, to {assistant} or to someone on your team. It
              becomes a real task on their board when you are ready.
            </p>
            <button
              onClick={() => { setFromSort(false); setTo({ kind: "assistant" }); setStep("assess"); }}
              className="btn-primary whitespace-nowrap"
            >
              <Sparkles size={15} /> Start a delegation plan
            </button>
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Your plans</h2>
            <PlanList plans={plans} loading={isLoading} />
          </section>
        </>
      ) : null}

      {step === "assess" ? (
        <section className="card space-y-3 p-5">
          <StepHead n={1} of={3} title="Where is your time going?" />
          <Field label="What is eating your week?" value={assessment.draining_tasks}
                 onChange={(v) => setAssessment((a) => ({ ...a, draining_tasks: v }))}
                 placeholder="Inbox triage, chasing suppliers, rebooking calls..." />
          <Field label="What have you been holding onto that someone else could do?"
                 value={assessment.tasks_not_delegating}
                 onChange={(v) => setAssessment((a) => ({ ...a, tasks_not_delegating: v }))} />
          <Field label="What stops you handing it over?" value={assessment.delegation_barriers}
                 onChange={(v) => setAssessment((a) => ({ ...a, delegation_barriers: v }))}
                 placeholder="Faster to do it myself, hard to explain, it has to be right..." />
          <Field label="Who could take it?" value={assessment.team_members}
                 onChange={(v) => setAssessment((a) => ({ ...a, team_members: v }))} />
          <Actions
            busy={busy}
            onBack={() => setStep("list")}
            onNext={() => void run(() => runAssessment.mutateAsync())}
            nextLabel="Continue"
            disabled={!assessment.draining_tasks.trim()}
          />
        </section>
      ) : null}

      {step === "describe" ? (
        <section className="card space-y-3 p-5">
          <StepHead n={2} of={3} title="What are you handing over?" />
          {insights ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <div className="text-muted mb-1 flex items-center gap-1.5 text-xs font-semibold">
                <Sparkles size={12} /> What stood out
              </div>
              <p className="whitespace-pre-wrap">{insights}</p>
            </div>
          ) : null}
          <Field label="The task" value={draft.task_name} placeholder="Weekly supplier chase"
                 onChange={(v) => setDraft((d) => ({ ...d, task_name: v }))} single />
          <Field label="What does done look like?" value={draft.outcome}
                 onChange={(v) => setDraft((d) => ({ ...d, outcome: v }))} />
          <Field label="What do they need to know?" value={draft.context}
                 onChange={(v) => setDraft((d) => ({ ...d, context: v }))} />
          <div>
            <div className="field-label mb-1.5">Who is taking it?</div>
            <div className="flex flex-col gap-2">
              <Choice
                on={to.kind === "assistant"}
                title={assistantName?.trim() ? `${assistantName.trim()}, your assistant` : "Your assistant"}
                hint="Goes on their board as a task, with the message attached."
                onClick={() => { setTo({ kind: "assistant" }); setDraft((d) => ({ ...d, team_member: assistant })); }}
              />
              {/* The organisation first (0102), then any MadeEA login not in it. */}
              {org.map((p) => {
                const label = `${p.name}${p.title ? ` (${p.title})` : ""}`;
                return (
                  <Choice
                    key={p.id ?? p.name}
                    on={p.member_email ? to.kind === "member" && to.email === p.member_email : to.kind === "other" && draft.team_member === label}
                    title={label}
                    hint={p.member_email
                      ? "On MadeEA: goes on their board as a task."
                      : "Not on MadeEA. You send them the message yourself."}
                    onClick={() => {
                      setTo(p.member_email ? { kind: "member", email: p.member_email, name: p.name } : { kind: "other" });
                      setDraft((d) => ({ ...d, team_member: label }));
                    }}
                  />
                );
              })}
              {members.filter((m) => !org.some((p) => p.member_email === m)).map((m) => (
                <Choice
                  key={m}
                  on={to.kind === "member" && to.email === m}
                  title={m}
                  hint="On your team in MadeEA: goes on their board as a task."
                  onClick={() => { setTo({ kind: "member", email: m, name: m }); setDraft((d) => ({ ...d, team_member: m })); }}
                />
              ))}
              <Choice
                on={to.kind === "other" && !org.some((p) => !p.member_email && draft.team_member === `${p.name}${p.title ? ` (${p.title})` : ""}`)}
                title="Someone else"
                hint="Not listed. You send them the message yourself."
                onClick={() => { setTo({ kind: "other" }); setDraft((d) => ({ ...d, team_member: "" })); }}
              />
            </div>
            {to.kind === "other" ? (
              <input value={draft.team_member} placeholder="Their name and role, e.g. Sam (product)"
                     onChange={(e) => setDraft((d) => ({ ...d, team_member: e.target.value }))}
                     className="input mt-2" aria-label="Their name" />
            ) : null}
          </div>

          <div>
            <div className="text-muted mb-1.5 text-xs font-semibold">How much freedom?</div>
            <div className="flex flex-col gap-2">
              {AUTONOMY.map((a) => (
                <button
                  key={a.v}
                  onClick={() => setDraft((d) => ({ ...d, autonomy_level: a.v }))}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition-colors",
                    draft.autonomy_level === a.v
                      ? "border-accent bg-accent/15 text-accent-soft"
                      : "border-border bg-surface-2 hover:border-accent/50",
                  )}
                >
                  <div className="font-medium">{a.label}</div>
                  <div className="text-xs opacity-75">{a.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <Field label="Anything they will need from you?" value={draft.support_needed}
                 onChange={(v) => setDraft((d) => ({ ...d, support_needed: v }))} />
          <div>
            <div className="text-muted mb-1.5 text-xs font-semibold">By when (optional)</div>
            <input type="date" value={draft.deadline}
                   onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))}
                   className="input sm:w-56" />
          </div>

          <Actions busy={busy} onBack={() => setStep(fromSort ? "list" : "assess")}
                   onNext={() => void run(() => buildPlan.mutateAsync())} nextLabel="Build the plan"
                   disabled={!draft.task_name.trim() || (to.kind === "other" && !draft.team_member.trim())} />
        </section>
      ) : null}

      {step === "review" && generated ? (
        <section className="space-y-4">
          <StepHead n={3} of={3} title={draft.task_name} />

          {generated.success_criteria?.length ? (
            <Block title="What good looks like" icon={Target}>
              <ul className="space-y-1.5">
                {generated.success_criteria.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0" style={{ color: "var(--c-accent)" }} />
                    {c}
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          {generated.risks?.length ? (
            <Block title="What could go wrong" icon={AlertTriangle}>
              <ul className="space-y-2">
                {generated.risks.map((r, i) => (
                  <li key={i} className="text-sm">
                    <div>{r.risk}</div>
                    {r.mitigation ? <div className="text-faint text-xs">Mitigation: {r.mitigation}</div> : null}
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          {generated.handoff_message ? (
            <Block title="The message to send" icon={Send}>
              <p className="whitespace-pre-wrap text-sm">{generated.handoff_message}</p>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(generated.handoff_message ?? "").then(() => setCopied(true));
                }}
                className="mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                style={{ border: "1px solid var(--c-border)" }}
              >
                <Copy size={12} /> {copied ? "Copied" : "Copy the message"}
              </button>
            </Block>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setStep("describe")} disabled={busy}
                    className="rounded-xl px-4 py-2.5 text-sm"
                    style={{ border: "1px solid var(--c-border)" }}>
              Back
            </button>
            <button onClick={() => void run(() => savePlan.mutateAsync(false))} disabled={busy}
                    className="rounded-xl px-4 py-2.5 text-sm"
                    style={{ border: "1px solid var(--c-border)" }}>
              Save as draft
            </button>
            <button onClick={() => void run(() => savePlan.mutateAsync(true))} disabled={busy}
                    className="btn-primary whitespace-nowrap">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              {to.kind === "other" ? "Mark as handed over" : "Hand it over"}
            </button>
          </div>
          <p className="text-faint text-xs">
            {to.kind === "assistant"
              ? <>Handing it over puts this on {assistant}&rsquo;s board as a task, with the message above attached.</>
              : to.kind === "member"
                ? <>Handing it over puts this on {to.name}&rsquo;s board as a task, with the message above attached.</>
                : <>Copy the message and send it to {draft.team_member.trim() || "them"} yourself. The plan is then kept as handed over.</>}
          </p>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function PlanList({ plans, loading }: { plans: Plan[]; loading: boolean }) {
  if (loading) return <p className="text-faint text-sm">Loading&hellip;</p>;
  if (plans.length === 0) {
    return <p className="text-faint text-sm">No delegation plans yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {plans.map((p) => (
        <li key={p.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm font-medium">{p.task_name}</span>
            <span className="text-faint text-xs">
              {p.status === "active" ? "Handed over" : p.status === "done" ? "Done" : "Draft"}
              {" · "}
              {dayLabel(dateOnly(localDayKey(p.created_at)))}
            </span>
          </div>
          {p.team_member ? <div className="text-faint mt-0.5 text-xs">To {p.team_member}</div> : null}
          {p.outcome ? <p className="mt-1 text-sm">{p.outcome}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function Choice({
  on, title, hint, onClick,
}: { on: boolean; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-lg border p-3 text-left text-sm transition-colors",
        on ? "border-accent bg-accent/15 text-accent-soft" : "border-border bg-surface-2 hover:border-accent/50",
      )}
    >
      <div className="break-all font-medium">{title}</div>
      <div className="text-xs opacity-75">{hint}</div>
    </button>
  );
}

function StepHead({ n, of, title }: { n: number; of: number; title: string }) {
  return (
    <div>
      <div className="text-faint text-xs font-medium">Step {n} of {of}</div>
      <h2 className="mt-0.5 text-base font-semibold">{title}</h2>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, single,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; single?: boolean;
}) {
  return (
    <div>
      <div className="field-label mb-1.5">{label}</div>
      {single ? (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
               className="input" />
      ) : (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
                  rows={2} className="input resize-none" />
      )}
    </div>
  );
}

function Block({
  title, icon: Icon, children,
}: { title: string; icon: typeof Target; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-muted mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <Icon size={12} /> {title}
      </div>
      {children}
    </div>
  );
}

function Actions({
  busy, onBack, onNext, nextLabel, disabled,
}: {
  busy: boolean; onBack: () => void; onNext: () => void; nextLabel: string; disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 pt-1">
      <button onClick={onBack} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm"
              style={{ border: "1px solid var(--c-border)" }}>
        Back
      </button>
      <button onClick={onNext} disabled={busy || disabled}
              className="btn-primary whitespace-nowrap">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
        {nextLabel}
      </button>
    </div>
  );
}
