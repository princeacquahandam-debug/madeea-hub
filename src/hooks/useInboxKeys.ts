import { useEffect } from "react";

/**
 * Gmail/Superhuman-style keys for the inbox.
 *
 * WHY A HOOK AND NOT onKeyDown ON THE LIST. The list is virtualized, so the row
 * you want to move to may not be in the DOM, and focus-based navigation would
 * stall at the edge of the rendered window. Selection is state; the keys move
 * the state and let the virtualizer catch up.
 *
 * THE RULE THAT MATTERS MOST: shortcuts never fire while you are typing. A
 * single-letter shortcut in an app with a search field and an email composer is
 * a trap otherwise, and the failure is silent and infuriating: you type "reply
 * to sam" in the search box and the app archives three messages. Anything
 * inside an input, textarea, select or contenteditable is the user's text, not
 * a command.
 *
 * Modifier combinations are left alone too. Ctrl+C is a copy, not a compose.
 */

export interface InboxKeyHandlers {
  next: () => void;
  prev: () => void;
  open: () => void;
  reply: () => void;
  compose: () => void;
  archive: () => void;
  done: () => void;
  delegate: () => void;
  search: () => void;
  help: () => void;
  escape: () => void;
}

/** True when the event came from somewhere the user is composing text. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true ||
    // A dialog counts: the compose window is a text surface even where the
    // event target happens to be a wrapper rather than the editable itself.
    !!el.closest?.('[role="dialog"]')
  );
}

export function useInboxKeys(handlers: InboxKeyHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    // `g` then `i` is a sequence, not a chord, so the first key has to be
    // remembered briefly. It expires, or a `g` typed and abandoned would turn
    // an unrelated `i` into a navigation ten minutes later.
    let pendingG = false;
    let gTimer: number | undefined;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Escape is the one key that must work everywhere, including inside the
      // composer, which is exactly where you want a way out.
      if (e.key === "Escape") { handlers.escape(); return; }

      if (isTyping(e.target)) return;

      if (pendingG) {
        pendingG = false;
        window.clearTimeout(gTimer);
        if (e.key === "i") { e.preventDefault(); handlers.open(); return; }
      }

      switch (e.key) {
        case "j": e.preventDefault(); handlers.next(); break;
        case "k": e.preventDefault(); handlers.prev(); break;
        case "Enter": e.preventDefault(); handlers.open(); break;
        case "r": e.preventDefault(); handlers.reply(); break;
        case "c": e.preventDefault(); handlers.compose(); break;
        case "e": e.preventDefault(); handlers.archive(); break;
        case "#": e.preventDefault(); handlers.done(); break;
        case "d": e.preventDefault(); handlers.delegate(); break;
        case "/": e.preventDefault(); handlers.search(); break;
        case "?": e.preventDefault(); handlers.help(); break;
        case "g":
          pendingG = true;
          gTimer = window.setTimeout(() => { pendingG = false; }, 1200);
          break;
        default: break;
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(gTimer);
    };
  }, [handlers, enabled]);
}

/** What the `?` sheet lists. One source, so the sheet cannot drift from the keys. */
export const INBOX_SHORTCUTS: { keys: string; does: string }[] = [
  { keys: "j / k", does: "Next / previous conversation" },
  { keys: "Enter", does: "Open the conversation" },
  { keys: "r", does: "Reply" },
  { keys: "c", does: "Compose a new email" },
  { keys: "e", does: "Archive" },
  { keys: "#", does: "Mark done" },
  { keys: "d", does: "Delegate" },
  { keys: "/", does: "Search this view" },
  { keys: "g then i", does: "Go to the inbox" },
  { keys: "?", does: "This list" },
  { keys: "Esc", does: "Close the panel or clear the search" },
];
