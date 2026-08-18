import { Mail, Hash, MessageCircle, Gamepad2, Inbox, type LucideIcon } from "lucide-react";

/**
 * Every place a client can reach us, declared once.
 *
 * WHY THIS FILE EXISTS. The Communication Center started as an email inbox with
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

export interface Channel {
  id: ChannelId;
  label: string;
  icon: LucideIcon;
  /** Matches `messages.source`. Null for the aggregate view. */
  source: string | null;
  status: ChannelStatus;
  /** Which composer this channel opens. Null means it cannot be replied to here. */
  compose: "email" | "message" | null;
  /** Shown when the channel is not fully usable. Names the fix, not the symptom. */
  note?: string;
  /** Brand tint, used only as a supporting cue. Never the sole signal. */
  tint: string;
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
    icon: Mail,
    source: "gmail",
    status: "connected",
    compose: "email",
    tint: "#EA4335",
  },
  {
    id: "slack",
    label: "Slack",
    icon: Hash,
    source: "slack",
    // Reads fine; posting needs chat:write on the Slack app.
    status: "read_only",
    compose: "message",
    note: "Reading works. Posting needs the chat:write scope added to the Slack app, then a reinstall.",
    tint: "#4A154B",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    source: "whatsapp",
    status: "planned",
    compose: null,
    note: "Not built yet. clients.preferred_channel already records who wants WhatsApp, so the demand is visible before the integration exists.",
    tint: "#25D366",
  },
  {
    id: "discord",
    label: "Discord",
    icon: Gamepad2,
    source: "discord",
    status: "planned",
    compose: null,
    note: "Not built yet.",
    tint: "#5865F2",
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
