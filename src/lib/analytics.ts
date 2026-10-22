import type { PostHog } from "posthog-js";
import { supabase } from "@/lib/supabase";

/**
 * PostHog, set up to the MADE/EA PostHog tracking plan (Oct 2026 deck).
 *
 * The plan's rules, and where each one is kept:
 *   - EU CLOUD THROUGH OUR OWN DOMAIN. Events go to /ingest on the Hub's own
 *     address, which Vercel forwards to eu.i.posthog.com (vercel.json), so ad
 *     blockers don't drop them.
 *   - NAMED EVENTS ONLY. object_action, past tense, from the plan's catalog.
 *     Autocapture is off: it records the text of whatever was clicked, which
 *     would put task titles and names into PostHog.
 *   - NO CONTENT. Properties are ids, counts, yes/no and short categories.
 *     identify() uses our internal user id, never a name or email.
 *   - SENT WITH EVERY EVENT: role, organization, client, app_version, theme.
 *   - RECORDINGS SHOW NO TEXT. Everything typed and every piece of text on
 *     screen is masked; the Inbox is never recorded; the Password Manager,
 *     Client Vault, Screenshots and Uploads are blocked outright. The 20%
 *     sample and 5-second minimum are set in PostHog's project settings.
 *   - CONSENT FIRST, AND AN OFF SWITCH. Nothing loads or sends until the person
 *     agrees; the choice is saved on their profile so the database's own
 *     events (0093) follow it too, and it can be changed in Settings.
 *
 * Nothing at all happens until VITE_POSTHOG_KEY (the project token) is set.
 */
export const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined)?.trim() || "";
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined)?.trim() || "/ingest";
const POSTHOG_UI = (import.meta.env.VITE_POSTHOG_UI_HOST as string | undefined)?.trim() || "https://eu.posthog.com";
/** Short commit id of this build (vite.config.ts sets it from Vercel), "dev" locally. */
export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) || "dev";

export type Consent = "yes" | "no" | null;
const consentKey = (userId: string) => `madeea-analytics-consent-${userId}`;

export function readConsent(userId: string | null | undefined): Consent {
  if (!userId) return null;
  try {
    const v = localStorage.getItem(consentKey(userId));
    return v === "yes" || v === "no" ? v : null;
  } catch { return null; }
}
function cacheConsent(userId: string, v: Consent) {
  try { if (v) localStorage.setItem(consentKey(userId), v); else localStorage.removeItem(consentKey(userId)); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent("madeea-analytics-consent"));
}

/** The profile is the source of truth, so the choice follows the person to any computer. */
export async function loadConsent(userId: string): Promise<Consent> {
  if (!supabase) return readConsent(userId);
  const { data, error } = await supabase.from("profiles").select("analytics_consent").eq("id", userId).maybeSingle();
  if (error) return readConsent(userId); // column not there yet: this browser's answer
  const saved = (data as { analytics_consent?: string | null } | null)?.analytics_consent;
  const db: Consent = saved === "yes" || saved === "no" ? saved : null;
  const local = readConsent(userId);
  if (db !== local) {
    if (db) cacheConsent(userId, db);
    else if (local) void supabase.from("profiles").update({ analytics_consent: local }).eq("id", userId);
  }
  return db ?? local;
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
          ui_host: POSTHOG_UI,
          person_profiles: "identified_only",
          autocapture: false,
          capture_pageview: "history_change",
          capture_pageleave: true,
          disable_external_dependency_loading: true,
          disable_surveys: true,
          opt_out_capturing_by_default: true,
          session_recording: {
            maskAllInputs: true,
            maskTextSelector: "*",
            blockSelector: ".ph-no-capture",
          },
        });
        ph = client;
        // Local development only: lets the browser tests look inside.
        if (import.meta.env.DEV) (window as unknown as { __ph?: PostHog }).__ph = client;
        return client;
      })
      .catch((e) => { console.error("analytics failed to load", e); loading = null; return null; });
  }
  return loading;
}

/** Who this is: our internal id and role. No name, no email. */
export interface AnalyticsUser { id: string; role?: string | null; workspaceId?: string | null; portal?: "hub" | "client" }

let current: AnalyticsUser | null = null;
let consented = false;
let path = typeof window !== "undefined" ? window.location.pathname : "/";
const supers: Record<string, unknown> = { app_version: APP_VERSION };

const theme = () => {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "dark" || t === "light" ? t : "system";
};

/** Recordings: team accounts only, and never on the Inbox (plan slide 7). */
function applyRecording() {
  if (!ph || !consented || !current) return;
  const off = current.portal === "client" || path.startsWith("/inbox");
  if (off) ph.stopSessionRecording();
  else ph.startSessionRecording();
}

/** Start (or stop) for the signed-in person, following their consent. */
export async function syncAnalytics(user: AnalyticsUser | null): Promise<void> {
  current = user;
  if (!POSTHOG_KEY) return;
  if (!user) { consented = false; if (ph) { ph.opt_out_capturing(); ph.reset(); } return; }
  const consent = await loadConsent(user.id);
  if (current?.id !== user.id) return;
  consented = consent === "yes";
  if (!consented) { if (ph) { ph.opt_out_capturing(); ph.reset(); } return; }
  const client = await load();
  if (!client || current?.id !== user.id) return;
  client.opt_in_capturing();
  client.identify(user.id, { role: user.role ?? undefined, portal: user.portal ?? "hub" });
  if (user.workspaceId) client.group("organization", user.workspaceId);
  Object.assign(supers, { role: user.role ?? null, organization: user.workspaceId ?? null, theme: theme(), portal: user.portal ?? "hub" });
  client.register(supers);
  applyRecording();
  // A login that happened before analytics finished loading.
  try {
    const method = sessionStorage.getItem("madeea-just-logged-in");
    if (method) { sessionStorage.removeItem("madeea-just-logged-in"); client.capture("user_logged_in", { method }); }
  } catch { /* storage blocked */ }
}

export async function setConsent(user: AnalyticsUser, value: "yes" | "no"): Promise<void> {
  cacheConsent(user.id, value);
  if (supabase) await supabase.from("profiles").update({ analytics_consent: value }).eq("id", user.id);
  await syncAnalytics(user);
}

/** A named event from the plan's catalog. No-op without consent. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (ph && consented && current) ph.capture(event, props);
}

/** Keep the "sent with every event" properties current. */
export function setSuper(props: Record<string, unknown>): void {
  Object.assign(supers, props);
  if (ph && consented) ph.register(props);
}

/** Called on every route change: Inbox stops the recording, leaving starts it again. */
export function notePath(next: string): void {
  path = next;
  applyRecording();
}

/** A login, counted once analytics is running (consent may come a moment later). */
export function noteLogin(method: string): void {
  try { sessionStorage.setItem("madeea-just-logged-in", method); } catch { /* storage blocked */ }
}

/* Shared computers: a sign-out forgets who this was (plan slide 8). */
supabase?.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") { consented = false; current = null; if (ph) { ph.opt_out_capturing(); ph.reset(); } }
});

/** "short" / "medium" / "long", never the text itself. */
export const lengthBucket = (n: number) => (n < 80 ? "short" : n < 400 ? "medium" : "long");
