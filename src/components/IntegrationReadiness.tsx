import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, KeyRound, ChevronRight, ChevronDown, Copy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Which channels can be connected at all, and what each one still needs.
 *
 * WHY THIS IS ON THE PAGE. Every card already refuses with the right sentence,
 * but only after you press it: six providers meant six clicks to learn six
 * facts of the same shape. Worse, the refusal reads as a fault in the product —
 * "why can't this connect?" — when it is simply an app nobody has registered
 * yet. Setup is a state worth showing plainly rather than discovering by
 * bumping into it.
 *
 * It hides itself once everything is registered, because a permanent
 * green checklist is furniture.
 *
 * WHAT IT DOES NOT CLAIM. That the values are correct. A client id with a typo
 * is present and wrong, and only the provider can say so — that is what the
 * consent screen is for. This answers "is anything missing", which is the
 * question while setting up.
 */

/**
 * The providers this app actually offers, in the order the cards appear.
 *
 * The function reports on every provider it knows how to connect, which is more
 * than the page shows: Integrations offers Gmail, Outlook and Teams, and those
 * are two logins between them. Warning that Discord is unregistered would be a
 * warning about a card nobody can press, and it would keep this panel open
 * forever over a setup that is in fact complete.
 */
const OFFERED = ["google", "microsoft"];

interface Readiness {
  ok: boolean;
  providers: { provider: string; label: string; ready: boolean; missing: string[]; where: string }[];
  encryption_key: boolean;
  app_origins: boolean;
  redirect_uri: string;
}

export function IntegrationReadiness() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<Readiness | null>({
    queryKey: ["integration-readiness"],
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.functions.invoke("integration-readiness", { body: {} });
      // Not deployed yet is not an error worth showing: the cards still explain
      // themselves one at a time, which is where this started.
      if (error) return null;
      return data as Readiness;
    },
    retry: false,
    staleTime: 60_000,
  });

  const providers = (data?.providers ?? []).filter((p) => OFFERED.includes(p.provider));
  if (isLoading || !data || !providers.length) return null;

  const waiting = providers.filter((p) => !p.ready);
  const ready = providers.length - waiting.length;
  // Everything registered: nothing to say.
  if (waiting.length === 0 && data.encryption_key && data.app_origins) return null;

  return (
    <section className="card mb-5 p-4">
      <button
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
          <KeyRound size={17} className="text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {waiting.length} channel{waiting.length === 1 ? "" : "s"} not registered yet
          </h3>
          <p className="text-[12.5px] text-faint">
            {ready} of {providers.length} ready. The rest need an app registered with that
            provider before Connect can do anything.
          </p>
        </div>
        {open ? <ChevronDown size={16} className="text-faint" /> : <ChevronRight size={16} className="text-faint" />}
      </button>

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {/* The redirect URI first: it is the same for every provider and the
              single commonest thing to get wrong, because a mismatch fails at
              the provider's screen after the person has already approved. */}
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="field-label">Redirect URI, the same for all of them</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="mono min-w-0 flex-1 truncate text-[12px] text-text">{data.redirect_uri}</code>
              <button
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-[var(--chip-bg)] hover:text-text"
                onClick={() => {
                  void navigator.clipboard?.writeText(data.redirect_uri);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {(!data.encryption_key || !data.app_origins) && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-[12.5px] text-red-200">
              {!data.encryption_key && (
                <p><b>INTEGRATION_ENCRYPTION_KEY is not set.</b> Nothing can be connected at all: a
                connection refuses rather than storing a token unencrypted.</p>
              )}
              {!data.app_origins && (
                <p className={cn(!data.encryption_key && "mt-1.5")}>
                  <b>APP_ORIGINS is not set.</b> Every redirect back from a provider is rejected.
                </p>
              )}
            </div>
          )}

          <ul className="space-y-2">
            {providers.map((p) => (
              <li
                key={p.provider}
                className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2.5 text-[12.5px]"
              >
                <span className="min-w-[150px] font-medium">{p.label}</span>
                {p.ready ? (
                  <span className="pill bg-emerald-500/15 text-emerald-400">
                    <Check size={11} /> Registered
                  </span>
                ) : (
                  <>
                    <span className="pill bg-amber-500/15 text-amber-400">Needs an app</span>
                    <span className="w-full text-faint">
                      Set{" "}
                      {p.missing.map((m, i) => (
                        <span key={m}>
                          {i > 0 && " and "}
                          <span className="mono text-muted">{m}</span>
                        </span>
                      ))}
                      {" "}in Supabase. Get them from <span className="text-muted">{p.where}</span>.
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>

          <p className="text-[11.5px] leading-relaxed text-faint">
            This checks whether the values exist, not whether they are right — a client id with a
            typo is present and wrong, and only the provider's own sign-in can tell you that.
          </p>
        </div>
      )}
    </section>
  );
}
