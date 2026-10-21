import type { PostHog } from "posthog-js";

/**
 * PostHog: product analytics and session recordings (Abder, 21 Oct 2026 call).
 *
 * Installed for the team's testing so Abder can see how the Hub is really used:
 * which pages and AI actions people reach for, and a replay of each session.
 * Free plan: 1 million events and 5,000 recordings a month.
 *
 * Three rules, because this records people at work:
 *   1. NOTHING LOADS WITHOUT A KEY. VITE_POSTHOG_KEY is the PostHog project's
 *      API key; until it's set in Vercel this module does nothing at all.
 *   2. NOTHING RECORDS WITHOUT CONSENT. Each person is asked once (UK/EU rules
 *      require it, as Abder said) and can change their answer in Settings.
 *   3. NOTHING TYPED IS RECORDED. Every input is masked in replays, and any
 *      element marked `ph-no-capture` (the Password Manager, Client Vault
 *      details, the screenshot gallery) is left out entirely.
 *
 * The library is the "no external" build with the recorder bundled in, loaded
 * only after consent, so it never pulls scripts from PostHog's servers and
 * costs the rest of the Hub nothing until it's switched on.
 */
export const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined)?.trim() || "";
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined)?.trim() || "https://us.i.posthog.com";

export type Consent = "yes" | "no" | null;
const consentKey = (userId: string) => `madeea-analytics-consent-${userId}`;

export function readConsent(userId: string | null | undefined): Consent {
  if (!userId) return null;
  try {
    const v = localStorage.getItem(consentKey(userId));
    return v === "yes" || v === "no" ? v : null;
  } catch { return null; }
}

let ph: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

async function load(): Promise<PostHog | null> {
  if (!POSTHOG_KEY) return null;
  if (ph) return ph;
  if (!loading) {
    loading = import("posthog-js/dist/module.full.no-external")
      .then((m) => {
        const client = (m as unknown as { default: PostHog }).default;
        client.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          person_profiles: "identified_only",
          capture_pageview: "history_change",
          capture_pageleave: true,
          disable_external_dependency_loading: true,
          disable_surveys: true,
          session_recording: {
            maskAllInputs: true,
            maskTextSelector: ".ph-mask",
            blockSelector: ".ph-no-capture",
          },
        });
        ph = client;
        return client;
      })
      .catch((e) => { console.error("analytics failed to load", e); loading = null; return null; });
  }
  return loading;
}

/** Who this is, so a replay can be matched to a teammate. Name and role only. */
export interface AnalyticsUser { id: string; name?: string | null; role?: string | null; portal?: "hub" | "client" }

let current: AnalyticsUser | null = null;

/** Start (or stop) for the signed-in person, following their consent. */
export async function syncAnalytics(user: AnalyticsUser | null): Promise<void> {
  current = user;
  if (!user || readConsent(user.id) !== "yes") {
    if (ph) { ph.opt_out_capturing(); ph.reset(); }
    return;
  }
  const client = await load();
  if (!client || current?.id !== user.id) return;
  client.opt_in_capturing();
  client.identify(user.id, { name: user.name ?? undefined, role: user.role ?? undefined, portal: user.portal ?? "hub" });
  // Replays are for the team's own testing. A client's portal (their mail,
  // their records) sends page and button events only, never a recording.
  if (user.portal === "client") client.stopSessionRecording();
  else client.startSessionRecording();
}

export async function setConsent(user: AnalyticsUser, value: "yes" | "no"): Promise<void> {
  try { localStorage.setItem(consentKey(user.id), value); } catch { /* storage blocked: asked again next visit */ }
  window.dispatchEvent(new CustomEvent("madeea-analytics-consent"));
  await syncAnalytics(user);
}

/** A named action (an AI quick action, a report filed). No-op without consent. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (ph && current && readConsent(current.id) === "yes") ph.capture(event, props);
}
