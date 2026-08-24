import { useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { X, Plus, Loader2, Check, Unplug, AlertTriangle, Users, Lock } from "lucide-react";
import type { Channel } from "@/lib/channels";
import type { WorkspaceIntegration } from "@/types/db";
import { connectAccount, type ConnectProvider } from "@/lib/connect";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * What opens when you press Connect or Manage on a channel.
 *
 * WHY A DIALOG RATHER THAN GOING STRAIGHT TO THE PROVIDER. Pressing Connect
 * used to throw you at a login window immediately, which is fine exactly once.
 * It answers none of the questions people actually have at that moment: which
 * account is already connected, is it the right one, can I add the client's as
 * well as ours, and which of them do replies go from. A login window cannot
 * answer any of that, and closing it to find out loses the flow.
 *
 * So the button opens the integration, and the integration has a list. Add
 * Account is what opens the provider.
 *
 * WHY THE LIST HAS A DEFAULT COLUMN. Reading is unambiguous: every message
 * records the account it arrived on. Sending is not. "Post this to Slack" has
 * to choose, and choosing the most recent would mean a reply going somewhere
 * new because a colleague connected something this morning. One account is
 * marked, that one sends, and it changes only when a person changes it.
 *
 * WHY MAILBOXES LOOK DIFFERENT IN HERE. Gmail, Outlook and Teams are personal:
 * the row is yours, nobody else's is visible, and there is nothing to make
 * default because you only ever have one. The dialog says so rather than
 * showing an empty table with a control that cannot apply.
 */
export function IntegrationDialog({
  channel, provider, accounts, personalAccount, connected, onClose,
}: {
  channel: Channel;
  provider: ConnectProvider;
  /** Shared installs. Empty for a personal mailbox. */
  accounts: WorkspaceIntegration[];
  /** A personal mailbox's address, when this channel is one. */
  personalAccount?: string | null;
  connected: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const shared = provider === "slack" || provider === "discord" || provider === "meta" || provider === "linkedin";

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["workspace-integrations"] });
    qc.invalidateQueries({ queryKey: ["mail-connections"] });
  };

  /**
   * Add an account, having been told whose it is.
   *
   * The question is asked HERE rather than assumed, because the two answers are
   * indistinguishable from the outside and only the person pressing the button
   * knows which they mean. Defaulting to shared publishes somebody's own
   * Instagram to the team; defaulting to private hides the agency's Slack from
   * everyone who needs it.
   */
  async function add(isPrivate: boolean) {
    setBusy("add");
    setNote("");
    const r = await connectAccount(provider, { private: isPrivate });
    setBusy(null);
    /* Only a refusal needs words. A success is visible: a row appears in the
       table naming the account, which says more than a sentence could. */
    if (!r.ok) setNote(r.error ?? "That did not connect.");
    refresh();
  }

  async function makeDefault(row: WorkspaceIntegration) {
    if (!supabase || row.is_default) return;
    setBusy(row.id);
    setNote("");
    /* Cleared first, then set. The database allows exactly one default per
       provider (0057), so setting before clearing trips that index and the
       change is refused rather than half-applied. */
    const { error: clearErr } = await supabase
      .from("workspace_integrations")
      .update({ is_default: false })
      .eq("provider", row.provider)
      .eq("is_default", true);
    if (!clearErr) {
      const { error } = await supabase
        .from("workspace_integrations")
        .update({ is_default: true })
        .eq("id", row.id);
      if (error) setNote(error.message);
    } else {
      setNote(clearErr.message);
    }
    setBusy(null);
    refresh();
  }

  async function remove(row: WorkspaceIntegration) {
    if (!supabase) return;
    const label = row.account_label ?? channel.label;
    if (!window.confirm(`Disconnect ${label}? Messages already synced stay; nothing new arrives from it.`)) return;
    setBusy(row.id);
    const { error } = await supabase.from("workspace_integrations").delete().eq("id", row.id);
    setNote(error ? error.message : `${label} disconnected.`);
    setBusy(null);
    refresh();
  }

  async function removePersonal() {
    if (!supabase) return;
    /* One consent covers two things on both providers, and somebody who meant
       to detach half of a pair deserves to know before pressing it. */
    const warning =
      provider === "google"
        ? "Disconnect Google? Gmail sync AND your calendar events stop until you sign in again."
        : "Disconnect Microsoft? Outlook mail AND Teams chats stop until you sign in again.";
    if (!window.confirm(warning)) return;
    setBusy("personal");
    const table = provider === "google" ? "google_credentials" : "microsoft_credentials";
    /* RLS scopes this to your own row; the filter is only here because the
       client demands one. */
    const { error } = await supabase.from(table).delete().neq("owner_id", "00000000-0000-0000-0000-000000000000");
    setNote(error ? error.message : "Disconnected.");
    setBusy(null);
    refresh();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
      /* The backdrop closes it, as every dialog does. The panel stops the click
         so a press inside never dismisses what you are working in. */
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${channel.label} integration`}
    >
      <div
        className="modal-panel w-full max-w-2xl rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2">
            <channel.icon size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{channel.label}</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{channel.note ?? ""}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold">Connected account{shared ? "s" : ""}</h3>
            {shared && (
              <div className="flex items-center gap-1.5">
                {/* Two buttons rather than a button and a checkbox. The choice
                    is not a modifier on an action, it IS the action: what you
                    get afterwards differs in who can read the messages. */}
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-accent/50 px-2.5 py-1.5 text-[12px] font-medium text-accent-soft transition-colors hover:bg-accent/10 disabled:opacity-50"
                  onClick={() => add(false)}
                  disabled={busy !== null}
                  title="Everyone in the workspace can read and reply from this account"
                >
                  {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
                  Add for the team
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text disabled:opacity-50"
                  onClick={() => add(true)}
                  disabled={busy !== null}
                  title="Only you can read this account's messages, the way your mailbox works"
                >
                  <Lock size={13} /> Add just for me
                </button>
              </div>
            )}
          </div>

          {shared ? (
            accounts.length === 0 ? (
              <div className="px-4 py-7 text-center">
                <p className="text-[12.5px] text-faint">
                  Nothing connected yet. Either button opens {channel.label}'s own sign-in.
                </p>
                <p className="mx-auto mt-2 max-w-md text-[11.5px] leading-relaxed text-faint">
                  <span className="text-muted">For the team</span> is the agency's account: everyone sees its
                  messages and anyone can cover it.{" "}
                  <span className="text-muted">Just for me</span> is yours, readable only by you, exactly like
                  your mailbox.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="px-4 py-2 font-medium">Default</th>
                    <th className="px-2 py-2 font-medium">Account</th>
                    <th className="px-2 py-2 font-medium">Visible to</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5">
                        {/* A radio, because exactly one can hold it. A checkbox
                            would imply two could, which the database refuses. */}
                        <input
                          type="radio"
                          name={`default-${provider}`}
                          checked={a.is_default}
                          onChange={() => makeDefault(a)}
                          disabled={busy !== null}
                          aria-label={`Send from ${a.account_label ?? "this account"}`}
                          className="h-3.5 w-3.5 accent-[var(--accent)]"
                        />
                      </td>
                      <td className="min-w-0 px-2 py-2.5">
                        <span className="block truncate font-medium">{a.account_label ?? "Connected account"}</span>
                        <span className="block text-[11px] text-faint">
                          Added {new Date(a.connected_at).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        {/* Stated per row, because a grid holding both kinds is
                            exactly where somebody would otherwise assume the
                            wrong one. */}
                        {a.owner_id ? (
                          <span className="pill bg-zinc-500/15 text-faint" title="Only you can read this account">
                            <Lock size={11} /> Just me
                          </span>
                        ) : (
                          <span className="pill bg-zinc-500/15 text-faint" title="Everyone in the workspace can read this account">
                            <Users size={11} /> The team
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="pill bg-emerald-500/15 text-emerald-400">
                          <Check size={11} /> Connected
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                          onClick={() => remove(a)}
                          disabled={busy !== null}
                          title="Disconnect this account"
                          aria-label={`Disconnect ${a.account_label ?? "account"}`}
                        >
                          {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            /* A personal mailbox. One account, yours, and no default to pick:
               a table with a radio nobody can move would be furniture. */
            <div className="px-4 py-4">
              {connected ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="pill bg-emerald-500/15 text-emerald-400">
                    <Check size={11} /> Connected
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{personalAccount ?? "Your account"}</span>
                  <button
                    className="btn-ghost border border-border py-1 text-[12px]"
                    onClick={removePersonal}
                    disabled={busy !== null}
                  >
                    <Unplug size={13} /> Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted">
                    This one is personal: you connect your own, and nobody else in the workspace can read it.
                  </p>
                  <button
                    className="flex items-center gap-1.5 rounded-lg border border-accent/50 px-3 py-1.5 text-[12px] font-medium text-accent-soft transition-colors hover:bg-accent/10 disabled:opacity-50"
                    onClick={() => add(true)}
                    disabled={busy !== null}
                  >
                    {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Sign in
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {note && (
          <p className={cn(
            "mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-200",
          )}>
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>{note}</span>
          </p>
        )}

        {/* One line of what actually happens next, because "connected" and
            "messages are arriving" are not the same moment for every channel:
            most pull on a schedule, WhatsApp only ever receives. */}
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          {provider === "meta"
            ? "One Meta sign-in covers Instagram and WhatsApp. Instagram pulls its recent messages; WhatsApp receives by webhook only, so nothing appears until somebody messages the number."
            : "New messages arrive on the next sync, or straight away from the Sync now option on the card."}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost border border-border" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
