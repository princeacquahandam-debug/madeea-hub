import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { POSTHOG_KEY, loadConsent, readConsent, setConsent, syncAnalytics, type AnalyticsUser, type Consent } from "@/lib/analytics";

/** The person's answer, from their profile; re-read whenever it changes. */
function useConsent(userId: string | null | undefined): { consent: Consent; known: boolean } {
  const [state, setState] = useState<{ consent: Consent; known: boolean }>({ consent: readConsent(userId), known: false });
  useEffect(() => {
    let live = true;
    if (!userId || !POSTHOG_KEY) return;
    void loadConsent(userId).then((c) => { if (live) setState({ consent: c, known: true }); });
    const on = () => setState({ consent: readConsent(userId), known: true });
    window.addEventListener("madeea-analytics-consent", on);
    return () => { live = false; window.removeEventListener("madeea-analytics-consent", on); };
  }, [userId]);
  return state;
}

/**
 * Asks once, before anything is recorded (PostHog plan, privacy slide: consent
 * prompt and a per-person off switch). Mounted in the Hub and the client
 * portal; also starts analytics for someone who already said yes. Renders
 * nothing until PostHog is configured.
 */
export function AnalyticsConsent({ user }: { user: AnalyticsUser | null }) {
  const { consent, known } = useConsent(user?.id);
  const key = user ? `${user.id}|${user.role ?? ""}|${user.workspaceId ?? ""}|${user.portal ?? ""}` : "";
  useEffect(() => { if (POSTHOG_KEY) void syncAnalytics(user); }, [key, consent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!POSTHOG_KEY || !user || !known || consent !== null) return null;
  return (
    <div role="dialog" aria-labelledby="ph-consent-h" className="card fixed bottom-4 left-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] p-4 shadow-xl">
      <p id="ph-consent-h" className="mb-1 flex items-center gap-2 text-sm font-semibold"><BarChart3 size={15} className="text-accent" /> Help us improve the Hub</p>
      <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
        May we record how you use the Hub, such as which pages and buttons you use{user.portal === "client" ? "" : ", and a replay of some sessions with all text hidden"}?
        We never record what you read or write: no names, emails, task titles or messages{user.portal === "client" ? "" : ", and the Inbox is never recorded"}. You can change this any time in Settings.
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
  const { consent } = useConsent(user?.id);
  if (!POSTHOG_KEY || !user) return null;
  return (
    <section className="card p-5" aria-labelledby="ph-setting-h">
      <p id="ph-setting-h" className="field-label flex items-center gap-1.5"><BarChart3 size={13} /> Usage analytics</p>
      <p className="mb-3 text-sm text-muted">
        Records which pages and buttons you use, and a replay of some sessions with all text hidden, so we can see
        what works and what doesn&apos;t. Never what you read or write: no names, emails, task titles or messages.
        Stored in the EU; recordings kept 30 days, events 12 months.
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={consent === "yes"} onChange={(e) => void setConsent(user, e.target.checked ? "yes" : "no")} />
        Share my usage
      </label>
    </section>
  );
}
