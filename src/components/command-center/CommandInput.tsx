/**
 * CommandInput — the large command bar. The mic button dictates into the input
 * using the browser's own speech engine (see lib/speech.ts) when the browser
 * supports it, and falls back to a disabled control with an honest reason when it
 * doesn't. Keyboard handling is delegated up to CommandCenter so all navigation
 * lives in one place.
 */
import { forwardRef, useEffect, useRef, useState } from "react";
import { Sparkles, Mic, Loader2 } from "lucide-react";
import { isSpeechSupported, startDictation, type Dictation } from "@/lib/speech";

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
  const supported = isSpeechSupported();
  const [listening, setListening] = useState(false);
  const sessionRef = useRef<Dictation | null>(null);
  // The text already in the box when dictation starts — spoken words are appended
  // to it rather than replacing it, so the mic adds to a half-typed command.
  const baseRef = useRef("");

  // Stop cleanly if the bar unmounts mid-dictation.
  useEffect(() => () => sessionRef.current?.stop(), []);

  function toggleMic() {
    if (listening) {
      sessionRef.current?.stop();
      return;
    }
    baseRef.current = value ? `${value.trimEnd()} ` : "";
    const session = startDictation({
      onTranscript: (text) => onChange(baseRef.current + text),
      onEnd: () => {
        setListening(false);
        sessionRef.current = null;
      },
    });
    if (session) {
      sessionRef.current = session;
      setListening(true);
    }
  }

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
      <button
        type="button"
        onClick={toggleMic}
        disabled={!supported}
        title={
          supported
            ? listening
              ? "Stop listening"
              : "Voice input — dictate your command"
            : "Voice input isn't supported in this browser"
        }
        aria-label={
          supported
            ? listening
              ? "Stop voice input"
              : "Start voice input"
            : "Voice input not supported in this browser"
        }
        aria-pressed={listening}
        className={
          "shrink-0 rounded-lg p-1.5 transition-colors " +
          (!supported
            ? "cursor-not-allowed text-faint/60"
            : listening
              ? "bg-accent/15 text-accent animate-pulse"
              : "text-faint hover:bg-surface-2 hover:text-zinc-100")
        }
      >
        <Mic size={16} />
      </button>
      <kbd className="pill hidden shrink-0 bg-surface-2 text-[10px] text-faint sm:inline-flex">Esc</kbd>
    </div>
  );
});
