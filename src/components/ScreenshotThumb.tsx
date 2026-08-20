import { useEffect, useState } from "react";
import { EyeOff, ImageOff, Loader2 } from "lucide-react";
import { signedScreenshotUrl, type ScreenshotRow } from "@/data/hooks";
import { cn } from "@/lib/utils";

/**
 * One screenshot thumbnail, fetched through a signed URL.
 *
 * WHY EACH ONE SIGNS ITS OWN. The bucket is private, so there is no persistent
 * src to put in an <img>. Signing happens per image, on mount, and the URL
 * expires in a minute: long enough to paint, short enough that a link copied out
 * of devtools is dead before it can be shared. Nothing here ever sees a storage
 * credential.
 *
 * WHY IT LOADS LAZILY. A day of monitoring is dozens of images. Signing and
 * fetching all of them on mount would issue that many requests before the first
 * one is on screen, so each waits until it is actually scrolled into view.
 */
export function ScreenshotThumb({
  shot, selected, onSelect,
}: {
  shot: ScreenshotRow;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    signedScreenshotUrl(shot.storage_path).then((u) => {
      if (!alive) return;
      if (u) setUrl(u); else setFailed(true);
    });
    return () => { alive = false; };
  }, [shot.storage_path]);

  const when = new Date(shot.captured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative aspect-video w-full overflow-hidden rounded-lg border bg-surface-2 text-left transition-colors",
        selected ? "border-accent ring-1 ring-accent" : "border-border hover:border-[var(--border-strong)]",
      )}
      aria-label={`Screenshot at ${when}${shot.blurred ? ", blurred" : ""}`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-faint">
          {failed ? <ImageOff size={18} /> : <Loader2 size={16} className="animate-spin" />}
        </span>
      )}

      {/* Time is on every thumbnail, because a grid of screenshots with no
          timestamps is unreviewable: the whole question is what happened when. */}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/60 px-1.5 py-1 text-[10px] font-medium text-white">
        <span className="tabular-nums">{when}</span>
        {shot.blurred && (
          <span className="ml-auto flex items-center gap-0.5" title="Blurred for privacy. The original was never stored.">
            <EyeOff size={10} /> Blurred
          </span>
        )}
      </span>
    </button>
  );
}
