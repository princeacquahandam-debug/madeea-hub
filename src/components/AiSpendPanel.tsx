import { Cpu, AlertTriangle } from "lucide-react";
import { useAiSpend, useAiRatesConfigured, useWorkspaceMembers, useMyRole, atLeast } from "@/data/hooks";
import { cn } from "@/lib/utils";

/**
 * What the AI features have cost this month, per account.
 *
 * ── WHY "REMAINING" IS AN ALLOWANCE AND NOT A BALANCE ────────────────────
 * Neither provider exposes a live account balance to query, so there is no
 * honest way to show what is left on the card. Remaining here means remaining
 * against the monthly allowance an admin set, and the panel says so rather than
 * letting the number be mistaken for the other thing.
 *
 * ── WHY MONEY IS OFTEN ABSENT ────────────────────────────────────────────
 * Cost is computed when a call is recorded, from rates an admin enters. Until
 * somebody enters them nothing is priced, and the panel shows tokens and says
 * money is unavailable. A dashboard confidently reporting a figure at rates
 * nobody checked is worse than one admitting it does not know the price.
 */

const fmt = new Intl.NumberFormat();

/** 1,240,000 becomes "1.24M". Long token counts are unreadable in a table. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return fmt.format(n);
}

export function AiSpendPanel() {
  const { data: rows = [], isLoading } = useAiSpend();
  const { data: priced } = useAiRatesConfigured();
  const { data: members = [] } = useWorkspaceMembers();
  const { data: role } = useMyRole();
  const isAdmin = atLeast(role, "admin");

  const named = rows.map((r) => {
    const m = members.find((x) => x.user_id === r.owner_id);
    return { ...r, name: m?.name ?? "Removed account", is_me: Boolean(m?.is_me) };
  });

  const mine = named.find((r) => r.is_me);
  /* An EA only ever gets their own row back from the view, so the team table is
     shown when there is more than one — which only an admin can produce. */
  const showTeam = isAdmin && named.length > 1;

  const totalTokens = named.reduce((n, r) => n + r.total_tokens, 0);
  const totalCost = named.reduce<number | null>(
    (n, r) => (r.cost_usd == null ? n : (n ?? 0) + r.cost_usd),
    null,
  );

  return (
    <section className="card p-5">
      <p className="field-label flex items-center gap-2"><Cpu size={14} /> AI usage</p>
      <p className="mb-4 text-sm text-muted">
        Tokens spent this calendar month by the writing engine, the assistant, meeting extraction,
        automations and voice notes. Remaining is measured against the monthly allowance, not against
        a balance at the provider &mdash; neither of them publishes one.
      </p>

      {isLoading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : named.length === 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-[12.5px] text-muted">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          Run migration 0069 to start recording AI usage. Nothing is lost in the meantime except the
          record: the features themselves work either way.
        </p>
      ) : (
        <>
          {mine && <Meter label="You" used={mine.total_tokens} allowance={mine.allowance} calls={mine.calls} />}

          {showTeam && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 font-normal text-xs uppercase tracking-wider text-faint">Account</th>
                    <th className="pb-2 font-normal text-xs uppercase tracking-wider text-faint">Calls</th>
                    <th className="pb-2 font-normal text-xs uppercase tracking-wider text-faint">Used</th>
                    <th className="pb-2 font-normal text-xs uppercase tracking-wider text-faint">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {named.map((r) => {
                    const left = Math.max(r.allowance - r.total_tokens, 0);
                    const over = r.total_tokens > r.allowance;
                    return (
                      <tr key={r.owner_id} className="border-b border-border/60 last:border-0">
                        <td className="py-2">
                          {r.name}
                          {r.is_me && <span className="ml-2 text-xs text-faint">you</span>}
                        </td>
                        <td className="py-2 tabular-nums text-muted">{fmt.format(r.calls)}</td>
                        <td className="py-2 tabular-nums">{compact(r.total_tokens)}</td>
                        <td className={cn("py-2 tabular-nums", over ? "text-red-400" : "text-muted")}>
                          {over ? `over by ${compact(r.total_tokens - r.allowance)}` : compact(left)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-sm">
            <span className="text-muted">
              Workspace total <span className="ml-1 tabular-nums text-zinc-200">{compact(totalTokens)}</span> tokens
            </span>
            <span className="text-muted">
              Estimated cost{" "}
              {priced && totalCost != null ? (
                <span className="ml-1 tabular-nums text-zinc-200">${totalCost.toFixed(2)}</span>
              ) : (
                <span className="ml-1 text-faint">not priced</span>
              )}
            </span>
          </div>

          {!priced && (
            <p className="mt-2 text-xs text-faint">
              No model has a rate against it yet, so cost cannot be worked out. Tokens above are exact.
              An admin sets rates per million tokens in <code className="text-[11px]">ai_rates</code>;
              anything recorded before that stays unpriced, because a call is costed at the rate in
              force when it was made.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** One account's month, as a bar. Over-allowance is shown, never clamped away. */
function Meter({ label, used, allowance, calls }: {
  label: string; used: number; allowance: number; calls: number;
}) {
  const pct = allowance > 0 ? Math.min((used / allowance) * 100, 100) : 0;
  const over = allowance > 0 && used > allowance;
  const near = !over && pct >= 80;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="tabular-nums text-sm">
          {compact(used)} <span className="text-faint">of {compact(allowance)}</span>
        </span>
        <span className="text-xs text-faint">{fmt.format(calls)} {calls === 1 ? "call" : "calls"}</span>
        <span className={cn("ml-auto text-xs tabular-nums", over ? "text-red-400" : near ? "text-amber-400" : "text-muted")}>
          {allowance === 0
            ? "no allowance set"
            : over
              ? `over by ${compact(used - allowance)}`
              : `${compact(allowance - used)} left`}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full transition-all", over ? "bg-red-500" : near ? "bg-amber-400" : "bg-accent")}
          style={{ width: `${over ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}
