/**
 * Time zones for client onboarding (19 Oct 2026 team meeting). The browser's
 * own IANA list, labelled with today's offset so "Asia/Dubai (GMT+4)" reads at
 * a glance.
 */
export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try { return intl.supportedValuesOf?.("timeZone") ?? FALLBACK; } catch { return FALLBACK; }
}

const FALLBACK = [
  "UTC", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Manila", "Asia/Singapore", "Asia/Tokyo",
  "Australia/Sydney", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
];

export function zoneOffset(tz: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch { return ""; }
}

/** "9:14 AM" in that zone, or null for an unknown zone. */
export function localTime(tz: string, at = new Date()): string | null {
  try { return at.toLocaleTimeString([], { timeZone: tz, hour: "numeric", minute: "2-digit" }); } catch { return null; }
}

export const myTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
