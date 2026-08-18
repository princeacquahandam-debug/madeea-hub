/**
 * Getting a usable Slack app-configuration token, and keeping it usable.
 *
 * Two things about these tokens cause almost all the confusion:
 *
 * 1. They come in PAIRS and the panel shows both. Only the access token
 *    (xoxe.xoxp-) is accepted by the manifest API. The refresh token (xoxe-1-)
 *    comes back as not_allowed_token_type, which reads like an invalid token
 *    rather than the wrong half of a pair.
 *
 * 2. Rotating CONSUMES the refresh token. Each rotation returns a new one, and
 *    if you drop it on the floor, the pair is dead and somebody has to visit
 *    the panel again. That happened three times before this module existed,
 *    which is what it is for: the replacement is written straight back to disk
 *    so the next run picks up where this one left off.
 *
 * The store is gitignored (*.local) and holds real credentials, so nothing here
 * prints a token. A terminal is a log.
 */

import { readFile, writeFile } from "node:fs/promises";

const STORE = ".slack-app.local";

async function readStore() {
  try {
    return JSON.parse(await readFile(STORE, "utf8"));
  } catch {
    return {};
  }
}

export async function saveStore(patch) {
  const store = await readStore();
  await writeFile(STORE, JSON.stringify({ ...store, ...patch }, null, 2), "utf8");
}

/** The app id from a previous create, so callers need not be told it twice. */
export async function savedAppId() {
  return (await readStore()).app_id ?? null;
}

/** Every caller needs the same sentence, so it lives in one place. */
function whereToGetOne() {
  console.error("Get a token at api.slack.com/apps, at the bottom of the page under");
  console.error("'Your App Configuration Tokens'. Generate Token, pick the workspace,");
  console.error("then copy either string. They expire after 12 hours.");
}

/**
 * Resolve an access token from whatever is available, in order of preference:
 * an explicit argument, then the refresh token saved by a previous run.
 * Returns null when there is nothing to work with, having already said why.
 * Callers exit on null; they do not need to explain it again.
 */
export async function accessToken(input) {
  const store = await readStore();
  const candidate = input ?? store.refresh_token;
  if (!candidate) {
    console.error("No Slack configuration token was passed and none is saved.");
    whereToGetOne();
    return null;
  }

  // Already the right half of the pair. Nothing to do, and deliberately not
  // rotated: rotating a working access token would throw it away for no gain.
  if (candidate.startsWith("xoxe.xoxp-")) return candidate;

  const r = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: candidate }),
  });
  const d = await r.json();
  if (!d.ok) {
    if (input && store.refresh_token && input !== store.refresh_token) {
      console.error(`The token passed in was refused (${d.error}); trying the saved one.`);
      return accessToken(undefined);
    }
    console.error(`Could not exchange the refresh token: ${d.error}`);
    if (d.error === "invalid_refresh_token") {
      console.error("That pair is spent: rotating consumes it, and each rotation issues");
      console.error("a replacement that this stores. A spent one means the replacement");
      console.error("was lost, or somebody generated a new pair in the meantime.");
      whereToGetOne();
    }
    return null;
  }

  /* The whole point. Persist the replacement BEFORE returning, so a crash
     later in the caller does not cost the token. */
  await saveStore({ refresh_token: d.refresh_token });
  return d.token;
}

/** Slack API call that reports the two failures worth distinguishing. */
export function apiWith(token, appIdFor = () => null) {
  return async (method, body) => {
    const r = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body ?? {}),
    });
    const d = await r.json();
    if (!d.ok) {
      /* A configuration token can only manage apps its own account collaborates
         on, and Slack reports that as a bare no_permission against the app id,
         which reads like a broken token. Usually it is not. Cheap way to tell
         them apart: apps.manifest.validate takes no app id, so if that succeeds
         and this fails, the token is fine and the access is the problem. */
      if (d.error === "no_permission") {
        throw new Error(
          [
            `no_permission on ${method} for app ${appIdFor() ?? "(unknown)"}.`,
            "The token itself is probably fine. The Slack account that generated it is",
            "not a collaborator on this app, so it cannot edit it. Either have the app",
            "owner add that account under Settings > Collaborators (then generate a",
            "FRESH token, since collaborator changes do not apply to ones already",
            "issued), or add the scope by hand in the UI.",
          ].join("\n"),
        );
      }
      const detail = d.errors ? "\n" + JSON.stringify(d.errors, null, 2) : "";
      throw new Error(`${method}: ${d.error}${detail}`);
    }
    return d;
  };
}
