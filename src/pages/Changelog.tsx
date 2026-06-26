import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { CHANGELOG, APP_VERSION } from "@/lib/changelog";

function fmtDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function Changelog() {
  return (
    <div>
      <PageHeader title="What's new" subtitle={`You're on version ${APP_VERSION}`} />

      <div className="max-w-2xl space-y-4">
        {CHANGELOG.map((rel, i) => (
          <section key={rel.version} className="card p-5">
            <div className="flex items-center gap-2">
              {i === 0 && <Sparkles size={16} className="text-accent-soft" />}
              <h3 className="font-display text-lg">{rel.title}</h3>
              {i === 0 && <span className="pill bg-accent/15 text-[10px] text-accent-soft">Latest</span>}
            </div>
            <p className="mt-0.5 text-xs text-faint">v{rel.version} · {fmtDate(rel.date)}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted">
              {rel.changes.map((c, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-0.5 text-accent-soft">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
