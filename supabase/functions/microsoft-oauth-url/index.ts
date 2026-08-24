// Edge Function: microsoft-oauth-url   (Verify JWT: ON. Default)
// Returns a Microsoft consent URL for the signed-in user and records an OAuth state.
//
// The Google twin of this file pins the state to the caller's email and has the
// callback enforce the match. This one deliberately does not: see 0048 for why
// (login address and mailbox address routinely differ on Microsoft), and see
// microsoft-oauth-claim for what replaces it. The state here carries identity
// for the CLAIM step to check, not for the callback to trust.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

/* "common" lets both work/school accounts and personal Outlook.com accounts
   consent. A single-tenant deployment sets MICROSOFT_TENANT to its tenant id,
   which is also the only way to connect a tenant that blocks multi-tenant apps. */
const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";

/* Mail.ReadWrite rather than Mail.Read, and it is not scope creep.
   A threaded reply on Graph is createReply -> edit the draft -> send, because
   sendMail cannot set In-Reply-To/References (Graph refuses to write standard
   internet headers). Drafting requires write access to the mailbox. The
   alternative is a reply that arrives as a brand new conversation, which is the
   exact bug 0042 was written to fix on the Gmail side.
   Nothing here deletes: Mail.ReadWrite covers drafts, not mailbox destruction,
   and outlook-send only ever creates a draft it immediately sends. */
/* Teams rides on the same consent, which is the whole reason the Teams card
   has no button of its own. Two scopes, both delegated and both personal:
   Chat.Read reads the chats this person is already in, ChatMessage.Send posts
   as them. Deliberately NOT ChannelMessage.Read.All, which is admin-consent
   and tenant-wide, i.e. every channel message in the organisation for one
   click. Channels are a separate, separately-consented feature if they are
   ever wanted.

   Adding these changes what NEW authorisations ask for; it does not touch a
   token already granted. Anyone who connected before this keeps mail and gains
   Teams only when they reconnect, so nobody is forced through a re-consent by
   this line alone. teams-sync checks the recorded scopes and says exactly that
   rather than returning an empty chat list. */
const SCOPES = [
  "offline_access",
  "openid",
  "email",
  "profile",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Chat.Read",
  "https://graph.microsoft.com/ChatMessage.Send",
].join(" ");

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": APP_ORIGINS.includes(origin) ? origin : (APP_ORIGINS[0] ?? "null"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
    // Said here rather than at Microsoft. An unconfigured app otherwise sends
    // the user to a login page that fails with Microsoft's own error code and
    // no hint that the fix is a secret in the Supabase dashboard.
    if (!clientId) return json({ error: "MICROSOFT_CLIENT_ID is not configured" }, 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const user = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    // Never trust a redirect target from the request body.
    const { origin, popup: wantsPopup } = await req.json().catch(() => ({ origin: "", popup: false }));
    const redirectTo = APP_ORIGINS.includes(String(origin ?? "")) ? String(origin) : APP_ORIGINS[0];
    if (!redirectTo) return json({ error: "APP_ORIGINS is not configured" }, 500);

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: st, error } = await admin
      .from("oauth_states")
      .insert({
        user_id: u.user.id,
        redirect_to: redirectTo,
        provider: "microsoft",
        popup: wantsPopup === true,
        /* expected_email is left null ON PURPOSE. Writing the login address
           here would imply the callback enforces it, and it does not. The
           binding that matters happens in microsoft-oauth-claim. */
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .select("state")
      .single();
    if (error) return json({ error: error.message }, 500);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${SUPABASE_URL}/functions/v1/microsoft-oauth-callback`,
      response_type: "code",
      response_mode: "query",
      scope: SCOPES,
      state: st.state,
      /* No login_hint, and select_account rather than none. The mailbox being
         connected is frequently NOT the account the browser is already signed
         into (a personal Microsoft account signed in for Teams, a work mailbox
         being connected), and silently reusing the wrong one produces a
         connection that looks fine and syncs somebody else's mail. */
      prompt: "select_account",
    });
    return json({ url: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params.toString()}` });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
