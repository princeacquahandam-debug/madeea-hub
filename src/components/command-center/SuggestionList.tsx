/**
 * SuggestionList — renders a titled group of suggestion rows (used for both the
 * static "Suggested" actions and the personalized "Smart" suggestions).
 */
import { OptionRow } from "./OptionRow";
import type { NavOption } from "./navOption";

export function SuggestionList({
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
          badge={o.badge}
          selected={selectedId === o.id}
          onHover={() => onHover(o.id)}
          onClick={o.activate}
        />
      ))}
    </div>
  );
}
