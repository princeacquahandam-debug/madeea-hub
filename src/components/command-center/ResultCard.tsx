/**
 * ResultCard — renders a resolved ToolResult by kind (text, created, navigate,
 * search, entity, error). Text output reuses the app's markdown pipeline
 * (renderMarkdown + .md-body) so AI answers match the Communication Studio styling.
 */
import { useMemo, useState } from "react";
import { Copy, Check, ArrowUpRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { ENTITY_META } from "./entityMeta";
import { renderMarkdown } from "@/lib/sanitize";
import type { ToolResult } from "@/lib/command-center/types";

export function ResultCard({ result, onNavigate }: { result: ToolResult; onNavigate: (path: string) => void }) {
  if (result.kind === "text") return <TextResult title={result.title} markdown={result.markdown} />;

  if (result.kind === "created") {
    return (
      <div className="cc-glass-soft flex items-start gap-3 rounded-xl p-3">
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">{result.title}</p>
          {result.detail && <p className="truncate text-xs text-faint">{result.detail}</p>}
        </div>
        {result.path && (
          <button className="btn-ghost shrink-0 border border-border px-2 py-1 text-xs" onClick={() => onNavigate(result.path!)}>
            Open <ArrowUpRight size={12} />
          </button>
        )}
      </div>
    );
  }

  if (result.kind === "navigate") {
    return (
      <button className="cc-glass-soft flex w-full items-center gap-2 rounded-xl p-3 text-left text-sm text-zinc-100 hover:bg-white/5" onClick={() => onNavigate(result.path)}>
        <ArrowUpRight size={15} className="text-accent" /> Opened <span className="font-medium">{result.label}</span>
      </button>
    );
  }

  if (result.kind === "search") {
    if (!result.results.length) return <p className="px-1 py-2 text-sm text-faint">No matches for “{result.query}”.</p>;
    return (
      <div className="cc-glass-soft overflow-hidden rounded-xl">
        {result.results.map((r) => {
          const Icon = ENTITY_META[r.type].icon;
          return (
            <button key={r.id} onClick={() => onNavigate(r.path)} className="flex w-full items-center gap-3 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-white/5">
              <Icon size={14} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-100">{r.label}</span>
                {r.sub && <span className="block truncate text-xs text-faint">{r.sub}</span>}
              </span>
              <span className="pill shrink-0 bg-surface-2 text-[10px] text-faint">{ENTITY_META[r.type].label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (result.kind === "entity") {
    return (
      <button className="cc-glass-soft flex w-full items-center gap-2 rounded-xl p-3 text-left hover:bg-white/5" onClick={() => result.path && onNavigate(result.path)}>
        <span className="text-sm text-zinc-100">{result.title}</span>
        {result.subtitle && <span className="text-xs text-faint">{result.subtitle}</span>}
      </button>
    );
  }

  // error
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{result.message}</span>
    </div>
  );
}

function TextResult({ title, markdown }: { title?: string; markdown: string }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const copy = () => {
    navigator.clipboard?.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="cc-glass-soft rounded-xl p-3">
      <div className="mb-2 flex items-center gap-2">
        {title && <span className="eyebrow">{title}</span>}
        <button className="btn-ghost ml-auto border border-border px-2 py-1 text-xs" onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="md-body max-h-[38vh] overflow-y-auto" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
