import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Loader2, Send, Sparkles, Target,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dateOnly, dayLabel, localDayKey } from "./format";

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
 */

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

export function ClientDelegation({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("list");
  const [error, setError] = useState("");

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
      let msg = "The coach could not be reached.";
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
        const { error: hoErr } = await supabase!.rpc("client_hand_off_plan", { p_plan_id: id });
        if (hoErr) throw hoErr;
      }
      return id as string;
    },
    onSuccess: () => {
      setDraft({ ...EMPTY_PLAN });
      setGenerated(null);
      setAssessmentId(null);
      setInsights("");
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
          Delegation plans on this account. Only the account owner can create them.
        </p>
        <PlanList plans={plans} loading={isLoading} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="flex items-start gap-2 text-sm" style={{ color: "var(--c-danger)" }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}

      {step === "list" ? (
        <>
          <section>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider">Hand something over</h2>
            <p className="text-faint mb-3 text-sm">
              Work through one task at a time: what to let go of, what good looks like, and
              the message that hands it to your assistant. The plan becomes a real task on
              your account when you are ready.
            </p>
            <button
              onClick={() => setStep("assess")}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
              style={{ background: "var(--c-accent)", color: "#fff" }}
            >
              <Sparkles size={15} /> Start a delegation plan
            </button>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider">Your plans</h2>
            <PlanList plans={plans} loading={isLoading} />
          </section>
        </>
      ) : null}

      {step === "assess" ? (
        <section className="space-y-3">
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
        <section className="space-y-3">
          <StepHead n={2} of={3} title="What are you handing over?" />
          {insights ? (
            <div className="rounded-xl px-4 py-3 text-sm"
                 style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}>
              <div className="text-faint mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider">
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
          <Field label="Who is taking it?" value={draft.team_member} single
                 onChange={(v) => setDraft((d) => ({ ...d, team_member: v }))} />

          <div>
            <div className="text-faint mb-1.5 text-xs uppercase tracking-wider">How much rope?</div>
            <div className="flex flex-col gap-2">
              {AUTONOMY.map((a) => (
                <button
                  key={a.v}
                  onClick={() => setDraft((d) => ({ ...d, autonomy_level: a.v }))}
                  className="rounded-xl px-4 py-2.5 text-left text-sm"
                  style={{
                    background: draft.autonomy_level === a.v ? "var(--c-accent)" : "var(--glass)",
                    color: draft.autonomy_level === a.v ? "#fff" : undefined,
                    border: `1px solid ${draft.autonomy_level === a.v ? "var(--c-accent)" : "var(--c-border)"}`,
                  }}
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
            <div className="text-faint mb-1.5 text-xs uppercase tracking-wider">By when (optional)</div>
            <input type="date" value={draft.deadline}
                   onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))}
                   className="rounded-xl px-4 py-2.5 text-sm"
                   style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }} />
          </div>

          <Actions busy={busy} onBack={() => setStep("assess")}
                   onNext={() => void run(() => buildPlan.mutateAsync())} nextLabel="Build the plan"
                   disabled={!draft.task_name.trim()} />
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
                    className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                    style={{ background: "var(--c-accent)", color: "#fff" }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              Hand it over
            </button>
          </div>
          <p className="text-faint text-xs">
            Handing it over puts this on your assistant&rsquo;s board as a task, with the
            message above attached.
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
        <li key={p.id} className="rounded-xl px-4 py-3"
            style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}>
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

function StepHead({ n, of, title }: { n: number; of: number; title: string }) {
  return (
    <div>
      <div className="text-faint text-xs uppercase tracking-wider">Step {n} of {of}</div>
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
  const style = { background: "var(--glass)", border: "1px solid var(--c-border)" };
  return (
    <div>
      <div className="text-faint mb-1.5 text-xs uppercase tracking-wider">{label}</div>
      {single ? (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
               className="w-full rounded-xl px-4 py-2.5 text-sm" style={style} />
      ) : (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
                  rows={2} className="w-full resize-none rounded-xl px-4 py-3 text-sm" style={style} />
      )}
    </div>
  );
}

function Block({
  title, icon: Icon, children,
}: { title: string; icon: typeof Target; children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-4 py-3"
         style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}>
      <div className="text-faint mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider">
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
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--c-accent)", color: "#fff" }}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
        {nextLabel}
      </button>
    </div>
  );
}
