/**
 * Web Speech API wrapper for quick voice capture.
 *
 * Deliberately unopinionated about the UI — it reports what the browser is doing
 * and lets the caller decide. The three ways this goes wrong are all normal
 * outcomes, not exceptions:
 *   - unsupported  → no SpeechRecognition (notably iOS Safari). Type instead.
 *   - denied       → the user said no to the mic. Type instead.
 *   - no speech    → silence. Not an error; just nothing to show yet.
 *
 * Transcription happens on-device/in-browser; no audio is uploaded from here.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as any;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? (new Ctor() as SpeechRecognitionLike) : null;
}

export const speechSupported = (): boolean =>
  typeof window !== "undefined" &&
  Boolean((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);

export type CaptureState = "idle" | "listening" | "denied" | "unsupported" | "error";

export function useSpeechCapture() {
  const supported = speechSupported();
  const [state, setState] = useState<CaptureState>(supported ? "idle" : "unsupported");
  /** Finalised speech. */
  const [transcript, setTranscript] = useState("");
  /** What it thinks it's hearing right now — shown live so the mic feels alive. */
  const [interim, setInterim] = useState("");
  const [heardNothing, setHeardNothing] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const ref = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    ref.current?.stop();
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setInterim("");
    setHeardNothing(false);
    setConfidence(null);
    if (supported) setState("idle");
  }, [supported]);

  const start = useCallback(() => {
    if (!supported) {
      setState("unsupported");
      return;
    }
    const rec = getRecognition();
    if (!rec) {
      setState("unsupported");
      return;
    }
    ref.current = rec;
    setTranscript("");
    setInterim("");
    setHeardNothing(false);
    setConfidence(null);

    rec.lang = navigator.language || "en-GB";
    rec.continuous = true; // a task can take a couple of sentences to say
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      let final = "";
      let live = "";
      let best: number | null = null;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          final += r[0].transcript;
          const c = r[0].confidence;
          // Chrome reports 0 confidence in some builds — don't let that read as "terrible".
          if (typeof c === "number" && c > 0) best = best === null ? c : Math.min(best, c);
        } else {
          live += r[0].transcript;
        }
      }
      if (final) setTranscript((t) => (t + " " + final).trim());
      setInterim(live);
      if (best !== null) setConfidence(best);
    };

    rec.onerror = (e: any) => {
      switch (e?.error) {
        case "not-allowed":
        case "service-not-allowed":
          setState("denied");
          break;
        case "no-speech":
          // Silence is an expected outcome, not a failure.
          setHeardNothing(true);
          setState("idle");
          break;
        case "aborted":
          setState("idle");
          break;
        default:
          setState("error");
      }
    };

    rec.onend = () => {
      setInterim("");
      setState((s) => (s === "listening" ? "idle" : s));
    };

    try {
      rec.start();
      setState("listening");
    } catch {
      // start() throws if called while already running — harmless.
      setState("listening");
    }
  }, [supported]);

  useEffect(() => () => ref.current?.abort(), []);

  return {
    supported,
    state,
    listening: state === "listening",
    transcript,
    interim,
    heardNothing,
    /** Null when the browser doesn't report it. Low values → nudge the user to check the text. */
    confidence,
    start,
    stop,
    reset,
    setTranscript,
  };
}
