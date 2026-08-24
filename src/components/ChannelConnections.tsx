import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Hash, Lock, Link2, SlidersHorizontal, RefreshCw, MoreVertical, Ban } from "lucide-react";
import { REAL_CHANNELS, type Channel, type ChannelId } from "@/lib/channels";
import { listSlackChannels, syncSlack } from "@/lib/slack";
import { useMailConnections, useMyEmail } from "@/data/hooks";
import { listDiscordChannels, syncDiscord } from "@/lib/discord";
import { metaStatus, syncInstagram } from "@/lib/meta";
import { reconnectMail } from "@/hooks/useSendEmail";
import { supabase } from "@/lib/supabase";
import type { MailProvider } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * Every message channel and its real state, in one place.
 *
 * WHY THIS EXISTS. "Which channels are connected" was answerable only by
 * opening the Inbox, choosing each channel, and reading a note beside it. Three
 * steps to learn something that should be a glance, and it is the first
 * question anyone asks when a client says they messaged us somewhere.
 *
 * ── THE CARD SHAPE, AND WHY EVERY CARD HAS THE SAME ONE ──────────────────
 *
 * Logo, name, the connected account under it, one line of what the channel is
 * for, and a single button that reads Connect or Manage. That is the shape
 * every CRM uses for this screen, and it is worth copying for a reason that is
 * not fashion: the question people bring here is "which of these am I on", and
 * a grid answers that in one pass only if the cards are identical enough to
 * compare at a glance.
 *
 * An earlier version made each card argue its own case, with a status pill, a
 * checklist of requirements and a different control per channel. Every word of
 * that was true and the grid was unreadable: nine cards of different heights,
 * each demanding to be read before it could be compared.
 *
 * WHAT THAT UNIFORMITY MUST NOT COST. The honest answer per channel is still
 * wildly different. Gmail is an OAuth click; Slack was a scope and a reinstall;
 * WhatsApp is a Meta Business review measured in days. So the differences moved
 * behind Manage rather than being flattened away: the front of the card is
 * uniform, and pressing it shows what this particular channel actually needs.
 * Nobody is told that connecting WhatsApp is the same job as connecting Gmail.
 *
 * WHAT IS DELIBERATELY NOT ON THIS GRID. Every service the product does not
 * integrate with. A grid of Connect buttons is an implicit promise that they
 * work, and a card for something unbuilt is a support ticket waiting to happen.
 * LinkedIn is the single exception, and it is here to say it is impossible
 * rather than to imply it is queued.
 */

/* Which channels are a mailbox, and where that credential lives. */
const MAIL_PROVIDER: Partial<Record<ChannelId, MailProvider>> = { gmail: "gmail", outlook: "outlook" };
const CREDENTIAL_TABLE: Record<MailProvider, string> = {
  gmail: "google_credentials",
  outlook: "microsoft_credentials",
};
const TEAMS_SCOPE = "Chat.Read";

/**
 * What each card says it is for.
 *
 * One sentence, in the words the rest of the industry uses for the same
 * integration, because these cards are read by people who have connected the
 * same services in a CRM before and are looking for the thing they recognise.
 * Where our answer genuinely differs from the familiar one (Outlook not needing
 * to match your login; LinkedIn having no API at all) the sentence says so
 * instead of borrowing a promise we cannot keep.
 */
const BLURB: Record<ChannelId, string> = {
  all: "",
  gmail:
    "Connect your Google account to sync Gmail into your inbox and your events into the calendar, and reply without leaving MadeEA.",
  outlook:
    "Connect your Microsoft account to sync Outlook mail and reply in the original thread. It does not have to match your MadeEA login.",
  teams:
    "Sync your one-to-one and group chats and reply to them from here. Uses the same Microsoft sign-in as Outlook.",
  slack:
    "Pull messages from the channels your bot has been invited to, and post back to them without switching apps.",
  discord:
    "Sync messages from your server's channels and reply to them from MadeEA, the same way Slack works.",
  instagram:
    "Sync messages and set up automations to efficiently manage and engage with potential leads.",
  whatsapp:
    "Connect to get leads from your LinkedIn lead generation ads into your CRM",
  linkedin:
    "LinkedIn publishes no public messaging API. Access needs Partner Program approval, which is invite-only, so this may never be connectable.",
};

/** State of one channel, as far as the browser can see it. */
interface ChannelState {
  connected: boolean;
  /** Shown under the name: the account this is connected AS. */
  account: string | null;
  loading: boolean;
  /** True when connecting is an OAuth click here rather than a server secret. */
  selfServe: boolean;
  /** Nothing to connect, ever. */
  unavailable?: boolean;
}

/**
 * Every channel's state, gathered once.
 *
 * One place rather than a query per card, because four of these cards read the
 * same two answers and a card that fetches its own would mean four loading
 * spinners settling at four different moments in a grid whose whole job is to
 * be compared at a glance.
 */
function useChannelStates(): Record<ChannelId, ChannelState> {
  const { data: mail } = useMailConnections();
  const myEmail = useMyEmail();
  const { data: slack } = useQuery({ queryKey: ["slack-channels"], queryFn: listSlackChannels, staleTime: 60_000 });
  const { data: discord } = useQuery({ queryKey: ["discord-channels"], queryFn: listDiscordChannels, staleTime: 60_000 });
  const { data: meta } = useQuery({ queryKey: ["meta-status"], queryFn: metaStatus, staleTime: 60_000 });

  const ms = mail?.outlook;
  const base = (over: Partial<ChannelState>): ChannelState =>
    ({ connected: false, account: null, loading: false, selfServe: false, ...over });

  return {
    all: base({}),
    gmail: base({
      connected: Boolean(mail?.gmail.connected),
      account: mail?.gmail.connected ? myEmail : null,
      loading: !mail,
      selfServe: true,
    }),
    outlook: base({
      connected: Boolean(ms?.connected),
      account: ms?.account_email ?? null,
      loading: !mail,
      selfServe: true,
    }),
    teams: base({
      /* Teams is not a connection of its own: it rides on the Microsoft
         consent, so "connected" is a question about the granted scopes. An
         account authorised before Teams shipped reads as not connected here,
         which is the true answer, and Manage explains that it is one reconnect
         rather than a new sign-in. */
      connected: Boolean(ms?.connected && ms.scopes?.includes(TEAMS_SCOPE)),
      account: ms?.connected ? ms.account_email : null,
      loading: !mail,
      selfServe: true,
    }),
    slack: base({
      connected: Boolean(slack?.ok),
      account: slack?.joined ? `${slack.joined} channel${slack.joined === 1 ? "" : "s"} joined` : null,
      loading: !slack,
    }),
    discord: base({
      connected: Boolean(discord?.configured && discord.ok),
      account: discord?.bot ? `${discord.bot} · ${discord.guilds} server${discord.guilds === 1 ? "" : "s"}` : null,
      loading: !discord,
    }),
    instagram: base({
      connected: Boolean(meta?.instagram.configured && meta.instagram.linked),
      account: meta?.instagram.username ? `@${meta.instagram.username}` : null,
      loading: !meta,
    }),
    whatsapp: base({
      connected: Boolean(meta?.whatsapp.configured),
      account: meta?.whatsapp.number ?? null,
      loading: !meta,
    }),
    linkedin: base({ unavailable: true }),
  };
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
      <p className="flex items-center gap-2 text-xs text-faint">
        <Loader2 size={12} className="animate-spin" /> Loading channels…
      </p>
    );
  }
  if (!data?.ok || data.channels.length === 0) return null;

  return (
    <div>
      <p className="field-label">Channels in this workspace</p>
      <ul className="mt-1.5 space-y-1">
        {data.channels.map((c) => (
          /* Name on its own line, capabilities beneath it. Side by side these
             competed for about 200px in a four-across card and the channel
             name lost, which is the one part you cannot guess. */
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
                readable without one. */}
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

/** Discord's equivalent, with the same read/post honesty. */
function DiscordChannelList() {
  const { data } = useQuery({ queryKey: ["discord-channels"], queryFn: listDiscordChannels, staleTime: 60_000 });
  if (!data?.configured || data.channels.length === 0) return null;

  const readable = data.channels.filter((c) => c.can_read);
  return (
    <div>
      <p className="field-label">Channels the bot can see</p>
      <ul className="mt-1.5 space-y-1">
        {data.channels.slice(0, 6).map((c) => (
          <li key={c.id} className="text-[12.5px]">
            <div className="flex items-center gap-1.5">
              <Hash size={11} className="shrink-0 text-faint" />
              <span className="min-w-0 truncate font-medium">{c.name}</span>
            </div>
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
      {readable.length === 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          The bot cannot read any channel yet. Give its role Read Message History where you want messages
          pulled from.
        </p>
      )}
    </div>
  );
}

/**
 * What Manage opens: the part that is genuinely different per channel.
 *
 * Sync, disconnect, the channel lists, and for the server-configured ones the
 * setup that has to happen outside this app. Kept behind the button so the grid
 * stays comparable, and kept honest so that opening it never says "press
 * Connect" about something that needs a Meta business review.
 */
function ManagePanel({ channel, state }: { channel: Channel; state: ChannelState }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const provider = MAIL_PROVIDER[channel.id];

  /** The sync each channel has, or null where there is nothing to pull. */
  async function sync() {
    setBusy(true);
    setNote("");
    try {
      if (channel.id === "slack") {
        const r = await syncSlack();
        setNote(r.ok ? `Pulled ${r.synced ?? 0} message${r.synced === 1 ? "" : "s"}.` : (r.detail ?? "Sync failed"));
      } else if (channel.id === "discord") {
        const r = await syncDiscord();
        setNote(!r.ok ? (r.detail ?? "Sync failed") : r.hint ? r.hint : `Pulled ${r.synced ?? 0} message${r.synced === 1 ? "" : "s"}.`);
      } else if (channel.id === "instagram") {
        const r = await syncInstagram();
        setNote(r.ok ? `Pulled ${r.synced ?? 0} message${r.synced === 1 ? "" : "s"}.` : (r.detail ?? "Sync failed"));
      } else if (supabase) {
        const fn = channel.id === "teams" ? "teams-sync" : provider === "outlook" ? "outlook-sync" : "gmail-sync";
        const { data, error } = await supabase.functions.invoke(fn);
        /* The reason lives in the function's JSON body, which the SDK hides
           behind error.context. error.message alone is always "Edge Function
           returned a non-2xx status code", which tells nobody anything. */
        let payload = (data ?? null) as { synced?: number; error?: string } | null;
        if (error) {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.text === "function") {
            try { payload = JSON.parse(await ctx.text()); } catch { payload = null; }
          }
        }
        setNote(
          error || payload?.error
            ? (payload?.error ?? error?.message ?? "Sync failed")
            : `Pulled ${payload?.synced ?? 0} message${payload?.synced === 1 ? "" : "s"}.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["messages"] });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!supabase || !provider) return;
    /* Confirmed, and the Google warning is not boilerplate: one consent covers
       mail AND calendar, so disconnecting here stops the Dashboard's events
       too. Somebody who only meant to stop mail deserves to know that before
       they press it, not after the calendar empties. */
    const warning =
      provider === "gmail"
        ? "Disconnect Google? This stops Gmail sync AND your calendar events, and you will need to sign in again to reconnect."
        : "Disconnect Microsoft? Outlook mail and Teams chats both stop syncing until you reconnect.";
    if (!window.confirm(warning)) return;

    setBusy(true);
    try {
      /* RLS scopes the delete to your own row (0016 for Google, 0048 for
         Microsoft), so the filter is only here because the client requires
         one: it cannot reach anybody else's credentials whatever it sends. */
      const { error } = await supabase
        .from(CREDENTIAL_TABLE[provider])
        .delete()
        .neq("owner_id", "00000000-0000-0000-0000-000000000000");
      setNote(
        error
          ? error.message
          : provider === "gmail"
            ? "Google disconnected. Gmail and calendar sync have stopped."
            : "Microsoft disconnected. Outlook and Teams have stopped.",
      );
      qc.invalidateQueries({ queryKey: ["mail-connections"] });
    } finally {
      setBusy(false);
    }
  }

  const canSync = state.connected && channel.id !== "whatsapp";

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {/* Teams before anything else: its commonest state is connected-to-
          Microsoft-but-not-for-chats, and the fix is a reconnect rather than
          anything on this panel. */}
      {channel.id === "teams" && !state.connected && (
        <div>
          <p className="text-[12px] leading-relaxed text-muted">
            {state.account
              ? "This Microsoft account was connected before Teams was supported, so its permission does not cover chats yet. One reconnect adds them."
              : "Connect Microsoft on the Outlook card. Teams uses the same sign-in, so it switches on with it."}
          </p>
          {state.account && (
            <button
              className="btn-primary mt-2 py-1 text-[12px]"
              onClick={() => void reconnectMail("outlook")}
            >
              Reconnect for Teams
            </button>
          )}
        </div>
      )}

      {channel.id === "slack" && <SlackChannelList />}
      {channel.id === "discord" && <DiscordChannelList />}

      {channel.id === "whatsapp" && state.connected && (
        <p className="text-[12px] leading-relaxed text-faint">
          There is no sync for WhatsApp. Meta delivers each message once, by webhook, and keeps no history
          to fetch, so nothing appears until somebody messages the number.
        </p>
      )}

      {/* What this actually needs, for the channels nobody can switch on from
          a browser. Shown here rather than on the card face, so the grid stays
          comparable and the truth stays one click away. */}
      {!state.connected && channel.requires && channel.requires.length > 0 && (
        <div>
          <p className="field-label">What this needs</p>
          <ul className="mt-1 space-y-1">
            {channel.requires.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
                <Check size={11} className="mt-1 shrink-0 text-faint" />
                <span className="min-w-0 break-words">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(canSync || (state.connected && provider)) && (
        <div className="flex flex-wrap gap-2">
          {canSync && (
            <button className="btn-ghost border border-border py-1 text-[12px]" onClick={sync} disabled={busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync now
            </button>
          )}
          {state.connected && provider && (
            <button className="btn-ghost border border-border py-1 text-[12px]" onClick={disconnect} disabled={busy}>
              Disconnect
            </button>
          )}
        </div>
      )}

      {note && <p className="text-[12px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

/** One card. Same shape for all nine, whatever is behind them. */
function ChannelCard({ channel, state }: { channel: Channel; state: ChannelState }) {
  const [open, setOpen] = useState(false);

  async function primary() {
    /* Connected, or configured elsewhere: the button opens the detail. Only a
       channel you can genuinely authorise from a browser starts a consent
       flow, so nothing here sends somebody to a login screen for an
       integration that actually needs a server secret. */
    if (state.connected || !state.selfServe) { setOpen((v) => !v); return; }
    const target: MailProvider = channel.id === "gmail" ? "gmail" : "outlook";
    const err = await reconnectMail(target);
    if (err) setOpen(true);   // the panel is where the reason belongs
  }

  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
          <channel.icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{channel.label}</h3>
          {/* The account, directly under the name. "Connected" without saying
              connected as WHAT is the half-answer this grid exists to stop. */}
          {state.account && (
            <p className="truncate text-[11px] text-faint" title={state.account}>
              {state.account}
            </p>
          )}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={`${channel.label} options`}
          aria-expanded={open}
          className="-mr-1 shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
        >
          <MoreVertical size={15} />
        </button>
      </div>

      <p className="mt-2.5 flex-1 text-[12.5px] leading-relaxed text-muted">{BLURB[channel.id]}</p>

      <button
        onClick={primary}
        disabled={state.unavailable || state.loading}
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-[12.5px] font-medium transition-colors",
          state.unavailable
            ? "cursor-not-allowed border-border text-faint"
            : state.connected
              ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              : "border-accent/50 text-accent-soft hover:bg-accent/10",
        )}
      >
        {state.loading ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Checking…
          </>
        ) : state.unavailable ? (
          <>
            <Ban size={14} /> Not available
          </>
        ) : state.connected ? (
          <>
            <SlidersHorizontal size={14} /> Manage
          </>
        ) : (
          <>
            <Link2 size={14} /> Connect
          </>
        )}
      </button>

      {open && <ManagePanel channel={channel} state={state} />}
    </div>
  );
}

export function ChannelConnections() {
  const states = useChannelStates();

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Message channels</h2>
        <p className="text-xs text-faint">Where clients can reach you</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {REAL_CHANNELS.map((c) => (
          <ChannelCard key={c.id} channel={c} state={states[c.id]} />
        ))}
      </div>
    </section>
  );
}
