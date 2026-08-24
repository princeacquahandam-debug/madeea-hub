import { useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { X, Plus, Loader2, Check, Unplug, AlertTriangle } from "lucide-react";
import type { Channel } from "@/lib/channels";
import type { Integration } from "@/types/db";
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
  accounts: Integration[];
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

  async function add() {
    setBusy("add");
    setNote("");
    const r = await connectAccount(provider);
    setBusy(null);
    /* Only a refusal needs words. A success is visible: a row appears in the
       table naming the account, which says more than a sentence could. */
    if (!r.ok) setNote(r.error ?? "That did not connect.");
    refresh();
  }

  async function remove(row: Integration) {
    if (!supabase) return;
    const label = row.provider_email ?? row.provider_account_name ?? channel.label;
    if (!window.confirm(`Disconnect ${label}? Messages already synced stay; nothing new arrives from it.`)) return;
    setBusy(row.id);
    /* One row, by id. RLS confines that to your own, so a colleague's
       integration id in this request matches nothing rather than deleting
       something. */
    const { error } = await supabase.from("integrations").delete().eq("id", row.id);
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
              <button
                className="flex items-center gap-1.5 rounded-lg border border-accent/50 px-2.5 py-1.5 text-[12px] font-medium text-accent-soft transition-colors hover:bg-accent/10 disabled:opacity-50"
                onClick={add}
                disabled={busy !== null}
              >
                {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Add account
              </button>
            )}
          </div>

          {shared ? (
            accounts.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-faint">
                Nothing connected yet. Add account opens {channel.label}'s own sign-in.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="min-w-0 px-4 py-2.5">
                        {/* The address first: it is how a person recognises
                            which of their own accounts this is. The provider's
                            display name is the fallback for the channels that
                            issue no address, like a Slack workspace. */}
                        <span className="block truncate font-medium">
                          {a.provider_email ?? a.provider_account_name ?? "Connected account"}
                        </span>
                        <span className="block text-[11px] text-faint">
                          {a.provider_email && a.provider_account_name ? `${a.provider_account_name} · ` : ""}
                          Added {new Date(a.created_at).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        {/* Three states, not two. A connection whose refresh
                            token has been revoked is not "connected" and not
                            "missing": it needs one sign-in, and saying so is
                            the difference between a fix and a support ticket. */}
                        {a.status === "connected" ? (
                          <span className="pill bg-emerald-500/15 text-emerald-400">
                            <Check size={11} /> Connected
                          </span>
                        ) : a.status === "reauth_required" ? (
                          <button
                            className="pill bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                            onClick={() => add()}
                            title={a.last_error ?? "Authorisation expired"}
                          >
                            <AlertTriangle size={11} /> Reconnect
                          </button>
                        ) : (
                          <span className="pill bg-red-500/15 text-red-400" title={a.last_error ?? undefined}>
                            <AlertTriangle size={11} /> {a.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                          onClick={() => remove(a)}
                          disabled={busy !== null}
                          title="Disconnect this account"
                          aria-label={`Disconnect ${a.provider_email ?? a.provider_account_name ?? "account"}`}
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
                    onClick={add}
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
