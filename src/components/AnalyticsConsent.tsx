import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { POSTHOG_KEY, readConsent, setConsent, syncAnalytics, type AnalyticsUser, type Consent } from "@/lib/analytics";

/** Re-reads consent whenever it changes in this tab (banner or Settings). */
function useConsent(userId: string | null | undefined): Consent {
  const [c, setC] = useState<Consent>(() => readConsent(userId));
  useEffect(() => {
    setC(readConsent(userId));
    const on = () => setC(readConsent(userId));
    window.addEventListener("madeea-analytics-consent", on);
    return () => window.removeEventListener("madeea-analytics-consent", on);
  }, [userId]);
  return c;
}

/**
 * Asks once, before anything is recorded (Abder, 21 Oct 2026: UK and EU rules
 * need consent first). Mounted in the Hub and the client portal; also starts
 * analytics for someone who already said yes. Renders nothing until PostHog is
 * configured.
 */
export function AnalyticsConsent({ user }: { user: AnalyticsUser | null }) {
  const consent = useConsent(user?.id);
  const key = user ? `${user.id}|${user.name ?? ""}|${user.role ?? ""}|${user.portal ?? ""}` : "";
  useEffect(() => { if (POSTHOG_KEY) void syncAnalytics(user); }, [key, consent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!POSTHOG_KEY || !user || consent !== null) return null;
  return (
    <div role="dialog" aria-labelledby="ph-consent-h" className="card fixed bottom-4 left-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] p-4 shadow-xl">
      <p id="ph-consent-h" className="mb-1 flex items-center gap-2 text-sm font-semibold"><BarChart3 size={15} className="text-accent" /> Help us improve the Hub</p>
      <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
        While we test, may we record how you use the Hub: the pages and buttons you use and, on team accounts, a replay of your
        session? Anything you type is hidden, and passwords, client records, screenshots and email content are never recorded. You can change
        this any time in Settings.
      </p>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={() => void setConsent(user, "yes")}>Allow</button>
        <button className="btn-ghost flex-1 border border-border" onClick={() => void setConsent(user, "no")}>No thanks</button>
      </div>
    </div>
  );
}

/** The same choice in Settings, so a yes or a no is never permanent. */
export function AnalyticsSetting({ user }: { user: AnalyticsUser | null }) {
  const consent = useConsent(user?.id);
  if (!POSTHOG_KEY || !user) return null;
  return (
    <section className="card p-5" aria-labelledby="ph-setting-h">
      <p id="ph-setting-h" className="field-label flex items-center gap-1.5"><BarChart3 size={13} /> Usage analytics</p>
      <p className="mb-3 text-sm text-muted">
        Records the pages and buttons you use, and a replay of your session, so we can see what works and what
        doesn&apos;t. Typed text, passwords, client records, screenshots and email content are never recorded.
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={consent === "yes"} onChange={(e) => void setConsent(user, e.target.checked ? "yes" : "no")} />
        Share my usage while we test
      </label>
    </section>
  );
}
