import { HelpCircle } from "lucide-react";

export function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle focus-within:z-50">
      <button
        type="button"
        tabIndex={0}
        aria-label={text}
        className="inline-flex text-faint hover:text-zinc-100 focus:outline-none"
      >
        <HelpCircle size={13} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-xs rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted shadow-lg group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}
