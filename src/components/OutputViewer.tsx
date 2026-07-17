import { useMemo, useState } from "react";
import { Copy, Check, FileDown } from "lucide-react";
import { exportToPdf } from "@/lib/exportPdf";
import { renderMarkdown } from "@/lib/sanitize";

type View = "formatted" | "markdown" | "html";

export function OutputViewer({ output, title }: { output: string; title: string }) {
  const [view, setView] = useState<View>("formatted");
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => renderMarkdown(output), [output]);

  function copy() {
    navigator.clipboard.writeText(view === "html" ? html : output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
          {(["formatted", "markdown", "html"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 capitalize transition-colors ${view === v ? "bg-accent text-white" : "text-muted hover:text-zinc-100"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost border border-border py-1.5 text-xs" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn-primary py-1.5 text-xs" onClick={() => exportToPdf(title, html)}>
            <FileDown size={13} /> Export PDF
          </button>
        </div>
      </div>

      {view === "formatted" && <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />}
      {view === "markdown" && <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm text-zinc-200">{output}</pre>}
      {view === "html" && <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-zinc-300">{html}</pre>}
    </div>
  );
}
