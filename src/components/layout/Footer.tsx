/**
 * The footer that carries the legal links.
 *
 * ── WHY THESE OPEN IN A NEW TAB ──────────────────────────────────────────
 * Not a style choice. /privacy and /terms render OUTSIDE AppShell — they have
 * to, because they are reachable signed out — so navigating to one in this tab
 * unmounts the shell, and with it MonitoringProvider. That provider's cleanup
 * stops the screen-share stream, and capture cannot restart on its own: the
 * browser demands a fresh user gesture for getDisplayMedia, so the EA would
 * have to notice and re-authorise.
 *
 * An EA clicking "Privacy" mid-shift and silently ending their own screenshot
 * record is precisely the failure monitoringContext was written to prevent —
 * "the session stayed open, the timer kept counting, and the evidence simply
 * stopped without anyone being told". A new tab leaves this one mounted and
 * recording.
 *
 * It is also plain <a> rather than <Link> for the same reason: a client-side
 * navigation is exactly the thing being avoided here.
 *
 * ── WHY IT SITS INSIDE THE SCROLLING MAIN ────────────────────────────────
 * At the end of the page content rather than pinned to the viewport. The shell
 * is a fixed-height flex layout and a pinned bar would take a strip of every
 * screen permanently, for two links almost nobody clicks twice.
 */

/* Honours a subpath deploy: BASE_URL is "/" normally, "/app/" behind one, and
   a hardcoded "/privacy" would 404 in the second case. */
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Footer() {
  return (
    <footer className="mt-10 border-t border-border pt-4 text-xs text-faint">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>Executive OS</span>

        <a
          href={`${base}/privacy`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded transition-colors hover:text-muted hover:underline"
        >
          Privacy Policy
        </a>

        <a
          href={`${base}/terms`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded transition-colors hover:text-muted hover:underline"
        >
          Terms
        </a>

        <span className="ml-auto">© {new Date().getFullYear()} MadeEA</span>
      </div>
    </footer>
  );
}
