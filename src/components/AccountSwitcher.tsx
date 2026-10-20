import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Inbox, Plus } from "lucide-react";
import { useAnchoredPanel, ANCHORED_PANEL_CLASS } from "@/hooks/useAnchoredPanel";
import { useChannelStates } from "@/components/ChannelConnections";
import { ClientMailboxPanel, useClientMailboxes } from "@/components/ClientMailbox";
import { REAL_CHANNELS, type ChannelId } from "@/lib/channels";
import { cn } from "@/lib/utils";

/**
 * Switch between email accounts in the Inbox (19 Oct 2026 team meeting:
 * "multi-account email switching, Gmail/Outlook").
 *
 * Every mailbox this person can read, by its address: their own Gmail and
 * Outlook, and any client mailbox shared with them. Picking one of their own
 * narrows the Inbox to it; picking a client's opens that client's mail.
 * "All accounts" is everything together, which stays the default.
 */
const MAIL: ChannelId[] = ["gmail", "outlook"];

export function AccountSwitcher({ active, onPick }: { active: Set<ChannelId>; onPick: (id: ChannelId) => void }) {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const states = useChannelStates();
  const { data: boxes = [] } = useClientMailboxes();
  const [clientBox, setClientBox] = useState<string | null>(null);

  const mine = MAIL.filter((id) => states[id]?.connected).map((id) => ({
    id,
    channel: REAL_CHANNELS.find((c) => c.id === id)!,
    account: states[id]?.account ?? null,
  }));
  const single = active.size === 1 ? mine.find((m) => active.has(m.id)) : undefined;
  const label = single ? (single.account ?? single.channel.label) : "All accounts";
  const row = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2";

  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch email account"
        className="flex h-9 max-w-[16rem] items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-[var(--chip-bg)]"
      >
        {single ? <single.channel.icon size={14} /> : <Inbox size={14} className="text-faint" />}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={14} className="shrink-0 text-faint" />
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="menu" aria-label="Email accounts" style={{ top: pos.top, right: pos.right }} className={`card ${ANCHORED_PANEL_CLASS} !w-72 p-1.5 shadow-xl`}>
          <button role="menuitemradio" aria-checked={!single} className={row} onClick={() => { onPick("all"); setOpen(false); }}>
            <span className="w-4">{!single && <Check size={14} className="text-accent" />}</span>
            <Inbox size={14} className="text-faint" /> <span className="flex-1">All accounts</span>
          </button>
          {mine.map((m) => (
            <button key={m.id} role="menuitemradio" aria-checked={single?.id === m.id} className={row}
              onClick={() => { if (single?.id !== m.id) { onPick("all"); onPick(m.id); } setOpen(false); }}>
              <span className="w-4">{single?.id === m.id && <Check size={14} className="text-accent" />}</span>
              <m.channel.icon size={14} />
              <span className="min-w-0 flex-1"><span className="block text-sm">{m.channel.label}</span>{m.account && <span className="block truncate text-xs text-faint">{m.account}</span>}</span>
            </button>
          ))}
          {boxes.length > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold text-faint">Client mailboxes</p>
              {boxes.map((b) => (
                <button key={b.client_id} role="menuitem" className={row} onClick={() => { setClientBox(b.client_id); setOpen(false); }}>
                  <span className="w-4" />
                  <Inbox size={14} className="text-faint" />
                  <span className="min-w-0 flex-1"><span className="block text-sm">{b.client_name}</span>{b.account_email && <span className="block truncate text-xs text-faint">{b.account_email}</span>}</span>
                </button>
              ))}
            </>
          )}
          <div className="mt-1 border-t border-border pt-1">
            <Link to="/integrations" role="menuitem" className={cn(row, "text-muted")} onClick={() => setOpen(false)}>
              <span className="w-4"><Plus size={14} /></span> Connect another account
            </Link>
          </div>
        </div>,
        document.body,
      )}
      {clientBox && createPortal(
        <ClientMailboxPanel boxes={boxes} initialClientId={clientBox} onClose={() => setClientBox(null)} />,
        document.body,
      )}
    </>
  );
}
