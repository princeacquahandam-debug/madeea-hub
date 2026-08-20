/**
 * Inbox timestamps: "3m", "5h", "2w", "4 Aug", "22 Mar 2025".
 *
 * WHY NOT A CLOCK TIME. The old row showed "6:43 AM" on every message, so a
 * thing that arrived three minutes ago and a thing from March looked equally
 * current, and the only way to tell them apart was to read the date column and
 * do the subtraction yourself. In an inbox the useful question is almost always
 * "how long has this been sitting there", not "at what hour did it land".
 *
 * The unit coarsens as the answer gets older, because precision stops being
 * worth the width: minutes matter this morning, the month is enough in March.
 * The year appears only once it is not this year, which is the only case where
 * its absence would actually mislead.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const secs = Math.round((now - then) / 1000);

  // Clock skew, or a message dated slightly ahead. "in 2m" would be noise, and
  // claiming it is 0m old is close enough to true.
  if (secs < 0) return "now";

  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const d = new Date(then);
  const weeks = Math.floor(days / 7);
  // Four weeks is where "5w" starts being harder to place than a date.
  if (weeks < 4) return `${weeks}w`;

  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const stamp = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return sameYear ? stamp : `${stamp} ${d.getFullYear()}`;
}

/** The full timestamp, for the title attribute. The short form is a summary. */
export function fullTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/**
 * A stable colour per sender, so the same person is the same colour every time.
 *
 * These stand in for the profile photos the reference design has and we do not:
 * Gmail and Slack give us a display name and nothing else. Inventing faces would
 * be worse than initials, and a random colour per render would be worse than
 * both, because the point of the circle is to be recognisable before you read it.
 */
export function avatarHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/**
 * Readable colours for an initials avatar, for a given hue.
 *
 * WHY THIS IS NOT `hsl(h 65% 45%)` ON A TINT. That was the original rule, and a
 * fixed lightness across all 360 hues does not hold contrast, because hues are
 * not equally bright: at the same L, yellow is far lighter than blue. Measured
 * across the real inbox it ranged from 1.58:1 to 5.56:1. A yellow avatar was
 * effectively blank, and it accounted for 26 of the 39 light-theme AA failures
 * on the screen, all from one component.
 *
 * WHY IT TAKES NO THEME. An earlier fix passed the current theme in and picked
 * a dark-on-light or light-on-dark pair. That worked, but it made a small
 * visual detail depend on a Zustand store, so the colours were only correct as
 * long as every theme change went through the app. The avatar paints its own
 * opaque background, so it does not need to know: one pair that passes against
 * itself passes on any page. Same reason Gmail's avatars look identical in dark
 * mode.
 *
 * Lightness is still corrected per hue, so the bright band around yellow and
 * green is darkened and blues are allowed to stay lighter.
 */
export function avatarColors(hue: number): { bg: string; fg: string } {
  // Roughly how bright this hue is at a fixed lightness: peaks at yellow (60),
  // bottoms out at blue (240).
  const brightness = Math.cos(((hue - 60) * Math.PI) / 180);
  return {
    bg: `hsl(${hue} 52% 90%)`,
    fg: `hsl(${hue} 62% ${26 + brightness * -5}%)`,
  };
}
