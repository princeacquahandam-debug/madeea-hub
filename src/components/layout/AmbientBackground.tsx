// Ambient animated backdrop — soft drifting colour blobs behind the whole app.
// Fixed at z-0; the app shell sits above it (z-1). Colours come from CSS
// variables (--cool1/2/3, --ambient-base) so it re-tints per theme.
const BLOBS: React.CSSProperties[] = [
  { top: "-18%", left: "-10%", width: "70%", height: "75%", background: "radial-gradient(closest-side, rgba(var(--cool1),0.85), rgba(var(--cool1),0) 70%)", filter: "blur(64px)", animation: "driftA 26s ease-in-out infinite" },
  { top: "8%", left: "26%", width: "60%", height: "62%", background: "radial-gradient(closest-side, rgba(var(--cool2),0.7), rgba(var(--cool2),0) 70%)", filter: "blur(66px)", animation: "driftB 34s ease-in-out infinite", animationDelay: "-6s" },
  // The ONE orange glow — bottom-left, softened (less orange than before).
  { bottom: "-14%", left: "4%", width: "62%", height: "66%", background: "radial-gradient(closest-side, rgba(253,88,17,0.38), rgba(255,140,60,0.12) 55%, rgba(255,120,40,0) 76%)", filter: "blur(62px)", animation: "glowPulse 22s ease-in-out infinite" },
  // Was a 2nd left orange — now a cool blob so only one orange remains.
  { bottom: "-6%", left: "18%", width: "44%", height: "48%", background: "radial-gradient(closest-side, rgba(var(--cool2),0.5), rgba(var(--cool2),0) 70%)", filter: "blur(60px)", animation: "glowPulse 18s ease-in-out infinite", animationDelay: "-4s" },
  // Was an orange on the right — now cool, so the right side has no orange.
  { top: "22%", right: "-16%", width: "52%", height: "64%", background: "radial-gradient(closest-side, rgba(var(--cool3),0.5), rgba(var(--cool3),0) 70%)", filter: "blur(70px)", animation: "driftC 30s ease-in-out infinite", animationDelay: "-10s" },
  { bottom: "-20%", right: "-8%", width: "58%", height: "56%", background: "radial-gradient(closest-side, rgba(var(--cool3),0.55), rgba(var(--cool3),0) 72%)", filter: "blur(66px)", animation: "driftB 38s ease-in-out infinite", animationDelay: "-14s" },
];

export function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden="true">
      {BLOBS.map((style, i) => (
        <div key={i} className="blob" style={style} />
      ))}
    </div>
  );
}
