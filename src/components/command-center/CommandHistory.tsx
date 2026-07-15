/**
 * CommandHistory — recent, pinned, and most-used commands with a pin toggle.
 * Rows re-run the stored prompt when activated.
 */
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { OptionRow } from "./OptionRow";
import type { NavOption } from "./navOption";

export function CommandHistory({
  title, options, selectedId, onHover,
}: {
  title: string;
  options: NavOption[];
  selectedId: string | null;
  onHover: (id: string) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="mb-2" role="group" aria-label={title}>
      <p className="eyebrow px-3 py-1.5">{title}</p>
      {options.map((o) => (
        <OptionRow
          key={o.id}
          icon={o.icon}
          label={o.label}
          sub={o.sub}
          selected={selectedId === o.id}
          onHover={() => onHover(o.id)}
          onClick={o.activate}
          trailing={
            o.onPin ? (
              <button
                onClick={(e) => { e.stopPropagation(); o.onPin!(); }}
                aria-label={o.pinned ? "Unpin command" : "Pin command"}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 aria-[selected]:opacity-100"
              >
                <Star size={14} className={cn(o.pinned ? "fill-accent text-accent" : "text-faint hover:text-accent")} />
              </button>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
