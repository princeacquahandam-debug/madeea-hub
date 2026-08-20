import { Inbox } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { SlackMark, GmailMark, WhatsAppMark, DiscordMark } from "@/components/BrandIcons";

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

export type ChannelId = "all" | "gmail" | "slack" | "whatsapp" | "discord";
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
    id: "whatsapp",
    label: "WhatsApp",
    icon: WhatsAppMark,
    source: "whatsapp",
    status: "planned",
    compose: null,
    note: "Not built yet. clients.preferred_channel already records who wants WhatsApp, so the demand is visible before the integration exists.",
    tint: "#25D366",
    /* Not a button we can add. WhatsApp Business is a Meta review with a
       verified business and a dedicated number, measured in days, and saying
       otherwise on screen would promise something nobody can deliver today. */
    requires: [
      "A Meta Business account, verified",
      "A phone number not already on WhatsApp",
      "Meta approval of the WhatsApp Business API (days, not minutes)",
    ],
  },
  {
    id: "discord",
    label: "Discord",
    icon: DiscordMark,
    source: "discord",
    status: "planned",
    compose: null,
    note: "Not built yet. A bot token is all it takes, so this is the next one to switch on if a client lives in Discord.",
    tint: "#5865F2",
    /* Genuinely close: Discord bots are a token and an invite, much like Slack
       turned out to be. Listed so the difference from WhatsApp is visible. */
    requires: [
      "A Discord application with a bot user",
      "The bot invited to the server",
      "Its token stored as DISCORD_BOT_TOKEN",
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
