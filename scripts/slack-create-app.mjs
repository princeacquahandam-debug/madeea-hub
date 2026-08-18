/**
 * Create the MadeEA Slack app from a manifest, without a browser.
 *
 *   node scripts/slack-create-app.mjs <xoxe-config-token>
 *
 * WHY A NEW APP RATHER THAN EDITING THE OLD ONE. The original app (A0B729WAQ67)
 * was created by another account. A Slack configuration token can only manage
 * apps its own account is a collaborator on, and workspace admin does not grant
 * that, so editing it needs the owner to act first. Creating the app under the
 * account that will run it removes that dependency permanently: every later
 * scope change is `slack-add-scope.mjs` rather than a favour to ask.
 *
 * The trade is that a new bot starts outside every channel and has to be
 * invited. That is cheap here (one channel, empty) and it is a one-time cost.
 *
 * WHAT THIS CANNOT DO. Slack requires a person to approve an app's permissions
 * on install. There is no API for that and there should not be. This gets you
 * to that single click and prints the link.
 *
 * SECRETS. Creating an app returns its signing secret and client secret. They
 * are written to .slack-app.local (gitignored) and never printed, because a
 * terminal is a log.
 */

const INPUT = process.argv[2];
if (!INPUT || !INPUT.startsWith("xoxe")) {
  console.error("Usage: node scripts/slack-create-app.mjs <xoxe-config-token>");
  console.error("Get one at api.slack.com/apps -> 'Your App Configuration Tokens'.");
  process.exit(1);
}

/* Same pair problem as slack-add-scope.mjs: the panel shows an access token
   (xoxe.xoxp-) and a refresh token (xoxe-1-), and only the first is accepted.
   Take either. */
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
    console.error("Generate a fresh pair at api.slack.com/apps and try again.");
    process.exit(1);
  }
  TOKEN = d.token;
  console.log("exchanged the refresh token for an access token");
}

const api = async (method, body) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body ?? {}),
  });
  const d = await r.json();
  if (!d.ok) {
    const detail = d.errors ? "\n" + JSON.stringify(d.errors, null, 2) : "";
    throw new Error(`${method}: ${d.error}${detail}`);
  }
  return d;
};

/* Every scope is listed with the thing it lets the Communication Center do.
   Scopes are cheap to ask for NOW and expensive later: adding one means another
   reinstall and another new bot token. But each also appears on the consent
   screen, so this is the read+write set the Center actually uses and nothing
   speculative. No files, no reactions, no admin. */
const BOT_SCOPES = [
  "channels:read",      // list public channels
  "channels:history",   // read messages in them
  "groups:read",        // list private channels the bot is in
  "groups:history",     // read messages in them
  "im:read",            // list direct messages
  "im:history",         // read direct messages
  "mpim:read",          // list group direct messages
  "mpim:history",       // read group direct messages
  "users:read",         // resolve a user id to a name
  "users:read.email",   // match a Slack user to a client record by email
  "chat:write",         // post, which is the whole point of this exercise
  "chat:write.public",  // post to a public channel without joining it first
  "team:read",          // workspace name, so multi-workspace stays possible
];

const manifest = {
  display_information: {
    name: "MadeEA OS",
    description: "Reads and replies to client messages from the MadeEA Communication Center.",
    background_color: "#0f172a",
  },
  features: {
    bot_user: { display_name: "MadeEA OS", always_online: false },
  },
  oauth_config: { scopes: { bot: BOT_SCOPES } },
  settings: {
    org_deploy_enabled: false,
    socket_mode_enabled: false,
    is_hosted: false,
    /* Rotation would expire the bot token on a schedule and there is nothing
       in the app yet that refreshes it, so a rotating token would look exactly
       like a broken integration a few hours after it starts working. */
    token_rotation_enabled: false,
  },
};

console.log("requesting these bot scopes:");
for (const s of BOT_SCOPES) console.log(`  ${s}`);

// Validate before creating, so a bad manifest is a message rather than a
// half-made app sitting in the workspace.
await api("apps.manifest.validate", { manifest });
console.log("\nmanifest valid");

const created = await api("apps.manifest.create", { manifest });
const appId = created.app_id;

// Written, not printed. A terminal is a log and these are real secrets.
const fs = await import("node:fs/promises");
await fs.writeFile(
  ".slack-app.local",
  JSON.stringify({ app_id: appId, credentials: created.credentials }, null, 2),
  "utf8",
);

console.log(`\napp created: ${appId}`);
console.log("credentials written to .slack-app.local (gitignored, not printed)");
console.log(`
Three steps left, and all three need a human:

1. Install it. Slack makes a person approve permissions; there is no API for it.
     https://api.slack.com/apps/${appId}/install-on-team

2. Invite the bot to each channel it should read:
     /invite @MadeEA OS

3. Copy the Bot User OAuth Token (starts xoxb-) from:
     https://api.slack.com/apps/${appId}/oauth
   and send it over. It goes into Supabase as SLACK_BOT_TOKEN, never into git.
`);
