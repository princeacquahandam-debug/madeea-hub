/**
 * Add an OAuth scope to the MadeEA Slack app, without a browser.
 *
 *   node scripts/slack-add-scope.mjs [scope ...] [--token <xoxe-...>]
 *
 * Defaults to chat:write. With no token argument it reuses the one saved by a
 * previous run (see scripts/slack-token.mjs), and with no app id it uses the
 * app that slack-create-app.mjs made.
 *
 * Reads the CURRENT manifest, adds only what is missing, and writes it back. It
 * never composes a manifest from scratch, because that would silently discard
 * event subscriptions, slash commands and redirect URLs configured by hand.
 *
 * WHY NOT THE SLACK CLI. `slack login` prints a challenge you paste into Slack
 * and then paste a ticket back. Interactive by design, so it cannot run here.
 * A configuration token is the non-interactive equivalent and is scoped to app
 * management only: it cannot read messages, cannot post, and is not anybody's
 * personal account.
 *
 * WHOSE TOKEN IT HAS TO BE. A configuration token only manages apps its own
 * account is a collaborator on. Workspace admin does not grant that, and owning
 * the workspace does not either.
 *
 * WHAT THIS CANNOT DO. Granting a scope still needs a person to reinstall the
 * app, because Slack asks a human to approve new permissions. This gets you to
 * that one click and prints the link.
 */

import { accessToken, savedAppId, apiWith } from "./slack-token.mjs";

const argv = process.argv.slice(2);
const tokenFlag = argv.indexOf("--token");
const passedToken = tokenFlag === -1 ? undefined : argv[tokenFlag + 1];
if (tokenFlag !== -1) argv.splice(tokenFlag, 2);
const WANTED = argv.length ? argv : ["chat:write"];

const TOKEN = await accessToken(passedToken);
if (!TOKEN) process.exit(1);

let appId = process.env.SLACK_APP_ID ?? (await savedAppId());
if (!appId) {
  console.error("No app id. Pass one explicitly:");
  console.error("  SLACK_APP_ID=A0123... node scripts/slack-add-scope.mjs");
  process.exit(1);
}

const api = apiWith(TOKEN, () => appId);
console.log(`app: ${appId}`);

const current = await api("apps.manifest.export", { app_id: appId });
const manifest = current.manifest;
const bot = manifest.oauth_config?.scopes?.bot ?? [];
console.log(`current bot scopes: ${bot.join(", ") || "(none)"}`);

const missing = WANTED.filter((s) => !bot.includes(s));
if (!missing.length) {
  console.log(`\nAlready has ${WANTED.join(", ")}. Nothing to change.`);
  console.log("If the bot still cannot post, the INSTALLED token predates the scope.");
  console.log(`Reinstall and take the new one: https://api.slack.com/apps/${appId}/install-on-team`);
  process.exit(0);
}

manifest.oauth_config = manifest.oauth_config ?? {};
manifest.oauth_config.scopes = manifest.oauth_config.scopes ?? {};
manifest.oauth_config.scopes.bot = [...bot, ...missing];

await api("apps.manifest.validate", { app_id: appId, manifest });
await api("apps.manifest.update", { app_id: appId, manifest });
console.log(`added: ${missing.join(", ")}`);

console.log(`
The scope is on the app but NOT on the token in use. Slack only grants new
permissions at install time, so until somebody reinstalls, this changes nothing
and the failure looks identical to it never having worked.

1. Reinstall:  https://api.slack.com/apps/${appId}/install-on-team
2. Copy the new Bot User OAuth Token (xoxb-) from the OAuth page. Reinstalling
   issues a NEW token; the old one keeps the old scopes.
3. supabase secrets set SLACK_BOT_TOKEN=xoxb-...
`);
