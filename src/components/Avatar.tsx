import { useEffect, useState } from "react";
import { cn, initials } from "@/lib/utils";

// Shows the client's image when present and loadable; otherwise falls back to
// initials. Never breaks: missing url, empty string, or a broken/blocked image
// all degrade gracefully to the initials badge.
export function Avatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]); // reset when the image changes

  const ok = url && url.trim() && !failed;
  if (ok) {
    return (
      <img
        src={url!}
        alt={name}
        onError={() => setFailed(true)}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  return (
    <div className={cn("flex items-center justify-center rounded-full bg-accent/20 font-semibold text-accent-soft", className)}>
      {initials(name) || "-"}
    </div>
  );
}
