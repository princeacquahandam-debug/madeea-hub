import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Link2, SlidersHorizontal, MoreVertical, RefreshCw, Unplug } from "lucide-react";
import { REAL_CHANNELS, type Channel, type ChannelId } from "@/lib/channels";
import { syncSlack } from "@/lib/slack";
import { useMailConnections, useMyEmail, useMyIntegrations } from "@/data/hooks";
import { syncDiscord } from "@/lib/discord";
import { syncInstagram } from "@/lib/meta";
import { type ConnectProvider } from "@/lib/connect";
import { IntegrationDialog } from "@/components/IntegrationDialog";
import type { Integration } from "@/types/db";
import { supabase } from "@/lib/supabase";
import type { MailProvider } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * Every message channel, and one way to connect each of them: sign in.
 *
 * ── WHAT THE CARD IS, AND WHAT IT IS NOT ─────────────────────────────────
 *
 * Logo, name, the account it is connected AS, one line of what the channel is
 * for, and a button. Nothing else. An earlier version put the setup underneath:
 * which scopes were needed, which channels the bot could read, which secret to
 * paste into Supabase. Every word was true and the grid was unusable — nine
 * cards of nine different heights, each demanding to be read before it could be
 * compared, when the question people arrive with is simply "which of these am I
 * on".
 *
 * The detail did not move somewhere else. It stopped being necessary: pressing
 * Connect signs you in to the provider, and there is nothing left to instruct.
 *
 * ── WHY A LOGIN AND NOT AN API KEY ───────────────────────────────────────
 *
 * Slack, Discord and Meta were configured by pasting a bot token or a Page
 * token into the Supabase dashboard. That works, and it is the wrong shape:
 * only whoever holds the dashboard can connect anything, the token travels
 * through a chat window to get there, rotating it is a deploy, and a card can
 * never say WHICH workspace it is attached to, because a secret is an opaque
 * string.
 *
 * All of them publish an install flow. Signing in does the same job and does it
 * better: the person authorising owns the account, the token arrives over TLS,
 * it carries the names of what was authorised, and revoking is a click on their
 * side rather than a deploy on ours.
 *
 * The one thing still in Supabase secrets is MadeEA's own app id and secret per
 * provider. That is this application's identity, registered once, and it is not
 * anybody's account credential.
 */

/* Which channels are a personal mailbox, and where that credential lives. */
const MAIL_PROVIDER: Partial<Record<ChannelId, MailProvider>> = { gmail: "gmail", outlook: "outlook" };
const CREDENTIAL_TABLE: Record<MailProvider, string> = {
  gmail: "google_credentials",
  outlook: "microsoft_credentials",
};
const TEAMS_SCOPE = "Chat.Read";

/** Which login each card starts. Instagram and WhatsApp share Meta's. */
const CONNECT_AS: Record<ChannelId, ConnectProvider | null> = {
  all: null,
  gmail: "google",
  outlook: "microsoft",
  teams: "microsoft",
  slack: "slack",
  discord: "discord",
  instagram: "meta",
  whatsapp: "meta",
  linkedin: "linkedin",
};

/**
 * What each card says it is for. One sentence, in the words the rest of the
 * industry uses for the same integration, because these cards are read by
 * people who have connected the same services elsewhere and are looking for
 * the thing they recognise.
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
    "Integrate WhatsApp to connect with over 2 billion customers on their favourite messaging app, and accelerate your business growth.",
  linkedin:
    "Connect to get leads from your LinkedIn lead generation ads into your CRM",
};

/**
 * What the card writes under the name.
 *
 * The default account, and how many others there are. A card that named only
 * the first of three would be quietly wrong about a workspace with a client
 * account connected beside the agency's.
 */
function accountLabel(rows: Integration[] | undefined): string | null {
  if (!rows?.length) return null;
  const first = rows[0].provider_email ?? rows[0].provider_account_name ?? "Connected";
  return rows.length > 1 ? `${first} +${rows.length - 1} more` : first;
}

/** A connection that needs signing in again, rather than one that is simply absent. */
const needsReauth = (rows: Integration[] | undefined) =>
  Boolean(rows?.length) && rows!.every((r) => r.status === "reauth_required" || r.status === "error");

interface ChannelState {
  connected: boolean;
  /** Shown under the name: the account this is connected AS. */
  account: string | null;
  loading: boolean;
}

/**
 * Every channel's state, gathered once.
 *
 * One place rather than a query per card: several of these read the same two
 * answers, and a card that fetched its own would put four spinners in a grid
 * whose whole job is to be compared at a glance.
 */
function useChannelStates(): Record<ChannelId, ChannelState> {
  const { data: mail } = useMailConnections();
  const { data: installs } = useMyIntegrations();
  const myEmail = useMyEmail();

  const ms = mail?.outlook;
  /* MY Meta connection, not the workspace's: RLS returns only rows whose
     user_id is me, so a colleague's Instagram is not visible here and cannot
     be. */
  const meta = installs?.meta?.[0];
  const base = (over: Partial<ChannelState>): ChannelState =>
    ({ connected: false, account: null, loading: false, ...over });

  return {
    all: base({}),
    gmail: base({
      connected: Boolean(mail?.gmail.connected),
      account: mail?.gmail.connected ? myEmail : null,
      loading: !mail,
    }),
    outlook: base({
      connected: Boolean(ms?.connected),
      account: ms?.account_email ?? null,
      loading: !mail,
    }),
    teams: base({
      /* Teams is not a connection of its own: it rides on the Microsoft
         consent, so "connected" is a question about the granted scopes. An
         account authorised before Teams shipped reads as not connected, which
         is true, and pressing Connect re-runs the same sign-in to add them. */
      connected: Boolean(ms?.connected && ms.scopes?.includes(TEAMS_SCOPE)),
      account: ms?.connected ? ms.account_email : null,
      loading: !mail,
    }),
    slack: base({
      connected: Boolean(installs?.slack?.length),
      account: accountLabel(installs?.slack),
      loading: !installs,
    }),
    discord: base({
      connected: Boolean(installs?.discord?.length),
      account: accountLabel(installs?.discord),
      loading: !installs,
    }),
    instagram: base({
      /* One Meta login covers both, but it does not switch both on: a business
         with a Page and no Instagram account attached connects fine and has no
         Instagram. The card reflects what actually came back. */
      connected: Boolean(meta?.metadata?.ig_id),
      account: meta?.metadata?.ig_username ? `@${meta.metadata.ig_username}` : null,
      loading: !installs,
    }),
    whatsapp: base({
      connected: Boolean(meta?.metadata?.whatsapp_phone_number_id),
      account: meta?.metadata?.whatsapp_number ?? null,
      loading: !installs,
    }),
    linkedin: base({
      connected: Boolean(installs?.linkedin?.length),
      account: accountLabel(installs?.linkedin),
      loading: !installs,
    }),
  };
}

/**
 * The menu behind ⋮: sync now, and disconnect.
 *
 * Only ever the two things you can do to a connection that already exists.
 * Setup instructions are not here, because after an install flow there are
 * none.
 */
function CardMenu({ channel, state, onNote }: {
  channel: Channel;
  state: ChannelState;
  onNote: (s: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const provider = MAIL_PROVIDER[channel.id];

  async function sync() {
    setBusy(true);
    try {
      if (channel.id === "slack") {
        const r = await syncSlack();
        onNote(r.ok ? `Pulled ${r.synced ?? 0} message${r.synced === 1 ? "" : "s"}.` : (r.detail ?? "Sync failed"));
      } else if (channel.id === "discord") {
        const r = await syncDiscord();
        onNote(!r.ok ? (r.detail ?? "Sync failed") : (r.hint ?? `Pulled ${r.synced ?? 0} message${r.synced === 1 ? "" : "s"}.`));
      } else if (channel.id === "instagram") {
        const r = await syncInstagram();
        onNote(r.ok ? `Pulled ${r.synced ?? 0} message${r.synced === 1 ? "" : "s"}.` : (r.detail ?? "Sync failed"));
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
        onNote(
          error || payload?.error
            ? (payload?.error ?? "Sync failed")
            : `Pulled ${payload?.synced ?? 0} message${payload?.synced === 1 ? "" : "s"}.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["messages"] });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    /* Confirmed, and the warnings are not boilerplate. One Google consent
       covers mail AND calendar; one Microsoft consent covers Outlook AND
       Teams; one Meta login covers Instagram AND WhatsApp. Somebody who meant
       to detach half of a pair deserves to know before pressing it, not after
       the other half goes quiet. */
    const warning =
      channel.id === "gmail"
        ? "Disconnect Google? Gmail sync AND your calendar events stop until you sign in again."
        : channel.id === "outlook" || channel.id === "teams"
          ? "Disconnect Microsoft? Outlook mail AND Teams chats stop until you sign in again."
          : channel.id === "instagram" || channel.id === "whatsapp"
            ? "Disconnect this Meta account? Instagram AND WhatsApp stop until you sign in again."
            : `Disconnect ${channel.label}?`;
    if (!window.confirm(warning)) return;

    setBusy(true);
    try {
      if (provider && supabase) {
        /* RLS scopes the delete to your own row (0016 for Google, 0048 for
           Microsoft), so the filter is only here because the client demands
           one: it cannot reach anybody else's credentials whatever it sends. */
        const { error } = await supabase
          .from(CREDENTIAL_TABLE[provider])
          .delete()
          .neq("owner_id", "00000000-0000-0000-0000-000000000000");
        onNote(error ? error.message : `${channel.label} disconnected.`);
        qc.invalidateQueries({ queryKey: ["mail-connections"] });
      } else {
        /* Shared channels can hold several accounts, so "disconnect" is not a
           single answer any more. The dialog lists them and detaches one. */
        onNote("Open Manage to choose which account to disconnect.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute right-2 top-11 z-20 w-44 overflow-hidden rounded-lg border border-border bg-surface-2 py-1 shadow-xl">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-muted hover:bg-[var(--chip-bg)] hover:text-text disabled:opacity-40"
        onClick={sync}
        disabled={busy || !state.connected || channel.id === "whatsapp"}
        /* WhatsApp has no sync and cannot have one: Meta keeps no history to
           fetch, so inbound exists only as a webhook delivery. */
        title={channel.id === "whatsapp" ? "WhatsApp has no history to pull; messages arrive by webhook" : undefined}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync now
      </button>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-muted hover:bg-[var(--chip-bg)] hover:text-red-400 disabled:opacity-40"
        onClick={disconnect}
        disabled={busy || !state.connected}
      >
        <Unplug size={13} /> Disconnect
      </button>
    </div>
  );
}

/** One card. The same five things, whatever is behind them. */
function ChannelCard({ channel, state, accounts }: {
  channel: Channel;
  state: ChannelState;
  accounts: Integration[];
}) {
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const target = CONNECT_AS[channel.id];

  return (
    <div className="card relative flex flex-col p-4">
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
          <channel.icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{channel.label}</h3>
          {/* The account, directly under the name. "Connected" without saying
              connected to WHAT is the half-answer this grid exists to stop. */}
          {state.account && (
            <p className="truncate text-[11px] text-faint" title={state.account}>
              {state.account}
            </p>
          )}
        </div>
        <button
          onClick={() => setMenu((v) => !v)}
          aria-label={`${channel.label} options`}
          aria-expanded={menu}
          className="-mr-1 shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
        >
          <MoreVertical size={15} />
        </button>
      </div>

      <p className="mt-2.5 flex-1 text-[12.5px] leading-relaxed text-muted">{BLURB[channel.id]}</p>

      {/* Both states open the same dialog. Connect and Manage differ in what
          you find inside, not in where they go: pressing Connect on a channel
          somebody else already connected should show you that, not start a
          second sign-in. */}
      <button
        onClick={() => setOpen(true)}
        disabled={state.loading || !target}
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-[12.5px] font-medium transition-colors",
          state.connected
            ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            : "border-accent/50 text-accent-soft hover:bg-accent/10",
        )}
      >
        {state.loading ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Checking…
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

      {menu && <CardMenu channel={channel} state={state} onNote={(s) => { setNote(s); setMenu(false); }} />}
      {note && <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{note}</p>}

      {open && target && (
        <IntegrationDialog
          channel={channel}
          provider={target}
          accounts={accounts}
          personalAccount={state.account}
          connected={state.connected}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export function ChannelConnections() {
  const states = useChannelStates();
  const { data: installs } = useMyIntegrations();

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Message channels</h2>
        <p className="text-xs text-faint">Where clients can reach you</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {REAL_CHANNELS.map((c) => (
          <ChannelCard
            key={c.id}
            channel={c}
            state={states[c.id]}
            /* Instagram and WhatsApp are two cards over one Meta login, so both
               show the same list. Disconnecting from either takes both, which
               is what the dialog's confirmation says. */
            accounts={installs?.[CONNECT_AS[c.id] ?? ""] ?? []}
          />
        ))}
      </div>
    </section>
  );
}
