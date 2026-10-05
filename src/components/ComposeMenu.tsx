import { createPortal } from "react-dom";
import { ChevronDown, Mail, MessageSquare, Wand2 } from "lucide-react";
import { useAnchoredPanel, ANCHORED_PANEL_CLASS } from "@/hooks/useAnchoredPanel";
import type { Channel } from "@/lib/channels";
import type { MailProvider } from "@/types/db";

/**
 * Compose, for whichever channel you're in.
 *
 * It always opened an email (28 Sep audit: "why does it take me to email, not
 * Slack, not WhatsApp?"). Now:
 *  - Inbox filtered to one channel: Compose starts there. Gmail or Outlook
 *    opens an email from that mailbox; Slack opens the Slack composer.
 *  - Otherwise it asks: Email, or a Slack message when Slack works for you.
 *
 * WhatsApp, Instagram, Teams and Discord can't be started from here: Meta only
 * allows replies inside its messaging window, and Teams and Discord answer in
 * the conversation. The menu says so instead of offering a button that fails.
 */
export function ComposeMenu({
  sole, slackAvailable, onEmail, onSlack,
}: {
  /** The one channel the Inbox is filtered to, if exactly one. */
  sole: Channel | null;
  slackAvailable: boolean;
  onEmail: (provider?: MailProvider) => void;
  onSlack: () => void;
}) {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();

  const direct =
    sole?.id === "gmail" || sole?.id === "outlook" ? () => onEmail(sole.id as MailProvider)
    : sole?.id === "slack" && slackAvailable ? onSlack
    : null;
  const label = sole?.id === "slack" && direct ? "New Slack message" : sole && direct ? `New ${sole.label} email` : "Compose";

  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2";

  return (
    <>
      <button
        ref={anchorRef}
        className="btn-primary h-10 shrink-0"
        onClick={() => (direct ? direct() : setOpen(!open))}
        aria-haspopup={direct ? undefined : "menu"}
        aria-expanded={direct ? undefined : open}
      >
        <Wand2 size={15} /> {label}
        {!direct && <ChevronDown size={14} className="-mr-1 opacity-80" />}
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="menu" style={{ top: pos.top, right: pos.right }} className={`card ${ANCHORED_PANEL_CLASS} !w-72 p-1.5 shadow-xl`}>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onEmail(); }}>
            <Mail size={16} className="text-muted" /> Email
          </button>
          {slackAvailable && (
            <button role="menuitem" className={item} onClick={() => { setOpen(false); onSlack(); }}>
              <MessageSquare size={16} className="text-muted" /> Slack message
            </button>
          )}
          <p className="border-t border-border px-2.5 pb-1 pt-2 text-xs leading-relaxed text-faint">
            WhatsApp, Instagram, Teams and Discord: open the conversation and reply there. Meta doesn't allow starting a new WhatsApp or Instagram chat from here.
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}
