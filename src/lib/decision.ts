/**
 * Decision Helper — structures a decision. It does not make one.
 *
 * That distinction is the whole design, and it is not decoration.
 *
 * An assistant that tells an executive what to choose is the highest-risk thing in
 * this application. Every other helper produces work that gets reviewed before it
 * matters — a draft is read before sending, a task is checked before it's chased.
 * A recommendation is different: by the time it's wrong, someone has already acted
 * on the authority it borrowed from being generated confidently.
 *
 * So the arithmetic lives here, in code, where it is visible and editable:
 *
 *   - the EA sets the options, the criteria, and the WEIGHTS. Those are judgements,
 *     and judgements belong to the human.
 *   - this file multiplies and sorts. That's it.
 *   - `sensitivity` reports which weight would have to change to flip the answer —
 *     the single most useful output here, because it shows how fragile the ranking
 *     is rather than pretending it's solid.
 *   - when two options are within `CLOSE_MARGIN`, the result says the numbers do
 *     NOT decide it. A 51/49 split dressed up as a winner is a lie of precision.
 *
 * The model's only job on this page is writing the decision record afterwards, and
 * its prompt forbids it from choosing (see supabase/functions/generate).
 */

export interface Option {
  id: string;
  label: string;
  note: string;
}

export interface Criterion {
  id: string;
  label: string;
  /** How much this matters, 1–5. The EA's judgement, never inferred. */
  weight: number;
}

/** option id → criterion id → 0–5. A missing entry means "not scored yet". */
export type Scores = Record<string, Record<string, number>>;

export const MAX_SCORE = 5;
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 5;

/** Below this gap (in normalised points) the numbers aren't deciding anything. */
export const CLOSE_MARGIN = 5;

export interface OptionResult {
  option: Option;
  /** Σ(weight × score) over scored criteria only. */
  total: number;
  /** 0–100 against the best this option could have scored on what WAS scored. */
  normalised: number;
  perCriterion: { criterion: Criterion; raw: number | null; weighted: number }[];
  /** Criteria left unscored for this option. */
  missing: string[];
}

export interface Sensitivity {
  criterionId: string;
  label: string;
  /** The weight at which the outcome changes, or null if it never does across 1–5. */
  flipsAt: number | null;
  /** The option that would lead instead. Null when the outcome becomes a tie. */
  flipsTo: string | null;
  /**
   * How the outcome changes.
   *   "flip" — a different option wins outright.
   *   "tie"  — the same option nominally leads, but the margin collapses inside
   *            CLOSE_MARGIN, so nothing is decided any more.
   *
   * Reporting only "flip" would have missed the most common real case: a heavily
   * weighted criterion doesn't hand victory to the other option, it just erases the
   * lead. "Your 53-point lead becomes a dead heat" is exactly what someone needs to
   * know before they act on the ranking.
   */
  outcome: "flip" | "tie" | null;
}

export interface DecisionResult {
  ranked: OptionResult[];
  leader: OptionResult | null;
  runnerUp: OptionResult | null;
  /** Normalised gap between first and second. */
  margin: number;
  /** True when that gap is too small for the ranking to mean anything. */
  tooCloseToCall: boolean;
  sensitivity: Sensitivity[];
  completeness: { scored: number; possible: number; fullyScored: boolean };
  warnings: string[];
}

function scoreOne(option: Option, criteria: Criterion[], scores: Scores): OptionResult {
  const row = scores[option.id] ?? {};
  let total = 0;
  let maxPossible = 0;
  const missing: string[] = [];

  const perCriterion = criteria.map((c) => {
    const raw = typeof row[c.id] === "number" ? row[c.id] : null;
    if (raw === null) {
      missing.push(c.label);
      return { criterion: c, raw: null, weighted: 0 };
    }
    const weighted = raw * c.weight;
    total += weighted;
    // Normalise against what this option could have scored on the criteria it WAS
    // scored on. Counting unscored criteria as zero would punish an option for the
    // EA not having got to it yet — which silently turns an incomplete matrix into
    // a confident wrong answer.
    maxPossible += MAX_SCORE * c.weight;
    return { criterion: c, raw, weighted };
  });

  return {
    option,
    total,
    normalised: maxPossible > 0 ? (total / maxPossible) * 100 : 0,
    perCriterion,
    missing,
  };
}

/** Ranks with a given set of weights. Used for the real result and for sweeps. */
function rankWith(options: Option[], criteria: Criterion[], scores: Scores): OptionResult[] {
  return options
    .map((o) => scoreOne(o, criteria, scores))
    .sort((a, b) => b.normalised - a.normalised || a.option.label.localeCompare(b.option.label));
}

/**
 * Would a different weight on this criterion change the winner?
 *
 * Sweeps each criterion's weight across the whole 1–5 range while holding the rest
 * fixed, and reports the first weight that produces a different leader.
 */
function sensitivityFor(
  options: Option[],
  criteria: Criterion[],
  scores: Scores,
  currentLeaderId: string,
): Sensitivity[] {
  const out: Sensitivity[] = [];

  for (const c of criteria) {
    let flipsAt: number | null = null;
    let flipsTo: string | null = null;
    let outcome: Sensitivity["outcome"] = null;

    for (let w = MIN_WEIGHT; w <= MAX_WEIGHT; w++) {
      if (w === c.weight) continue;
      const swapped = criteria.map((x) => (x.id === c.id ? { ...x, weight: w } : x));
      const swept = rankWith(options, swapped, scores);
      const leader = swept[0];
      if (!leader) continue;

      if (leader.option.id !== currentLeaderId) {
        flipsAt = w;
        flipsTo = leader.option.label;
        outcome = "flip";
        break;
      }
      // Same nominal leader, but the lead has collapsed to nothing. Record it and
      // keep sweeping — an outright flip further along is the stronger finding.
      const runner = swept[1];
      if (runner && leader.normalised - runner.normalised < CLOSE_MARGIN && outcome === null) {
        flipsAt = w;
        flipsTo = null;
        outcome = "tie";
      }
    }

    out.push({ criterionId: c.id, label: c.label, flipsAt, flipsTo, outcome });
  }

  // Criteria that can flip the result are the ones worth arguing about — surface
  // them first.
  return out.sort((a, b) => Number(b.flipsAt !== null) - Number(a.flipsAt !== null));
}

export function decide(options: Option[], criteria: Criterion[], scores: Scores): DecisionResult {
  const warnings: string[] = [];

  const usableOptions = options.filter((o) => o.label.trim());
  const usableCriteria = criteria.filter((c) => c.label.trim());

  if (usableOptions.length < 2) warnings.push("Add at least two options — there's nothing to compare yet.");
  if (!usableCriteria.length) warnings.push("Add at least one criterion, and set how much it matters.");

  const ranked = rankWith(usableOptions, usableCriteria, scores);

  let scored = 0;
  const possible = usableOptions.length * usableCriteria.length;
  for (const r of ranked) scored += r.perCriterion.filter((p) => p.raw !== null).length;
  const fullyScored = possible > 0 && scored === possible;

  if (possible > 0 && !fullyScored) {
    warnings.push(
      `${possible - scored} of ${possible} cells aren't scored. Each option is judged only on what you scored it against, so the comparison isn't like-for-like yet.`,
    );
  }

  if (usableCriteria.length && usableCriteria.every((c) => c.weight === usableCriteria[0].weight)) {
    warnings.push(
      "Every criterion carries the same weight. That's a real position, but if some genuinely matter more, say so — it's the weights that do the work here.",
    );
  }

  const leader = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;
  const margin = leader && runnerUp ? leader.normalised - runnerUp.normalised : 0;
  const tooCloseToCall = Boolean(leader && runnerUp) && margin < CLOSE_MARGIN;

  if (tooCloseToCall) {
    warnings.push(
      `${leader!.option.label} and ${runnerUp!.option.label} are within ${margin.toFixed(1)} points. The numbers do not decide this one — pick on judgement, and record why.`,
    );
  }

  return {
    ranked,
    leader,
    runnerUp,
    margin,
    tooCloseToCall,
    sensitivity: leader ? sensitivityFor(usableOptions, usableCriteria, scores, leader.option.id) : [],
    completeness: { scored, possible, fullyScored },
    warnings,
  };
}

/**
 * The plain verdict, in one sentence.
 *
 * This exists to close a real disagreement: the pitch promises the Decision Helper
 * gives "a suggestion", while this module refuses to let a language model choose.
 * Both can be true, and the distinction is the whole point:
 *
 *   - a recommendation derived from the EA's OWN weights is arithmetic. It is
 *     reproducible, inspectable, and changes when they change a weight.
 *   - a recommendation from a language model is an opinion wearing the costume of
 *     one, and nobody can audit it.
 *
 * So the app states the verdict plainly — and never states one it hasn't earned.
 * When the margin is inside the noise it says so instead of picking, because
 * dressing a 51/49 as a winner is the failure this whole file exists to avoid.
 */
export function verdict(r: DecisionResult): { text: string; decisive: boolean } {
  if (!r.leader || !r.leader.option.label.trim()) {
    return { text: "Name at least two options and score them to get a verdict.", decisive: false };
  }
  if (!r.runnerUp) {
    return { text: `Only ${r.leader.option.label} is on the table — there's nothing to compare it against.`, decisive: false };
  }
  if (r.tooCloseToCall) {
    return {
      text: `Too close to call: ${r.leader.option.label} and ${r.runnerUp.option.label} are within ${r.margin.toFixed(1)} points. On your weights the numbers do not choose between them — this one is judgement.`,
      decisive: false,
    };
  }
  const fragile = r.sensitivity.find((s) => s.flipsAt !== null);
  const caveat = fragile
    ? ` That holds unless “${fragile.label}” matters more to you than you've weighted it.`
    : " No single weight change overturns that.";
  return {
    text: `On your weights, ${r.leader.option.label} comes out ahead of ${r.runnerUp.option.label} by ${r.margin.toFixed(1)} points.${caveat}`,
    decisive: true,
  };
}

export function emptyOption(n: number): Option {
  return { id: `opt-${n}`, label: "", note: "" };
}

export function emptyCriterion(n: number): Criterion {
  return { id: `crit-${n}`, label: "", weight: 3 };
}

export const STARTER_CRITERIA = ["Cost", "Time to deliver", "Risk", "Client impact"];

/** Facts for the decision record. The model writes it up; it does not choose. */
export function decisionPromptInputs(
  question: string,
  context: string,
  result: DecisionResult,
): Record<string, string> {
  const table = result.ranked
    .map(
      (r) =>
        `- ${r.option.label}: ${r.normalised.toFixed(1)}/100 (${r.perCriterion
          .map((p) => `${p.criterion.label} ${p.raw ?? "unscored"}×${p.criterion.weight}`)
          .join(", ")})${r.option.note ? ` — note: ${r.option.note}` : ""}`,
    )
    .join("\n");

  const flips = result.sensitivity
    .filter((s) => s.flipsAt !== null)
    .map((s) =>
      s.outcome === "flip"
        ? `- Changing “${s.label}” to weight ${s.flipsAt} would make ${s.flipsTo} the leader instead`
        : `- Changing “${s.label}” to weight ${s.flipsAt} would wipe out the lead entirely — no option would be clearly ahead`,
    )
    .join("\n");

  return {
    question,
    context: context || "(none supplied)",
    scored_options: table || "(no options scored)",
    leader: result.leader ? `${result.leader.option.label} (${result.leader.normalised.toFixed(1)}/100)` : "(none)",
    margin_over_runner_up: result.runnerUp ? `${result.margin.toFixed(1)} points` : "(only one option)",
    is_it_too_close: result.tooCloseToCall
      ? "YES — the margin is inside the noise. Say plainly that the numbers do not decide this."
      : "No — the leader is clear on the numbers as weighted.",
    what_would_change_the_answer: flips || "(no single weight change flips the result)",
    caveats: result.warnings.length ? result.warnings.join(" ") : "(none)",
  };
}
