import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Settings2, Tag, Trash2, X } from "lucide-react";
import type { MailLabel, MailLabelColor } from "@/types/db";
import { useAnchoredPanel, ANCHORED_PANEL_CLASS } from "@/hooks/useAnchoredPanel";
import { LABEL_CHIP, LABEL_DOT, MAIL_LABEL_COLORS, useMailLabelMutations } from "@/data/mailLabels";
import { cn } from "@/lib/utils";

/**
 * Personal email labels (Reich's testing, 20 Oct 2026: "customisable labels
 * or folders to organise emails by category, priority or client").
 *
 * Four pieces, all on the inbox: chips on a row, a picker in the reader, a
 * "Label:" filter beside the sources menu, and a small manager for renaming,
 * recolouring and deleting. Labels belong to one person; see 0091.
 */

const row = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2";

/** Label chips, for a message row or the reader. Unknown ids (a teammate's label on a shared message) are skipped. */
export function LabelChips({ ids, labels, max = 2, className }: { ids?: string[]; labels: MailLabel[]; max?: number; className?: string }) {
  if (!ids?.length || labels.length === 0) return null;
  const mine = labels.filter((l) => ids.includes(l.id));
  if (mine.length === 0) return null;
  const shown = mine.slice(0, max);
  const more = mine.length - shown.length;
  return (
    <span className={cn("inline-flex min-w-0 shrink items-center gap-1", className)}>
      {shown.map((l) => (
        <span key={l.id} className={cn("max-w-[7rem] truncate rounded-full px-1.5 text-[10px] font-semibold leading-4", LABEL_CHIP[l.color])} title={`Label: ${l.name}`}>
          {l.name}
        </span>
      ))}
      {more > 0 && <span className="shrink-0 text-[10px] text-faint" title={mine.slice(max).map((l) => l.name).join(", ")}>+{more}</span>}
    </span>
  );
}

/** The seven colours as round swatches, a radio group. */
function ColorPicker({ value, onChange, label }: { value: MailLabelColor; onChange: (c: MailLabelColor) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {MAIL_LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          title={c}
          onClick={() => onChange(c)}
          className={cn(
            "icon-btn h-5 w-5 !min-h-0 !min-w-0 rounded-full",
            LABEL_DOT[c],
            value === c ? "ring-2 ring-accent ring-offset-1 ring-offset-[rgb(var(--c-surface))]" : "opacity-70 hover:opacity-100",
          )}
        />
      ))}
    </div>
  );
}

/** Name + colour + Create. Used by the picker and by the manager. */
function CreateLabelForm({ onCreated, autoFocus }: { onCreated?: (l: MailLabel) => void; autoFocus?: boolean }) {
  const { create } = useMailLabelMutations();
  const [name, setName] = useState("");
  const [color, setColor] = useState<MailLabelColor>("blue");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name, color }, {
      onSuccess: (l) => { setName(""); onCreated?.(l); },
    });
  };
  return (
    <form onSubmit={submit} className="space-y-2 px-1 pb-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor="new-mail-label" className="sr-only">New label name</label>
        <input
          id="new-mail-label"
          className="input h-8 flex-1 text-sm"
          placeholder="New label, e.g. Acme or Invoices"
          maxLength={40}
          value={name}
          autoFocus={autoFocus}
          onChange={(e) => { setName(e.target.value); create.reset(); }}
        />
        <button type="submit" className="btn-primary h-8 px-2.5 text-xs" disabled={!name.trim() || create.isPending}>
          <Plus size={13} /> Create
        </button>
      </div>
      <ColorPicker value={color} onChange={setColor} label="New label colour" />
      {create.error && <p className="text-xs text-red-500" role="alert">{(create.error as Error).message}</p>}
    </form>
  );
}

/**
 * The reader's "Labels" button. Ticks apply to the whole conversation, so a
 * thread does not end up half-labelled; a label counts as on when any message
 * in it carries it.
 */
export function LabelPicker({
  labels, applied, messageIds, onManage,
}: {
  labels: MailLabel[];
  /** Label ids on this conversation. */
  applied: Set<string>;
  messageIds: string[];
  onManage: () => void;
}) {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const { setOnMessages } = useMailLabelMutations();
  const toggle = (id: string, on: boolean) => setOnMessages.mutate({ messageIds, labelId: id, on });
  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-ghost h-7 border border-border px-2 text-xs"
      >
        <Tag size={13} /> Labels
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="menu" aria-label="Labels for this conversation" style={{ top: pos.top, right: pos.right }} className={`card ${ANCHORED_PANEL_CLASS} !w-72 p-1.5 shadow-xl`}>
          {labels.length === 0 && <p className="px-2.5 py-2 text-xs text-faint">No labels yet. Create one to sort mail by client, priority or anything else.</p>}
          {labels.map((l) => {
            const on = applied.has(l.id);
            return (
              <button key={l.id} role="menuitemcheckbox" aria-checked={on} className={row} onClick={() => toggle(l.id, !on)}>
                <span className="w-4">{on && <Check size={14} className="text-accent" />}</span>
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", LABEL_DOT[l.color])} aria-hidden="true" />
                <span className="flex-1 truncate">{l.name}</span>
              </button>
            );
          })}
          {setOnMessages.error && <p className="px-2.5 py-1 text-xs text-red-500" role="alert">{(setOnMessages.error as Error).message}</p>}
          <div className="mt-1 border-t border-border pt-2">
            <CreateLabelForm autoFocus={labels.length === 0} onCreated={(l) => toggle(l.id, true)} />
            <button role="menuitem" className={cn(row, "text-muted")} onClick={() => { setOpen(false); onManage(); }}>
              <span className="w-4"><Settings2 size={14} /></span> Manage labels
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** "Label: Any" beside the sources menu. "" is any label. */
export function LabelFilter({
  labels, value, onChange, onManage,
}: {
  labels: MailLabel[];
  value: string;
  onChange: (id: string) => void;
  onManage: () => void;
}) {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const current = labels.find((l) => l.id === value) ?? null;
  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text transition-colors hover:bg-[var(--chip-bg)]",
          current && "border-[var(--border-strong)]",
        )}
      >
        {current && <span className={cn("h-2.5 w-2.5 rounded-full", LABEL_DOT[current.color])} aria-hidden="true" />}
        <span className="max-w-[9rem] truncate">Label: {current ? current.name : "Any"}</span>
        <ChevronDown size={14} className="text-faint" />
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="menu" aria-label="Filter by label" style={{ top: pos.top, right: pos.right }} className={`card ${ANCHORED_PANEL_CLASS} !w-60 p-1.5 shadow-xl`}>
          <button role="menuitemradio" aria-checked={!current} className={row} onClick={() => { onChange(""); setOpen(false); }}>
            <span className="w-4">{!current && <Check size={14} className="text-accent" />}</span> Any label
          </button>
          {labels.map((l) => (
            <button key={l.id} role="menuitemradio" aria-checked={current?.id === l.id} className={row} onClick={() => { onChange(l.id); setOpen(false); }}>
              <span className="w-4">{current?.id === l.id && <Check size={14} className="text-accent" />}</span>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", LABEL_DOT[l.color])} aria-hidden="true" />
              <span className="flex-1 truncate">{l.name}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-border pt-1">
            <button role="menuitem" className={cn(row, "text-muted")} onClick={() => { setOpen(false); onManage(); }}>
              <span className="w-4"><Settings2 size={14} /></span> Manage labels
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** One editable label: rename on Enter or blur, recolour on click, delete after a confirm. */
function ManageRow({ label }: { label: MailLabel }) {
  const { update, remove } = useMailLabelMutations();
  const [name, setName] = useState(label.name);
  const [confirming, setConfirming] = useState(false);
  const commit = () => {
    if (name.trim() && name.trim() !== label.name) update.mutate({ id: label.id, name }, { onError: () => setName(label.name) });
    else setName(label.name);
  };
  return (
    <li className="space-y-1.5 rounded-lg border border-border p-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`label-${label.id}`} className="sr-only">Rename {label.name}</label>
        <input
          id={`label-${label.id}`}
          className="input h-8 flex-1 text-sm"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        {confirming ? (
          <span className="flex items-center gap-1 text-xs">
            <span className="text-muted">Delete?</span>
            <button className="btn-ghost h-7 px-2 text-xs text-red-500" onClick={() => remove.mutate(label.id)} disabled={remove.isPending}>Delete</button>
            <button className="btn-ghost h-7 px-2 text-xs" onClick={() => setConfirming(false)}>Keep</button>
          </span>
        ) : (
          <button className="icon-btn h-7 w-7 text-faint hover:text-red-500" aria-label={`Delete label ${label.name}`} onClick={() => setConfirming(true)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <ColorPicker value={label.color} onChange={(c) => update.mutate({ id: label.id, color: c })} label={`Colour for ${label.name}`} />
      {confirming && <p className="text-[11px] text-faint">It comes off every message. The messages themselves stay.</p>}
      {(update.error || remove.error) && <p className="text-xs text-red-500" role="alert">{((update.error || remove.error) as Error).message}</p>}
    </li>
  );
}

export function ManageLabelsDialog({ open, onClose, labels }: { open: boolean; onClose: () => void; labels: MailLabel[] }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Manage labels">
      <div className="w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <Tag size={16} className="text-accent" />
          <h2 className="text-sm font-semibold">Manage labels</h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto grid h-7 w-7 place-items-center rounded text-faint hover:bg-[var(--chip-bg)] hover:text-text">
            <X size={14} />
          </button>
        </div>
        <p className="mb-3 text-xs text-faint">Only you see your labels.</p>
        {labels.length > 0 ? (
          <ul className="mb-3 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {labels.map((l) => <ManageRow key={l.id} label={l} />)}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-muted">No labels yet.</p>
        )}
        <div className="border-t border-border pt-3">
          <CreateLabelForm autoFocus={labels.length === 0} />
        </div>
      </div>
    </div>
  );
}
