/**
 * CommandInput — the large command bar. Includes a future-ready voice button
 * (disabled placeholder; the architecture reserves the slot for speech input)
 * and an inline hint. Keyboard handling is delegated up to CommandCenter so all
 * navigation lives in one place.
 */
import { forwardRef } from "react";
import { Sparkles, Mic, Loader2 } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  running: boolean;
  placeholder?: string;
}

export const CommandInput = forwardRef<HTMLInputElement, Props>(function CommandInput(
  { value, onChange, onKeyDown, running, placeholder }, ref,
) {
  return (
    <div className="flex items-center gap-3 px-4">
      {running ? (
        <Loader2 size={18} className="shrink-0 animate-spin text-accent" />
      ) : (
        <Sparkles size={18} className="shrink-0 text-accent" />
      )}
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? "Ask anything or run a command…"}
        className="w-full bg-transparent py-4 text-[15px] text-zinc-100 outline-none placeholder:text-faint"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls="cc-options"
        autoComplete="off"
        spellCheck={false}
      />
      {/* Future-ready: voice input. Disabled until speech capture ships. */}
      <button
        type="button"
        disabled
        title="Voice input — coming soon"
        aria-label="Voice input (coming soon)"
        className="shrink-0 cursor-not-allowed rounded-lg p-1.5 text-faint/60"
      >
        <Mic size={16} />
      </button>
      <kbd className="pill hidden shrink-0 bg-surface-2 text-[10px] text-faint sm:inline-flex">Esc</kbd>
    </div>
  );
});
