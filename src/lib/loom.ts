import { useCallback, useRef, useState } from "react";

/**
 * Loom, shared by the Integrations card and Learn (Training Center, SOPs).
 *
 * Recording uses Loom's record kit (@loomhq/record-sdk, pinned 4.12.4), which
 * needs a Loom developer app's Public App ID in VITE_LOOM_APP_ID. Without it,
 * Loom links can still be pasted in and played; only in-app recording waits
 * for the ID. The kit is downloaded only when someone presses Record.
 */
export const LOOM_APP_ID = (import.meta.env.VITE_LOOM_APP_ID as string | undefined)?.trim() || "";

export interface LoomRecording { title: string; url: string }

/** The video id from a Loom share or embed link, or null when it isn't one. */
export function loomId(url: string): string | null {
  const m = /^https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/.exec(url.trim());
  return m ? m[1] : null;
}
export const loomShareUrl = (id: string) => `https://www.loom.com/share/${id}`;
export const loomEmbedUrl = (id: string) => `https://www.loom.com/embed/${id}`;

/**
 * Attach Loom's recorder to a button. The first click loads the kit and opens
 * the recorder; "Insert" at the end of a recording calls `onVideo`.
 */
export function useLoomRecorder(onVideo: (v: LoomRecording) => void) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const onVideoRef = useRef(onVideo);
  onVideoRef.current = onVideo;

  const prepare = useCallback(async () => {
    if (!LOOM_APP_ID || state === "loading" || state === "ready") return;
    setState("loading");
    setError("");
    try {
      const { isSupported } = await import("@loomhq/record-sdk/is-supported");
      const support = await isSupported();
      if (!support.supported) {
        setState("error");
        setError(support.error === "third-party-cookies-disabled"
          ? "Loom needs third-party cookies for this site. Allow them in your browser settings, then try again."
          : "This browser can't record with Loom. Try Chrome, Edge or Firefox on a computer.");
        return;
      }
      const { setup } = await import("@loomhq/record-sdk");
      const { configureButton } = await setup({ publicAppId: LOOM_APP_ID });
      if (!buttonRef.current) return;
      const sdkButton = configureButton({ element: buttonRef.current });
      sdkButton.on("insert-click", (video) => onVideoRef.current({ title: video.title || "Loom recording", url: video.sharedUrl }));
      setState("ready");
      // That click only loaded the kit; open the recorder now.
      buttonRef.current.click();
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Loom couldn't start. Try again.");
    }
  }, [state]);

  return { available: Boolean(LOOM_APP_ID), buttonRef, state, error, prepare };
}
