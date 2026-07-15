/**
 * OptionRow — the one selectable row primitive shared by suggestions, history,
 * and search results, so keyboard highlight, hover, and layout stay identical
 * everywhere. Rows are `role="option"` for a proper ARIA listbox.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function OptionRow({
  icon: Icon, label, sub, badge, selected, onHover, onClick, trailing,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  badge?: string;
  selected: boolean;
  onHover: () => void;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onMouseEnter={onHover}
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors",
        selected ? "bg-accent/15 ring-1 ring-accent/40" : "hover:bg-white/5",
      )}
    >
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-surface-2/70", selected && "border-accent/50 text-accent")}>
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-100">{label}</span>
        {sub && <span className="block truncate text-xs text-faint">{sub}</span>}
      </span>
      {badge && <span className="pill shrink-0 bg-surface-2 text-[10px] text-faint">{badge}</span>}
      {trailing}
      {selected && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
    </div>
  );
}
