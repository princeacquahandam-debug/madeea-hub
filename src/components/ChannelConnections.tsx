import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Hash, Lock, Plug, RefreshCw } from "lucide-react";
import { REAL_CHANNELS, STATUS_LABEL, type Channel, type ChannelStatus } from "@/lib/channels";
import { listSlackChannels } from "@/lib/slack";
import { useMailConnections, useMyEmail } from "@/data/hooks";
import { listDiscordChannels, syncDiscord } from "@/lib/discord";
import { metaStatus, syncInstagram } from "@/lib/meta";
import { reconnectMail } from "@/hooks/useSendEmail";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { MailProvider } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * Every message channel and its real state, in one place.
 *
 * WHY THIS EXISTS. "Which channels are connected" was answerable only by
 * opening the Inbox, choosing each channel, and reading a note beside it. That is three steps to learn something that should be a
 * glance, and it is the first question anyone asks when a client says they
 * messaged us somewhere.
 *
 * WHY IT DOES NOT OFFER A CONNECT BUTTON FOR EVERYTHING. The honest answer per
 * channel is wildly different. Gmail is an OAuth click. Slack was a scope and a
 * reinstall. Discord is a bot token. WhatsApp is a Meta Business review that
 * takes days and needs a phone number that has never been on WhatsApp. Giving
 * all four an identical "Connect" button would say those are the same job, and
 * whoever pressed the WhatsApp one would rightly feel lied to. So each states
 * what it actually needs, and only the ones that can be actioned here get a
 * control.
 *
 * WHICH IS WHY THE TWO MAILBOXES NOW HAVE ONE. Gmail and Outlook are genuinely
 * an OAuth click each, and this is where people arrive asking "can I connect my
 * email". Sending them somewhere else on the same page to press a button that
 * belongs on this card was a step that existed only because the cards were
 * built before the connections were.
 *
 * The status these two show is LIVE and personal: it is read from your own
 * credential row, not from the static catalogue, so "Connected" here means you
 * connected it, not that the product supports it. Everything else on the grid
 * still shows the catalogue's status, because for those two answers are the
 * same thing.
 */

/* Null means "we do not know yet", which is a third state and has to look like
   one. A mailbox card that guesses while its credential row is in flight either
   tells a connected person they are not connected or the reverse, and both are
   read as the answer rather than as a loading state. */
function StatusPill({ status }: { status: ChannelStatus | null }) {
  // Status carries a word as well as a colour, so it survives being printed,
  // screenshotted, or read by someone who does not distinguish red from green.
  const tone: Record<ChannelStatus, string> = {
    connected: "bg-emerald-500/15 text-emerald-400",
    read_only: "bg-amber-500/15 text-amber-400",
    not_connected: "bg-zinc-500/15 text-faint",
    planned: "bg-zinc-500/15 text-faint",
  };
  if (!status) return <span className="pill bg-zinc-500/15 text-faint">Checking…</span>;
  return <span className={cn("pill", tone[status])}>{STATUS_LABEL[status]}</span>;
}

/** Which channels are a mailbox, and which credential row each one lives in. */
const MAIL_PROVIDER: Partial<Record<Channel["id"], MailProvider>> = {
  gmail: "gmail",
  outlook: "outlook",
};

const CREDENTIAL_TABLE: Record<MailProvider, string> = {
  gmail: "google_credentials",
  outlook: "microsoft_credentials",
};

const SYNC_FUNCTION: Record<MailProvider, string> = {
  gmail: "gmail-sync",
  outlook: "outlook-sync",
};

/**
 * Connect, sync and disconnect for one mailbox.
 *
 * ONE COMPONENT FOR BOTH PROVIDERS. The two differ in a table name, a function
 * name and one sentence of warning; everything else (the busy state, reading
 * the failure out of the edge function's body, invalidating the message list)
 * is identical, and two copies of it would drift the first time one was fixed.
 */
function MailControls({ provider }: { provider: MailProvider }) {
  const qc = useQueryClient();
  const { data: mail } = useMailConnections();
  const myEmail = useMyEmail();
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [note, setNote] = useState("");

  const conn = mail?.[provider];
  const label = provider === "outlook" ? "Outlook" : "Gmail";
  /* Gmail has no stored address because there cannot be one: Google's callback
     requires the connected account to BE your login. Outlook stores its own,
     because the two are routinely different. */
  const address = provider === "outlook" ? conn?.account_email : myEmail;

  async function connect() {
    setBusy("connect");
    setNote("");
    // Returns a reason only when it could NOT start; on success the browser is
    // already on its way to the provider and nothing below runs.
    const err = await reconnectMail(provider);
    if (err) {
      setNote(err);
      setBusy(null);
    }
  }

  async function sync() {
    if (!supabase) return;
    setBusy("sync");
    setNote("");
    try {
      const { data, error } = await supabase.functions.invoke(SYNC_FUNCTION[provider]);
      /* The reason lives in the function's JSON body, which the SDK hides
         behind error.context. Reporting error.message alone turns every
         failure into "Edge Function returned a non-2xx status code", which
         tells the person nothing they can act on. */
      let payload = (data ?? null) as { synced?: number; error?: string } | null;
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try { payload = JSON.parse(await ctx.text()); } catch { payload = null; }
        }
      }
      if (error || payload?.error) {
        setNote(payload?.error ?? error?.message ?? "Sync failed");
      } else {
        const n = payload?.synced ?? 0;
        setNote(n ? `Pulled ${n} message${n === 1 ? "" : "s"}.` : "Nothing new to pull.");
        qc.invalidateQueries({ queryKey: ["messages"] });
      }
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!supabase) return;
    /* Confirmed, and the Gmail warning is not boilerplate: one Google consent
       covers mail AND calendar, so disconnecting here stops the Dashboard's
       events too. Somebody who only meant to stop mail syncing deserves to
       know that before they press it, not after the calendar empties. */
    const warning = provider === "gmail"
      ? "Disconnect Google? This stops Gmail sync AND your calendar events, and you will need to sign in again to reconnect."
      : "Disconnect Outlook? Mail stops syncing and replies can no longer be sent from it until you reconnect.";
    if (!window.confirm(warning)) return;

    setBusy("disconnect");
    setNote("");
    try {
      /* RLS scopes the delete to your own row (0016 for Google, 0048 for
         Microsoft), so the filter is only here because the client requires
         one: it cannot reach anybody else's credentials whatever it sends. */
      const { error } = await supabase
        .from(CREDENTIAL_TABLE[provider])
        .delete()
        .neq("owner_id", "00000000-0000-0000-0000-000000000000");
      /* Named for what actually stopped. "Gmail disconnected" would be a
         half-truth on Google, where the same consent was carrying the calendar. */
      const done = provider === "gmail"
        ? "Google disconnected. Gmail and calendar sync have stopped."
        : "Outlook disconnected.";
      setNote(error ? error.message : done);
      qc.invalidateQueries({ queryKey: ["mail-connections"] });
    } finally {
      setBusy(null);
    }
  }

  /* Same rule as the pill above: no buttons until the answer is in. Offering
     "Connect" to somebody who is already connected invites a pointless trip
     through a consent screen. */
  if (!mail) {
    return (
      <p className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[12px] text-faint">
        <Loader2 size={12} className="animate-spin" /> Checking connection…
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {conn?.connected ? (
        <>
          {address && (
            <p className="mb-2 truncate text-[12px] text-muted" title={address}>
              Sending as <span className="text-text">{address}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost border border-border py-1 text-[12px]" onClick={sync} disabled={busy !== null}>
              {busy === "sync" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync mail
            </button>
            <button className="btn-ghost border border-border py-1 text-[12px]" onClick={disconnect} disabled={busy !== null}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <button
          className="btn-primary py-1 text-[12px]"
          onClick={connect}
          disabled={!isSupabaseConfigured || busy !== null}
        >
          {busy === "connect" ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Connect {label}
        </button>
      )}
      {note && <p className="mt-2 text-[12px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

/** Graph's name for "may read the chats this person is in". */
const TEAMS_SCOPE = "Chat.Read";

/**
 * Teams, which is not a connection of its own.
 *
 * It runs on the Microsoft consent the Outlook card already owns, so this card
 * deliberately has no Connect button: two buttons for one sign-in would let
 * somebody "connect Teams" and wonder why Outlook came with it. What it does
 * have is the third state that falls out of sharing a consent: connected to
 * Microsoft, but before Teams was supported, so the token has the mail scopes
 * and not Chat.Read. That is a reconnect, not a connect, and saying the wrong
 * one of those sends people looking for a button that is not there.
 */
function TeamsControls() {
  const qc = useQueryClient();
  const { data: mail } = useMailConnections();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  if (!mail) {
    return (
      <p className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[12px] text-faint">
        <Loader2 size={12} className="animate-spin" /> Checking connection…
      </p>
    );
  }

  const ms = mail.outlook;
  const hasTeams = Boolean(ms.connected && ms.scopes?.includes(TEAMS_SCOPE));

  async function sync() {
    if (!supabase) return;
    setBusy(true);
    setNote("");
    try {
      const { data, error } = await supabase.functions.invoke("teams-sync");
      let payload = (data ?? null) as { synced?: number; chats?: number; error?: string } | null;
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try { payload = JSON.parse(await ctx.text()); } catch { payload = null; }
        }
      }
      if (error || payload?.error) {
        setNote(payload?.error ?? error?.message ?? "Sync failed");
      } else {
        const n = payload?.synced ?? 0;
        setNote(n
          ? `Pulled ${n} message${n === 1 ? "" : "s"} from ${payload?.chats ?? 0} chat${payload?.chats === 1 ? "" : "s"}.`
          : "No new chat messages.");
        qc.invalidateQueries({ queryKey: ["messages"] });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {!ms.connected ? (
        <p className="text-[12px] leading-relaxed text-muted">
          Connect Microsoft on the Outlook card. Teams uses the same sign-in, so it switches on with it.
        </p>
      ) : !hasTeams ? (
        <>
          <p className="text-[12px] leading-relaxed text-muted">
            This Microsoft account was connected before Teams was supported, so its permission does not
            cover chats yet.
          </p>
          <button
            className="btn-primary mt-2 py-1 text-[12px]"
            onClick={async () => {
              setBusy(true);
              const err = await reconnectMail("outlook");
              if (err) { setNote(err); setBusy(false); }
            }}
            disabled={busy}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Reconnect for Teams
          </button>
        </>
      ) : (
        <>
          {ms.account_email && (
            <p className="mb-2 truncate text-[12px] text-muted" title={ms.account_email}>
              Signed in as <span className="text-text">{ms.account_email}</span>
            </p>
          )}
          <button className="btn-ghost border border-border py-1 text-[12px]" onClick={sync} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync chats
          </button>
        </>
      )}
      {note && <p className="mt-2 text-[12px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

/**
 * Discord: a server-level bot, like Slack, so there is nothing per-person to
 * authorise and nothing this card can connect on its own.
 *
 * It shows the two states that are actually distinguishable and actionable: no
 * token on the server at all, and a token whose bot has not been let into
 * anything. They look identical from the outside ("no messages") and have
 * completely different fixes, which is exactly why they are separated here.
 */
function DiscordControls() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["discord-channels"],
    queryFn: listDiscordChannels,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <p className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[12px] text-faint">
        <Loader2 size={12} className="animate-spin" /> Checking connection…
      </p>
    );
  }

  async function sync() {
    setBusy(true);
    setNote("");
    const r = await syncDiscord();
    /* The hint is the interesting one: every message empty means the Message
       Content intent is off, which is a switch in the Developer Portal and not
       anything visible in the server's permissions. */
    setNote(
      !r.ok ? (r.detail ?? "Sync failed")
        : r.hint ? r.hint
        : r.synced ? `Pulled ${r.synced} message${r.synced === 1 ? "" : "s"} from #${(r.channel_names ?? []).join(", #")}.`
        : "Nothing new to pull.",
    );
    if (r.ok) qc.invalidateQueries({ queryKey: ["messages"] });
    void refetch();
    setBusy(false);
  }

  const readable = (data?.channels ?? []).filter((c) => c.can_read);

  return (
    <div className="mt-3 border-t border-border pt-3">
      {!data?.configured ? (
        <p className="text-[12px] leading-relaxed text-muted">
          No bot token on the server yet. Create a Discord application, copy its bot token, and store it
          as <span className="mono text-text">DISCORD_BOT_TOKEN</span> in Supabase.
        </p>
      ) : (
        <>
          {data.bot && (
            <p className="mb-2 truncate text-[12px] text-muted">
              Bot <span className="text-text">{data.bot}</span> in {data.guilds} server{data.guilds === 1 ? "" : "s"}
            </p>
          )}
          {data.channels.length > 0 && (
            <ul className="mb-2 space-y-1">
              {data.channels.slice(0, 6).map((c) => (
                <li key={c.id} className="text-[12.5px]">
                  <div className="flex items-center gap-1.5">
                    <Hash size={11} className="shrink-0 text-faint" />
                    <span className="min-w-0 truncate font-medium">{c.name}</span>
                  </div>
                  {/* Read and post stated separately, as for Slack, because in
                      Discord they are separate permissions and a channel
                      routinely has one without the other. */}
                  <div className="ml-[18px] flex flex-wrap gap-x-2 text-[11px]">
                    <span className={c.can_post ? "text-emerald-400" : "text-faint"}>
                      {c.can_post ? "can post" : "cannot post"}
                    </span>
                    <span className={c.can_read ? "text-emerald-400" : "text-amber-400"}>
                      {c.can_read ? "can read" : "no history access"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.error && <p className="mb-2 text-[12px] text-amber-300">{data.error}</p>}
          {readable.length === 0 && data.configured && !data.error && (
            <p className="mb-2 text-[12px] leading-relaxed text-muted">
              The bot cannot read any channel yet. Give its role Read Message History where you want
              messages pulled from.
            </p>
          )}
          <button className="btn-ghost border border-border py-1 text-[12px]" onClick={sync} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync Discord
          </button>
        </>
      )}
      {note && <p className="mt-2 text-[12px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

/**
 * Instagram and WhatsApp, which share a Meta app and therefore a status call.
 *
 * BOTH ARE SERVER-CONFIGURED, like Slack and Discord: a business account is not
 * something each EA connects for themselves. So neither card has a Connect
 * button, and what they show instead is what Meta says is actually reachable,
 * because "configured" computed from a non-empty environment variable is a
 * check that passes with a typo in it.
 *
 * WHATSAPP HAS NO SYNC BUTTON AND WILL NOT GET ONE. The Cloud API has no
 * endpoint for past messages: inbound exists only as a webhook delivery. A
 * button that appeared to fetch WhatsApp history would be a lie about the API,
 * so the card reports whether the webhook is wired instead.
 */
function MetaControls({ which }: { which: "instagram" | "whatsapp" }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["meta-status"],
    queryFn: metaStatus,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <p className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[12px] text-faint">
        <Loader2 size={12} className="animate-spin" /> Checking connection…
      </p>
    );
  }

  const ig = data?.instagram;
  const wa = data?.whatsapp;
  const state = which === "instagram" ? ig : wa;

  async function sync() {
    setBusy(true);
    setNote("");
    const r = await syncInstagram();
    setNote(
      !r.ok ? (r.detail ?? "Sync failed")
        : r.synced ? `Pulled ${r.synced} message${r.synced === 1 ? "" : "s"} from ${r.threads ?? 0} thread${r.threads === 1 ? "" : "s"}.`
        : "Nothing new to pull.",
    );
    if (r.ok) qc.invalidateQueries({ queryKey: ["messages"] });
    setBusy(false);
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {!state?.configured ? (
        <p className="text-[12px] leading-relaxed text-muted">
          {which === "instagram"
            ? "No Meta credentials on the server yet. Set META_PAGE_ID and META_PAGE_ACCESS_TOKEN in Supabase."
            : "No WhatsApp credentials on the server yet. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN in Supabase."}
        </p>
      ) : which === "instagram" ? (
        <>
          {ig?.username && (
            <p className="mb-2 truncate text-[12px] text-muted">
              <span className="text-text">@{ig.username}</span>
              {ig.page && <span className="text-faint"> · {ig.page}</span>}
            </p>
          )}
          {ig?.linked === false && (
            <p className="mb-2 text-[12px] leading-relaxed text-amber-300">
              This Page has no Instagram Professional account linked to it, so no DM can be read or sent.
            </p>
          )}
          <button className="btn-ghost border border-border py-1 text-[12px]" onClick={sync} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync DMs
          </button>
        </>
      ) : (
        <>
          {wa?.number && (
            <p className="mb-2 truncate text-[12px] text-muted">
              <span className="text-text">{wa.number}</span>
              {wa.name && <span className="text-faint"> · {wa.name}</span>}
            </p>
          )}
          {/* The two that decide whether anything ever arrives. A WhatsApp
              integration with a working token and no webhook looks perfectly
              healthy and receives nothing, for ever. */}
          <ul className="space-y-1 text-[12px]">
            <li className={wa?.webhook_secret_set ? "text-emerald-400" : "text-amber-400"}>
              {wa?.webhook_secret_set ? "Webhook token set" : "META_VERIFY_TOKEN not set: the webhook cannot subscribe"}
            </li>
            <li className={wa?.signature_check ? "text-emerald-400" : "text-amber-400"}>
              {wa?.signature_check ? "Signature checking on" : "META_APP_SECRET not set: inbound messages are refused"}
            </li>
          </ul>
          <p className="mt-2 text-[12px] leading-relaxed text-faint">
            There is no sync for WhatsApp. Meta delivers each message once, by webhook, and keeps no
            history to fetch.
          </p>
        </>
      )}
      {state?.error && <p className="mt-2 text-[12px] leading-relaxed text-amber-300">{state.error}</p>}
      {note && <p className="mt-2 text-[12px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

/** The live channel list, shown only for Slack because only Slack has one. */
function SlackChannelList() {
  const { data, isLoading } = useQuery({
    queryKey: ["slack-channels"],
    queryFn: listSlackChannels,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-faint">
        <Loader2 size={12} className="animate-spin" /> Loading channels…
      </p>
    );
  }
  if (!data?.ok || data.channels.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="field-label">Channels in this workspace</p>
      <ul className="mt-1.5 space-y-1">
        {data.channels.map((c) => (
          /* Name on its own line, capabilities beneath it. Side by side these
             competed for about 200px in a four-across card and the channel
             name lost, which is the one part you cannot guess: "all-ma…" and
             "new-c…" are not names anyone can act on. */
          <li key={c.id} className="text-[12.5px]">
            <div className="flex items-center gap-1.5">
              {c.is_private ? (
                <Lock size={11} className="shrink-0 text-faint" />
              ) : (
                <Hash size={11} className="shrink-0 text-faint" />
              )}
              <span className="min-w-0 truncate font-medium">{c.name}</span>
            </div>
            {/* Read and post stated separately, because they genuinely differ:
                a public channel is postable without an invite and never
                readable without one. One combined badge would be wrong for
                every channel the bot has not joined. */}
            <div className="ml-[18px] flex flex-wrap gap-x-2 text-[11px]">
              <span className={c.can_post ? "text-emerald-400" : "text-faint"}>
                {c.can_post ? "can post" : "cannot post"}
              </span>
              <span className={c.can_read ? "text-emerald-400" : "text-amber-400"}>
                {c.can_read ? "can read" : "not joined, cannot read"}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {data.joined === 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          The bot has joined nothing yet, so nothing can be pulled in. Run{" "}
          <span className="mono text-text">/invite @MadeEA OS</span> in each channel you want to read.
        </p>
      )}
    </div>
  );
}

export function ChannelConnections() {
  const { data: mail } = useMailConnections();

  /* The catalogue says what the PRODUCT supports; the credential row says what
     YOU have. For a mailbox those are different questions, and showing the
     first while the person is asking the second is how a card ends up saying
     "Connected" to somebody who has connected nothing. */
  const liveStatus = (c: Channel): ChannelStatus | null => {
    const provider = MAIL_PROVIDER[c.id];
    if (provider) {
      if (!mail) return null;   // still loading: say so rather than guess
      return mail[provider].connected ? "connected" : "not_connected";
    }
    /* Teams shares the Microsoft connection, so its state is a question about
       the granted scopes rather than about a row of its own. */
    if (c.id === "teams") {
      if (!mail) return null;
      return mail.outlook.connected && mail.outlook.scopes?.includes(TEAMS_SCOPE) ? "connected" : "not_connected";
    }
    /* Discord and Slack are workspace-level bots: the catalogue's "connected"
       means the integration exists, and the card below says whether the bot has
       actually been let into anything. Asking discord-channels here too would
       be a second request for an answer that card already renders. */
    return c.status;
  };

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Message channels</h2>
        <p className="text-xs text-faint">Where clients can reach you</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {REAL_CHANNELS.map((c) => (
          <div
            key={c.id}
            className={cn(
              "card flex flex-col p-4",
              // Unavailable channels are dimmed but never hidden. Hiding
              // WhatsApp is why somebody asks every week whether we support it.
              c.status === "planned" && "opacity-70",
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                <c.icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">{c.label}</h3>
              </div>
            </div>

            <div className="mt-2">
              <StatusPill status={liveStatus(c)} />
            </div>

            {c.note && <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">{c.note}</p>}

            {c.requires && c.requires.length > 0 && (
              <div className="mt-3">
                <p className="field-label">
                  {c.status === "connected" ? "Ongoing" : "What this needs"}
                </p>
                <ul className="mt-1 space-y-1">
                  {c.requires.map((r) => (
                    <li key={r} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
                      <Check size={11} className="mt-1 shrink-0 text-faint" />
                      <span className="min-w-0 break-words">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {c.id === "slack" && <SlackChannelList />}
            {MAIL_PROVIDER[c.id] && <MailControls provider={MAIL_PROVIDER[c.id]!} />}
            {c.id === "teams" && <TeamsControls />}
            {c.id === "discord" && <DiscordControls />}
            {(c.id === "instagram" || c.id === "whatsapp") && <MetaControls which={c.id} />}
          </div>
        ))}
      </div>
    </section>
  );
}
