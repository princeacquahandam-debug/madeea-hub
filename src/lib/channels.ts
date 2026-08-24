import { Inbox } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import {
  SlackMark, GmailMark, WhatsAppMark, DiscordMark,
  InstagramMark, LinkedInMark, TeamsMark, OutlookMark,
} from "@/components/BrandIcons";

/**
 * Every place a client can reach us, declared once.
 *
 * WHY THIS FILE EXISTS. The Inbox started as an email inbox with
 * Slack bolted on the side. WhatsApp and Discord are coming, and a second bolt
 * would have made a third inevitable. So the channel is data, not layout: the
 * rail, the filters, the compose surface and the empty states all read from
 * here. Adding WhatsApp is an entry in this array.
 *
 * `status` is deliberately four states rather than a boolean, because they mean
 * different things to whoever is looking at the screen and each has a different
 * fix:
 *
 *   connected     reads and sends
 *   read_only     messages arrive, we cannot reply from here yet
 *   not_connected wired up, nobody has authorised it
 *   planned       no integration exists at all
 *
 * A `planned` channel is still SHOWN, greyed, with the reason. §9's
 * empty-nav-state: when a destination is unavailable, explain why rather than
 * hiding it. Hiding it means the third person this month asks whether WhatsApp
 * is supported.
 */

export type ChannelId =
  | "all" | "gmail" | "slack"
  | "instagram" | "linkedin" | "whatsapp" | "teams" | "outlook" | "discord";
export type ChannelStatus = "connected" | "read_only" | "not_connected" | "planned";

/* Loose enough to accept both a Lucide glyph and a hand-drawn brand mark, so a
   channel can carry its real logo without the aggregate view needing one. */
export type ChannelIcon = ComponentType<{ size?: string | number; className?: string; style?: CSSProperties }>;

export interface Channel {
  id: ChannelId;
  label: string;
  icon: ChannelIcon;
  /** Matches `messages.source`. Null for the aggregate view. */
  source: string | null;
  status: ChannelStatus;
  /** Which composer this channel opens. Null means it cannot be replied to here. */
  compose: "email" | "message" | null;
  /** Shown when the channel is not fully usable. Names the fix, not the symptom. */
  note?: string;
  /** Brand tint, used only as a supporting cue. Never the sole signal. */
  tint: string;
  /** Where someone goes to change this channel's connection. */
  settingsPath?: string;
  /**
   * What is actually required to switch this on, in order.
   * Kept as data because the honest answer differs a lot per channel: Slack was
   * one scope and a reinstall, WhatsApp is a Meta Business review that takes
   * days. A single "Connect" button implies those are the same job.
   */
  requires?: string[];
}

export const CHANNELS: Channel[] = [
  {
    id: "all",
    label: "All",
    icon: Inbox,
    source: null,
    status: "connected",
    compose: null,
    tint: "var(--accent)",
  },
  {
    id: "gmail",
    label: "Gmail",
    icon: GmailMark,
    source: "gmail",
    status: "connected",
    compose: "email",
    tint: "#EA4335",
    settingsPath: "/integrations",
    requires: ["Sign in with the Google account you send from"],
  },
  {
    id: "slack",
    label: "Slack",
    icon: SlackMark,
    source: "slack",
    status: "connected",
    compose: "message",
    /* Reads and posts. The caveat is not a permission but a membership: Slack
       only exposes a channel's history to a bot that is IN the channel, so an
       uninvited channel looks empty rather than forbidden. Say so here, because
       "no messages" and "not invited" are indistinguishable on screen. */
    note: "Posting works. The bot only reads channels it has been invited to, so run /invite @MadeEA OS in each one you want pulled in.",
    tint: "#4A154B",
    settingsPath: "/integrations",
    requires: ["Invite @MadeEA OS to each channel you want to read"],
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: InstagramMark,
    source: "instagram",
    /* Built, and the only Meta channel with a read API: /{page}/conversations
       lists DM threads, so it syncs like the rest. What it still needs from
       Meta rather than from us is the App Review that turns
       instagram_manage_messages from development-only into live. The card
       reads the real state from meta-status rather than claiming either. */
    status: "connected",
    compose: "message",
    note: "DMs to your Instagram Professional account. Meta only allows a reply within 24 hours of the person's last message (7 days for a human-written one), so a cold outbound DM is not possible from here.",
    tint: "#C837AB",
    settingsPath: "/integrations",
    requires: [
      "An Instagram Professional account linked to a Facebook Page",
      "A Meta app with instagram_manage_messages, and App Review to go live",
      "The Page token stored as META_PAGE_ACCESS_TOKEN",
    ],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: LinkedInMark,
    source: "linkedin",
    status: "planned",
    compose: null,
    /* The one on this list that is not simply unbuilt. LinkedIn publishes no
       general messaging API: reading or sending DMs needs Partner Program
       access, which is invite-only and routinely refused. Recorded plainly
       because "coming later" would imply a queue this is not actually in, and
       somebody would go on waiting for it. */
    note: "LinkedIn publishes no public messaging API. Access needs LinkedIn Partner Program approval, which is invite-only, so this may never be connectable. Treat it as a placeholder, not a queue.",
    tint: "#0A66C2",
    requires: [
      "LinkedIn Partner Program approval (invite-only, often refused)",
      "No supported route exists without it",
    ],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: WhatsAppMark,
    source: "whatsapp",
    /* Built, and genuinely unlike every other channel on this list: the Cloud
       API has NO endpoint for past messages, so there is nothing to sync and
       no Sync button anywhere for it. Messages arrive by webhook or they do
       not arrive. That is why the card reports whether the webhook secret is
       set rather than when it last ran. */
    status: "connected",
    compose: "message",
    note: "Arrives by webhook only: there is no history to pull, so nothing appears until someone messages the number. Replies are freeform for 24 hours after their last message; after that Meta accepts only a pre-approved template.",
    tint: "#25D366",
    settingsPath: "/integrations",
    requires: [
      "A verified Meta Business with a number on the Cloud API",
      "WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN set",
      "The webhook pointed at whatsapp-webhook, with META_VERIFY_TOKEN and META_APP_SECRET",
    ],
  },
  {
    id: "teams",
    label: "Teams",
    icon: TeamsMark,
    source: "teams",
    /* Built, on the same Microsoft sign-in as Outlook. The old note here said
       Graph is "tenant-wide, so an admin has to consent", and that turned out
       to be true of CHANNELS and false of CHATS. Chat.Read is delegated: it
       reads what the signed-in person can already read, with their own
       consent and no admin involved. Channels still need
       ChannelMessage.Read.All and still need an admin, so they are not
       included and are not implied. */
    status: "connected",
    compose: "message",
    note: "Your one-to-one and group chats, on the same Microsoft sign-in as Outlook. Replies post back into the chat. Team channels are not included: those need tenant admin consent, which is a different decision.",
    tint: "#4B53BC",
    settingsPath: "/integrations",
    requires: ["Connect Microsoft on the Outlook card. Teams uses the same sign-in"],
  },
  {
    id: "outlook",
    label: "Outlook",
    icon: OutlookMark,
    source: "outlook",
    /* Built. This entry said "planned, and the nearest to being possible" for
       months, and it was right: it turned out to be the same shape as Gmail.
       Reads the inbox, replies in thread, sends new mail.

       status here means "the integration exists", exactly as it does for
       Gmail above. Whether YOUR account is authorised is a different question
       with a different answer per person, and it is answered live on the
       Integrations page rather than guessed at in a static table. */
    status: "connected",
    compose: "email",
    /* Worth stating on the card, because it is the difference people trip
       over: Google refuses any account whose address is not your MadeEA login,
       and Microsoft does not (see 0048). An EA logging in with Gmail can
       connect a work Outlook mailbox. */
    note: "Reads your inbox and replies in thread. The mailbox does not have to match your MadeEA login, so a work Outlook account connects to a Gmail login fine.",
    tint: "#0078D4",
    settingsPath: "/integrations",
    requires: ["Sign in with the Microsoft account you send from"],
  },
  {
    id: "discord",
    label: "Discord",
    icon: DiscordMark,
    source: "discord",
    /* Built. "A bot token is all it takes" was right, and it is the same
       shape as Slack down to the failure modes: the bot reads only the
       channels it has been given, and posting and reading are separate
       permissions that are routinely granted separately. */
    status: "connected",
    compose: "message",
    note: "Workspace-level, like Slack. The bot reads the channels it has been given access to, and replies post back into the same channel.",
    tint: "#5865F2",
    settingsPath: "/integrations",
    requires: [
      "A Discord application with a bot user",
      "Its token stored as DISCORD_BOT_TOKEN",
      "The bot invited, with Read Message History in each channel you want pulled",
      "Message Content intent switched on in the Developer Portal",
    ],
  },
];

export const channelById = (id: ChannelId): Channel =>
  CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];

/** Channels a message could actually be in. Excludes the aggregate. */
export const REAL_CHANNELS = CHANNELS.filter((c) => c.id !== "all");

/** Only what a person can act on today, for pickers and counts. */
export const LIVE_CHANNELS = CHANNELS.filter(
  (c) => c.status === "connected" || c.status === "read_only",
);

export const STATUS_LABEL: Record<ChannelStatus, string> = {
  connected: "Connected",
  read_only: "Read only",
  not_connected: "Not connected",
  planned: "Coming later",
};

/** Whether a channel can be opened at all. `planned` is visible but inert. */
export const isUsable = (c: Channel): boolean => c.status !== "planned";
