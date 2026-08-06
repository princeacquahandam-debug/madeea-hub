// Madeline's animated "orb" — a morphing gradient sphere wrapped in a cloud of
// 60 orbiting particles (3D). The orbit geometry is authored for a 126px logical
// sphere (see orb.css keyframes) and scaled to the requested display size.
//
// NOTE: the scale lives on a dedicated wrapper, NOT on `.orb-float`. The float
// animation drives `transform`, which would otherwise clobber an inline scale
// and render the orb at full 126px.
const LOGICAL = 126;
// Many more particles than orbit keyframes (60) — extras reuse orbits with
// distinct durations/delays so the cloud looks dense without new keyframes.
const COUNT = 150;
// Deterministic pseudo-random so each particle keeps a stable size/shade.
const rand = (n: number) => {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
};
const PARTICLES = Array.from({ length: COUNT }, (_, i) => ({
  size: (1.8 + rand(i + 1) * 4).toFixed(2), // 1.8 – 5.8px
  hue: Math.round(8 + rand(i + 7) * 28), // 8 – 36 : deep orange → amber
  light: Math.round(44 + rand(i + 13) * 34), // 44% – 78%
  duration: (4 + ((i * 7) % 30) / 10).toFixed(2),
  delay: (i * 0.011).toFixed(2),
  orbit: `orbit${(i % 60) + 1}`,
}));

export function Orb({ size = 44 }: { size?: number }) {
  const scale = size / LOGICAL;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size, overflow: "visible" }} aria-hidden="true">
      {/* Scaling wrapper (no animation) so the scale is never overridden. */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{ width: LOGICAL, height: LOGICAL, marginLeft: -LOGICAL / 2, marginTop: -LOGICAL / 2, transform: `scale(${scale})`, overflow: "visible" }}
      >
        <div className="orb-float relative h-full w-full">
          <div className="orb-sphere" />
          <div className="orb-spin">
            {PARTICLES.map((p, i) => (
              <span
                key={i}
                className="orb-particle"
                style={{
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  background: `hsl(${p.hue},100%,${p.light}%)`,
                  animation: `${p.orbit} ${p.duration}s ease-in-out infinite`,
                  animationDelay: `${p.delay}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
