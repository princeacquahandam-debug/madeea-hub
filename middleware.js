/**
 * Real "not found" for addresses that are only ever probes (QA BUG-006, 20 Nov 2026).
 *
 * The Hub is a single-page app, so every unknown address is answered with the
 * app itself and a 200. That is right for /eod or /inbox, but /.env, /.git/HEAD,
 * /wp-admin or /x.php are never pages here: answering them with "found" makes
 * every security scanner flag the site. A rewrite to a missing file did not
 * help (Vercel fell through to the app), so this runs only on those paths,
 * via the matcher below, and nowhere else.
 */
export const config = {
  matcher: [
    "/(\\..*)",
    "/(wp-.*)",
    "/(cgi-bin.*)",
    "/(phpmyadmin.*)",
    "/(.*\\.(?:php|asp|aspx|env|ini|bak|sql|yml|yaml|log))",
  ],
};

export default function middleware(request) {
  const { pathname } = new URL(request.url);
  // Domain and app verification files live under /.well-known; let them through.
  if (pathname.startsWith("/.well-known/")) return;
  return new Response("Not found\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
