/**
 * SearchResults — instant workspace search rows. Purely presentational; the
 * ranking/index lives in the orchestrator so results appear as you type.
 */
import { OptionRow } from "./OptionRow";
import type { NavOption } from "./navOption";

export function SearchResults({
  options, selectedId, onHover, empty,
}: {
  options: NavOption[];
  selectedId: string | null;
  onHover: (id: string) => void;
  empty?: boolean;
}) {
  if (empty) {
    return <p className="px-3 py-8 text-center text-sm text-faint">No matching items — press <kbd className="cc-kbd">↵</kbd> to run your command.</p>;
  }
  if (!options.length) return null;
  return (
    <div className="mb-2" role="group" aria-label="Search results">
      <p className="eyebrow px-3 py-1.5">Results</p>
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
