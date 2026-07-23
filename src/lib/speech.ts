/**
 * A thin, typed wrapper over the browser Web Speech API (SpeechRecognition).
 *
 * The API ships under two names — `SpeechRecognition` (spec) and
 * `webkitSpeechRecognition` (Chrome/Edge/Safari) — and isn't in TypeScript's lib
 * DOM types, so the minimal shape we actually use is declared here rather than
 * pulled in wholesale. Firefox has no support at all; `isSpeechSupported` lets the
 * UI show a disabled control with an honest reason instead of a dead button.
 *
 * Recognition runs entirely in the browser's own engine — no audio is sent
 * anywhere by this app.
 */

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}
interface SpeechRecognitionErrorLike {
  readonly error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isSpeechSupported = (): boolean => getCtor() !== null;

export interface DictationHandlers {
  /** Fires as words come in — interim text included, so the input updates live. */
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

export interface Dictation {
  stop: () => void;
}

/**
 * Start a single dictation session. Returns a handle to stop it, or null if the
 * browser can't do speech. The caller decides what to do with the text — this
 * never touches the DOM itself.
 */
export function startDictation(handlers: DictationHandlers): Dictation | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = navigator.language || "en-GB";
  rec.continuous = false;
  rec.interimResults = true;

  rec.onresult = (e) => {
    let text = "";
    let isFinal = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      text += result[0]?.transcript ?? "";
      if (result.isFinal) isFinal = true;
    }
    handlers.onTranscript(text, isFinal);
  };

  rec.onerror = (e) => {
    // "no-speech" and "aborted" are ordinary ways a session ends, not failures to
    // shout about — only surface the ones a user could act on.
    if (e.error !== "no-speech" && e.error !== "aborted") {
      handlers.onError?.(
        e.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in your browser to use voice input."
          : "Voice input stopped unexpectedly.",
      );
    }
  };

  rec.onend = () => handlers.onEnd?.();

  try {
    rec.start();
  } catch {
    return null;
  }

  return { stop: () => rec.stop() };
}
