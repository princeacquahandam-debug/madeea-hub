import type { CSSProperties } from "react";

/** A single shining placeholder block. Size it with utility classes. */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** A placeholder that mirrors the shape of a typical content card. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${92 - i * 14}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-page placeholder — a title, a subtitle and a grid of card shells.
 * Used as the Suspense fallback while a lazily-loaded page chunk downloads,
 * so the content area shimmers instead of going blank.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
