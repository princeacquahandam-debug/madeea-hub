/**
 * Add an OAuth scope to the MadeEA Slack app, without a browser.
 *
 *   node scripts/slack-add-scope.mjs <xoxe-config-token> [scope ...]
 *
 * Defaults to chat:write, which is the one the Communication Center needs to
 * post. Reads the CURRENT manifest, adds only what is missing, and writes it
 * back. It never composes a manifest from scratch, because that would silently
 * discard event subscriptions, slash commands and redirect URLs that somebody
 * configured by hand.
 *
 * WHY NOT THE SLACK CLI. `slack login` prints a challenge you paste into a
 * Slack workspace and then paste a ticket back. That is interactive by design,
 * so it cannot run here. An App Configuration Token is the non-interactive
 * equivalent and is scoped to app management only: it cannot read messages,
 * cannot post, and is not anybody's personal account.
 *
 * WHERE THE TOKEN COMES FROM
 *   api.slack.com/apps  ->  "Your App Configuration Tokens" (bottom of the page)
 *   Generate Token, pick the workspace. You get TWO strings. Either works here:
 *   pass the access token (xoxe.xoxp-) directly, or pass the refresh token
 *   (xoxe-1-) and this exchanges it. Both expire in 12 hours, which is the
 *   right shape for a one-off change.
 *
 * WHOSE TOKEN IT HAS TO BE. A configuration token can only manage apps its own
 * Slack account is a collaborator on. Being a workspace admin is not enough and
 * neither is owning the workspace. If the app was created by someone else, get
 * added under the app's Settings > Collaborators first, then generate the token
 * (an existing one will not pick up the new access).
 *
 * WHAT THIS DOES NOT DO. Granting a scope still requires a human to reinstall
 * the app, because Slack asks a person to approve new permissions. This gets
 * you to that one click and prints the link.
 */

const INPUT = process.argv[2];
const WANTED = process.argv.slice(3).length ? process.argv.slice(3) : ["chat:write"];

if (!INPUT || !INPUT.startsWith("xoxe")) {
  console.error("Usage: node scripts/slack-add-scope.mjs <xoxe-...> [scope ...]");
  console.error("Get a token at api.slack.com/apps under 'Your App Configuration Tokens'.");
  process.exit(1);
}

/* Slack issues configuration tokens in PAIRS, and the panel shows both, which
   is exactly where this trips people up:
     xoxe.xoxp-...  the ACCESS token, the only one the manifest API accepts
     xoxe-1-...     the REFRESH token, which the API rejects as not_allowed_token_type
   Given the refresh token, exchange it rather than sending somebody back to the
   panel to hunt for the other string. Rotating also invalidates the old pair,
   so a token that got pasted into a chat window stops working. */
let TOKEN = INPUT;
if (!INPUT.startsWith("xoxe.xoxp-")) {
  const r = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: INPUT }),
  });
  const d = await r.json();
  if (!d.ok) {
    console.error(`Could not exchange the refresh token: ${d.error}`);
    console.error("If that says invalid_refresh_token, generate a fresh pair and pass");
    console.error("the one starting xoxe.xoxp- instead.");
    process.exit(1);
  }
  TOKEN = d.token;
  console.log("exchanged the refresh token for an access token");
}

/* Declared up here because the error translator below reads it. */
let appId = process.env.SLACK_APP_ID;

const api = async (method, body) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body ?? {}),
  });
  const d = await r.json();
  if (!d.ok) {
    /* The one failure worth translating. A configuration token can only manage
       apps its own Slack account is a COLLABORATOR on, and Slack reports that
       as a bare "no_permission" against the app id, which reads like the token
       is broken. Usually it is not: an app somebody else created is simply not
       yours to edit, however valid your token is.
       Cheap way to tell the two apart: apps.manifest.validate takes no app id,
       so if that call succeeds and this one fails, the token is fine and the
       access is the problem. */
    if (d.error === "no_permission") {
      throw new Error(
        [
          `no_permission on ${method} for app ${appId ?? "(unknown)"}.`,
          "The token itself is probably fine. The Slack account that generated it is not",
          "a collaborator on this app, so it cannot edit it. Either have the app owner add",
          "that account under Settings > Collaborators (then generate a FRESH config token,",
          "since collaborator changes do not apply to tokens already issued), or add the",
          "scope by hand in the UI.",
        ].join("\n"),
      );
    }
    throw new Error(`${method}: ${d.error}${d.errors ? " " + JSON.stringify(d.errors) : ""}`);
  }
  return d;
};

// 1. Which apps can this token manage?
const list = await api("apps.manifest.validate").catch(() => null);
void list;

const apps = await (async () => {
  const r = await fetch("https://slack.com/api/apps.list", {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const d = await r.json();
  return d.ok ? d.apps ?? [] : null;
})();

if (!appId) {
  if (!apps?.length) {
    console.error("Could not list apps for this token. Pass the app id explicitly:");
    console.error("  SLACK_APP_ID=A0123... node scripts/slack-add-scope.mjs <token>");
    process.exit(1);
  }
  if (apps.length === 1) appId = apps[0].id;
  else {
    console.log("Several apps are visible to this token. Re-run with the one you want:\n");
    for (const a of apps) console.log(`  SLACK_APP_ID=${a.id}  ${a.name}`);
    process.exit(0);
  }
}

console.log(`app: ${appId}`);

// 2. Read what is there now.
const current = await api("apps.manifest.export", { app_id: appId });
const manifest = current.manifest;
const bot = manifest.oauth_config?.scopes?.bot ?? [];
console.log(`current bot scopes: ${bot.join(", ") || "(none)"}`);

const missing = WANTED.filter((s) => !bot.includes(s));
if (!missing.length) {
  console.log(`\nNothing to do. Already granted: ${WANTED.join(", ")}`);
  process.exit(0);
}
console.log(`adding: ${missing.join(", ")}`);

// 3. Add, keeping everything else exactly as it was.
manifest.oauth_config = manifest.oauth_config ?? {};
manifest.oauth_config.scopes = manifest.oauth_config.scopes ?? {};
manifest.oauth_config.scopes.bot = [...bot, ...missing];

const check = await api("apps.manifest.validate", { app_id: appId, manifest });
void check;
console.log("manifest validates");

await api("apps.manifest.update", { app_id: appId, manifest });
console.log(`updated. bot scopes are now: ${manifest.oauth_config.scopes.bot.join(", ")}`);

console.log(`
ONE STEP LEFT, and it needs a person.
Slack will not grant a new scope until somebody approves it:

  https://api.slack.com/apps/${appId}/install-on-team

Click "Reinstall to Workspace", approve, then copy the new Bot User OAuth Token
(it starts xoxb- and CHANGES on reinstall) and set it:

  supabase secrets set SLACK_BOT_TOKEN=xoxb-...

Then hit Sync Slack in the app; it will report chat:write present.`);
