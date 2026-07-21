/**
 * Travel Helper — itinerary maths that has to be right.
 *
 * Same principle as lib/voiceTask.ts: the model is good at prose and bad at
 * arithmetic, so it never gets to do the arithmetic. Every duration, layover,
 * timezone shift and "leave home by" time on this page is computed here, in code,
 * from the times the EA typed. The writing engine receives those numbers already
 * settled and is told to reproduce them verbatim.
 *
 * A wrong flight duration in a nicely-worded itinerary is worse than no itinerary
 * — the exec plans around it and misses the flight.
 *
 * Timezones are handled with `Intl`, not by hand. Fixed UTC offsets look simpler
 * right up until a trip crosses a daylight-saving boundary, at which point every
 * time after the change is an hour wrong.
 */

export interface Leg {
  id: string;
  from: string;
  to: string;
  /** IANA zone, e.g. "Europe/London". Validated before use. */
  fromZone: string;
  toZone: string;
  /** Local wall-clock time as the browser's datetime-local gives it: "YYYY-MM-DDTHH:mm". */
  departLocal: string;
  arriveLocal: string;
  carrier: string;
  reference: string;
}

export interface TravelOptions {
  traveller: string;
  homeZone: string;
  /** How long before departure to be at the airport. */
  airportArrivalMinutes: number;
  /** Door-to-terminal travel time. */
  travelToAirportMinutes: number;
  /** Below this, a connection is called tight. */
  minConnectionMinutes: number;
  /** "YYYY-MM-DD", or "" if not tracked. */
  passportExpiry: string;
  international: boolean;
  visaRequired: boolean;
  hotel: string;
  notes: string;
}

export const DEFAULT_TRAVEL_OPTIONS: TravelOptions = {
  traveller: "",
  homeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
  airportArrivalMinutes: 120,
  travelToAirportMinutes: 60,
  minConnectionMinutes: 75,
  passportExpiry: "",
  international: true,
  visaRequired: false,
  hotel: "",
  notes: "",
};

export const COMMON_ZONES = [
  "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Madrid",
  "Europe/Zurich", "Europe/Amsterdam", "Europe/Lisbon", "Europe/Athens", "Europe/Moscow",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Toronto", "America/Sao_Paulo", "America/Mexico_City",
  "Africa/Lagos", "Africa/Accra", "Africa/Johannesburg", "Africa/Nairobi", "Africa/Cairo",
  "Asia/Dubai", "Asia/Riyadh", "Asia/Karachi", "Asia/Kolkata", "Asia/Bangkok",
  "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Sydney", "Australia/Perth", "Pacific/Auckland", "UTC",
];

const MINUTE = 60_000;

export function isValidZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone's UTC offset, in minutes, AT a given instant — so it reflects whichever
 * side of a daylight-saving change the instant falls on.
 */
export function offsetMinutes(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Some engines render midnight as hour "24" under hour12:false.
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asIfUtc - instant.getTime()) / MINUTE;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/**
 * Wall-clock time in a zone → the actual instant.
 *
 * Two passes: guess the offset by reading the zone at the naive instant, apply it,
 * then re-read the offset at the corrected instant. The second pass is what makes
 * times near a DST switch land correctly — the offset an hour before the change is
 * not the offset an hour after it.
 */
export function localToUtc(local: string, zone: string): Date | null {
  const m = LOCAL_RE.exec(local.trim());
  if (!m || !isValidZone(zone)) return null;
  const [, y, mo, d, h, mi] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  let utc = naive - offsetMinutes(new Date(naive), zone) * MINUTE;
  utc = naive - offsetMinutes(new Date(utc), zone) * MINUTE;
  const out = new Date(utc);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** An instant rendered as local wall time in a zone — "Tue 4 Nov, 18:40". */
export function formatInZone(instant: Date, zone: string): string {
  if (!isValidZone(zone)) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

/** "14h 25m" / "45m". */
export function formatMinutes(total: number): string {
  const sign = total < 0 ? "−" : "";
  const abs = Math.abs(Math.round(total));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (!h) return `${sign}${m}m`;
  if (!m) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

export interface LegAnalysis {
  leg: Leg;
  departUtc: Date | null;
  arriveUtc: Date | null;
  durationMinutes: number | null;
  /** Local calendar days crossed: 0 same day, 1 arrives next day, -1 gains a day. */
  dayShift: number | null;
  /** Offset difference between origin and destination at travel time, in hours. */
  timezoneShiftHours: number | null;
  errors: string[];
}

export type ConnectionStatus = "impossible" | "tight" | "ok" | "long" | "unknown";

export interface Connection {
  airport: string;
  minutes: number | null;
  status: ConnectionStatus;
  note: string;
}

export interface TravelWarning {
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
  /** When it needs doing, relative to departure. */
  dueLabel: string;
  /**
   * The same deadline as a number, so a real due date can be derived when these
   * become tasks. Null means "do it now" rather than "no deadline" — parsing the
   * label text back into a date would be a guess, and this is not the file for
   * guesses.
   */
  daysBefore: number | null;
}

export interface TripAnalysis {
  legs: LegAnalysis[];
  connections: Connection[];
  /** Time actually in the air. */
  totalTravelMinutes: number | null;
  /** Door to door, layovers included. */
  totalElapsedMinutes: number | null;
  departUtc: Date | null;
  arriveUtc: Date | null;
  leaveHomeBy: Date | null;
  /** Destination offset minus home offset, at arrival. Positive = clocks go forward. */
  jetLagHours: number | null;
  warnings: TravelWarning[];
  checklist: ChecklistItem[];
}

function analyseLeg(leg: Leg): LegAnalysis {
  const errors: string[] = [];
  if (!isValidZone(leg.fromZone)) errors.push(`"${leg.fromZone || "(blank)"}" is not a recognised timezone`);
  if (!isValidZone(leg.toZone)) errors.push(`"${leg.toZone || "(blank)"}" is not a recognised timezone`);

  const departUtc = localToUtc(leg.departLocal, leg.fromZone);
  const arriveUtc = localToUtc(leg.arriveLocal, leg.toZone);
  if (leg.departLocal && !departUtc) errors.push("Departure time couldn't be read");
  if (leg.arriveLocal && !arriveUtc) errors.push("Arrival time couldn't be read");

  let durationMinutes: number | null = null;
  if (departUtc && arriveUtc) {
    durationMinutes = (arriveUtc.getTime() - departUtc.getTime()) / MINUTE;
    if (durationMinutes < 0) {
      // Almost always a wrong date or a swapped timezone rather than time travel.
      errors.push("Arrives before it departs — check the dates and the timezones");
    }
  }

  let dayShift: number | null = null;
  const dFrom = LOCAL_RE.exec(leg.departLocal.trim());
  const dTo = LOCAL_RE.exec(leg.arriveLocal.trim());
  if (dFrom && dTo) {
    const a = Date.UTC(Number(dFrom[1]), Number(dFrom[2]) - 1, Number(dFrom[3]));
    const b = Date.UTC(Number(dTo[1]), Number(dTo[2]) - 1, Number(dTo[3]));
    dayShift = Math.round((b - a) / 86_400_000);
  }

  let timezoneShiftHours: number | null = null;
  if (departUtc && arriveUtc && isValidZone(leg.fromZone) && isValidZone(leg.toZone)) {
    timezoneShiftHours =
      (offsetMinutes(arriveUtc, leg.toZone) - offsetMinutes(departUtc, leg.fromZone)) / 60;
  }

  return { leg, departUtc, arriveUtc, durationMinutes, dayShift, timezoneShiftHours, errors };
}

function connectionFor(prev: LegAnalysis, next: LegAnalysis, minMinutes: number): Connection {
  const airport = prev.leg.to || next.leg.from || "connection";
  if (!prev.arriveUtc || !next.departUtc) {
    return { airport, minutes: null, status: "unknown", note: "Not enough time detail to check this connection" };
  }
  const minutes = (next.departUtc.getTime() - prev.arriveUtc.getTime()) / MINUTE;
  if (minutes < 0) {
    return { airport, minutes, status: "impossible", note: "The next flight leaves before this one lands" };
  }
  if (minutes < minMinutes) {
    return {
      airport,
      minutes,
      status: "tight",
      note: `Under your ${formatMinutes(minMinutes)} minimum — no margin if the inbound is late`,
    };
  }
  if (minutes > 5 * 60) {
    return { airport, minutes, status: "long", note: "Long enough to be worth a lounge or a hotel day room" };
  }
  return { airport, minutes, status: "ok", note: "Comfortable" };
}

const DAY_MS = 86_400_000;

/** Calendar days between two YYYY-MM-DD-ish dates, or null if either is unusable. */
function daysBetween(fromIso: string, to: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromIso.trim());
  if (!m) return null;
  const a = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((a - b) / DAY_MS);
}

export function analyseTrip(legs: Leg[], opts: TravelOptions, now = new Date()): TripAnalysis {
  const analysed = legs.map(analyseLeg);
  const warnings: TravelWarning[] = [];

  for (const a of analysed) {
    const label = `${a.leg.from || "?"} → ${a.leg.to || "?"}`;
    for (const e of a.errors) warnings.push({ severity: "critical", message: `${label}: ${e}` });
    if (a.durationMinutes !== null && a.durationMinutes > 20 * 60) {
      warnings.push({
        severity: "warning",
        message: `${label} works out at ${formatMinutes(a.durationMinutes)} in the air — check the arrival date is right.`,
      });
    }
    if (a.departUtc && isValidZone(a.leg.fromZone)) {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", { timeZone: a.leg.fromZone, hour: "2-digit", hour12: false })
          .format(a.departUtc)
          .slice(0, 2),
      );
      if (hour >= 22 || hour < 5) {
        warnings.push({ severity: "info", message: `${label} is a red-eye — block the next morning lightly.` });
      }
    }
    if (a.arriveUtc && isValidZone(a.leg.toZone)) {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", { timeZone: a.leg.toZone, hour: "2-digit", hour12: false })
          .format(a.arriveUtc)
          .slice(0, 2),
      );
      if (hour >= 23 || hour < 4) {
        warnings.push({
          severity: "warning",
          message: `${label} lands after hours — confirm late check-in with the hotel or it won't hold the room.`,
        });
      }
    }
  }

  const connections: Connection[] = [];
  for (let i = 1; i < analysed.length; i++) {
    const c = connectionFor(analysed[i - 1], analysed[i], opts.minConnectionMinutes);
    connections.push(c);
    if (c.status === "impossible") {
      warnings.push({ severity: "critical", message: `${c.airport}: ${c.note}.` });
    } else if (c.status === "tight") {
      warnings.push({
        severity: "warning",
        message: `${c.airport}: only ${formatMinutes(c.minutes!)} to connect — ${c.note.toLowerCase()}.`,
      });
    }
  }

  const first = analysed[0] ?? null;
  const last = analysed[analysed.length - 1] ?? null;
  const departUtc = first?.departUtc ?? null;
  const arriveUtc = last?.arriveUtc ?? null;

  const durations = analysed.map((a) => a.durationMinutes).filter((d): d is number => d !== null && d >= 0);
  const totalTravelMinutes = durations.length ? durations.reduce((s, d) => s + d, 0) : null;
  const totalElapsedMinutes =
    departUtc && arriveUtc ? (arriveUtc.getTime() - departUtc.getTime()) / MINUTE : null;

  const leaveHomeBy = departUtc
    ? new Date(departUtc.getTime() - (opts.airportArrivalMinutes + opts.travelToAirportMinutes) * MINUTE)
    : null;

  let jetLagHours: number | null = null;
  if (arriveUtc && isValidZone(opts.homeZone) && last && isValidZone(last.leg.toZone)) {
    jetLagHours =
      (offsetMinutes(arriveUtc, last.leg.toZone) - offsetMinutes(arriveUtc, opts.homeZone)) / 60;
    if (Math.abs(jetLagHours) >= 5) {
      warnings.push({
        severity: "info",
        message: `${Math.abs(jetLagHours)}-hour clock change on arrival — keep the first working day light and shift sleep a day or two early.`,
      });
    }
  }

  // ---- passport ---------------------------------------------------------------
  // The six-month rule: most destinations require the passport to stay valid for
  // six months beyond arrival, so an in-date passport is not automatically enough.
  if (opts.international && opts.passportExpiry) {
    const daysLeftAtArrival = daysBetween(opts.passportExpiry, arriveUtc ?? now);
    if (daysLeftAtArrival === null) {
      warnings.push({ severity: "warning", message: "Passport expiry date couldn't be read — check it manually." });
    } else if (daysLeftAtArrival < 0) {
      warnings.push({ severity: "critical", message: "The passport expires before this trip. Nothing else matters until that's fixed." });
    } else if (daysLeftAtArrival < 180) {
      warnings.push({
        severity: "critical",
        message: `Passport has ${daysLeftAtArrival} days left on arrival — under the six months most countries require on entry.`,
      });
    }
  }

  return {
    legs: analysed,
    connections,
    totalTravelMinutes,
    totalElapsedMinutes,
    departUtc,
    arriveUtc,
    leaveHomeBy,
    jetLagHours,
    warnings,
    checklist: buildChecklist(opts, { departUtc, arriveUtc, warnings }),
  };
}

function buildChecklist(
  opts: TravelOptions,
  ctx: { departUtc: Date | null; arriveUtc: Date | null; warnings: TravelWarning[] },
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (id: string, label: string, detail: string, dueLabel: string, daysBefore: number | null) =>
    items.push({ id, label, detail, dueLabel, daysBefore });

  if (opts.international) {
    add(
      "passport",
      "Confirm passport validity",
      "Six months beyond the arrival date, and enough blank pages for entry stamps.",
      "As early as possible",
      null,
    );
    if (opts.visaRequired) {
      add("visa", "Apply for visa / travel authorisation", "Lead times vary from hours (ETA) to weeks (consular).", "4+ weeks before", 28);
    }
    add("insurance", "Check travel insurance covers this trip", "Dates, destination and any business-travel exclusion.", "2 weeks before", 14);
    add("money", "Sort currency and card notifications", "Tell the card issuer, or the first transaction gets blocked.", "1 week before", 7);
    add("roaming", "Roaming or eSIM", "Cheaper to arrange before departure than at the gate.", "1 week before", 7);
  }

  add("transport-out", "Ground transport at both ends", "Car to the airport, and pickup on arrival.", "1 week before", 7);
  if (opts.hotel.trim()) {
    const late = ctx.warnings.some((w) => w.message.includes("late check-in"));
    add(
      "hotel",
      "Reconfirm the hotel",
      late
        ? "Arrival is after hours — the booking needs a guaranteed late check-in, in writing."
        : "Confirmation number, check-in time, and whether breakfast is included.",
      late ? "Now" : "3 days before",
      late ? null : 3,
    );
  }
  add("calendar", "Block the calendar for travel time", "Including the airport buffer, not just the flight.", "Now", null);
  add("brief", "Send the itinerary to the traveller", "One message with times in their own timezone.", "3 days before", 3);
  add("checkin", "Online check-in", "Seats and boarding passes.", "24h before departure", 1);
  add("docs", "Pack meeting documents", "Anything needed on arrival, downloaded for offline access.", "Day before", 1);

  return items;
}

/** The settled facts, for the writing engine. Every number here is already computed. */
export function tripFacts(trip: TripAnalysis, opts: TravelOptions): string {
  const lines: string[] = [];
  lines.push(`Traveller: ${opts.traveller || "[TBC]"}`);
  lines.push(`Home timezone: ${opts.homeZone}`);
  if (trip.leaveHomeBy) {
    lines.push(
      `Leave home by: ${formatInZone(trip.leaveHomeBy, opts.homeZone)} (${opts.travelToAirportMinutes}m to the airport + ${opts.airportArrivalMinutes}m before departure)`,
    );
  }
  lines.push("");
  lines.push("Flights (times are local to each airport, already converted — reuse them exactly):");
  trip.legs.forEach((a, i) => {
    const dep = a.departUtc ? formatInZone(a.departUtc, a.leg.fromZone) : "[TBC]";
    const arr = a.arriveUtc ? formatInZone(a.arriveUtc, a.leg.toZone) : "[TBC]";
    const dur = a.durationMinutes !== null && a.durationMinutes >= 0 ? formatMinutes(a.durationMinutes) : "[TBC]";
    lines.push(
      `${i + 1}. ${a.leg.carrier || "Flight"} ${a.leg.reference || ""} ${a.leg.from} → ${a.leg.to}: departs ${dep}, arrives ${arr}, ${dur} in the air${
        a.dayShift ? `, arrives ${a.dayShift > 0 ? `+${a.dayShift}` : a.dayShift} calendar day(s)` : ""
      }`.replace(/\s+/g, " "),
    );
  });
  if (trip.connections.length) {
    lines.push("");
    lines.push("Connections:");
    trip.connections.forEach((c) =>
      lines.push(`- ${c.airport}: ${c.minutes === null ? "[TBC]" : formatMinutes(c.minutes)} — ${c.note}`),
    );
  }
  if (trip.totalElapsedMinutes !== null) {
    lines.push("");
    lines.push(`Total door-to-door: ${formatMinutes(trip.totalElapsedMinutes)}`);
  }
  if (trip.jetLagHours !== null) {
    lines.push(`Clock change on arrival: ${trip.jetLagHours > 0 ? "+" : ""}${trip.jetLagHours}h vs home`);
  }
  if (opts.hotel.trim()) {
    lines.push("");
    lines.push(`Hotel: ${opts.hotel}`);
  }
  if (opts.notes.trim()) {
    lines.push(`Notes from the EA: ${opts.notes}`);
  }
  if (trip.warnings.length) {
    lines.push("");
    lines.push("Issues found (state these in a 'Watch out' section, do not soften them):");
    trip.warnings.forEach((w) => lines.push(`- [${w.severity}] ${w.message}`));
  }
  lines.push("");
  lines.push("Preparation checklist:");
  trip.checklist.forEach((c) => lines.push(`- ${c.label} (${c.dueLabel}): ${c.detail}`));
  return lines.join("\n");
}

export const CONNECTION_TONE: Record<ConnectionStatus, string> = {
  impossible: "urgent",
  tight: "high",
  ok: "done",
  long: "normal",
  unknown: "normal",
};

export function emptyLeg(id: string): Leg {
  return {
    id,
    from: "",
    to: "",
    fromZone: DEFAULT_TRAVEL_OPTIONS.homeZone,
    toZone: "",
    departLocal: "",
    arriveLocal: "",
    carrier: "",
    reference: "",
  };
}
