import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Image as ImageIcon, Minus, Plus, Table2, Trash2, Type, Upload, Video } from "lucide-react";
import type { Block } from "@/lib/api";
import { mediaUrl, uploadMedia } from "@/lib/supabase";
import { BlockView, embedUrl } from "./Blocks";

/**
 * Lesson content as blocks: text, image, video, table (11 and 16 Nov calls:
 * "at each section you can upload image, video, tables"). Each block can be
 * moved and removed; images and videos upload to the academy-media bucket.
 */
export function BlockEditor({ blocks, onChange, workspaceId }: { blocks: Block[]; onChange: (b: Block[]) => void; workspaceId: string }) {
  const set = (i: number, b: Block) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const n = [...blocks];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const add = (b: Block) => onChange([...blocks, b]);

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <div key={i} className="rounded-lg border border-border bg-bg p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-faint">
            <span className="flex-1">{b.type === "text" ? "Text" : b.type === "image" ? "Image" : b.type === "video" ? "Video" : "Table"}</span>
            <button className="btn-ghost !h-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
            <button className="btn-ghost !h-7" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
            <button className="btn-ghost !h-7" onClick={() => onChange(blocks.filter((_, j) => j !== i))} aria-label="Remove block"><Trash2 size={14} /></button>
          </div>
          {b.type === "text" && (
            <>
              <textarea className="textarea font-mono text-[13px]" rows={Math.min(18, Math.max(4, b.md.split("\n").length + 1))} value={b.md}
                onChange={(e) => set(i, { ...b, md: e.target.value })} placeholder="Write the lesson. ## Heading, - bullet, **bold**, [link](https://…)" />
              <p className="mt-1 text-[11px] text-faint">## heading · - bullet · 1. numbered · **bold** · *italic* · [link](https://…)</p>
            </>
          )}
          {b.type === "image" && <ImageBlock block={b} onChange={(nb) => set(i, nb)} workspaceId={workspaceId} />}
          {b.type === "video" && <VideoBlock block={b} onChange={(nb) => set(i, nb)} workspaceId={workspaceId} />}
          {b.type === "table" && <TableBlock block={b} onChange={(nb) => set(i, nb)} />}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => add({ type: "text", md: "" })}><Type size={14} />Text</button>
        <button className="btn" onClick={() => add({ type: "image", path: "" })}><ImageIcon size={14} />Image</button>
        <button className="btn" onClick={() => add({ type: "video", url: "" })}><Video size={14} />Video</button>
        <button className="btn" onClick={() => add({ type: "table", rows: [["Column 1", "Column 2"], ["", ""]] })}><Table2 size={14} />Table</button>
      </div>
    </div>
  );
}

function useUpload(workspaceId: string, kind: string) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (file: File) => {
    setBusy(true); setErr(null);
    try { return await uploadMedia(workspaceId, file, kind); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); return null; }
    finally { setBusy(false); }
  };
  return { busy, err, run };
}

function ImageBlock({ block, onChange, workspaceId }: { block: Extract<Block, { type: "image" }>; onChange: (b: Block) => void; workspaceId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const up = useUpload(workspaceId, "images");
  const src = mediaUrl(block.path);
  return (
    <div className="space-y-2">
      {src && <img src={src} alt="" className="max-h-64 rounded-lg border border-border object-contain" />}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (f) { const p = await up.run(f); if (p) onChange({ ...block, path: p }); }
      }} />
      <button className="btn" onClick={() => input.current?.click()} disabled={up.busy}><Upload size={14} />{up.busy ? "Uploading…" : src ? "Replace image" : "Upload image"}</button>
      {up.err && <p className="text-sm text-accent-soft">{up.err}</p>}
      <input className="input" placeholder="Caption (optional)" value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
    </div>
  );
}

function VideoBlock({ block, onChange, workspaceId }: { block: Extract<Block, { type: "video" }>; onChange: (b: Block) => void; workspaceId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const up = useUpload(workspaceId, "videos");
  const bad = block.url && !block.path && !embedUrl(block.url);
  return (
    <div className="space-y-2">
      {block.path ? (
        <div className="flex items-center gap-2 text-sm"><span className="chip-good">Uploaded video</span>
          <button className="btn-ghost" onClick={() => onChange({ type: "video", url: "", caption: block.caption })}>Use a link instead</button></div>
      ) : (
        <input className="input" placeholder="YouTube, Vimeo or Loom link" value={block.url ?? ""} onChange={(e) => onChange({ ...block, url: e.target.value })} />
      )}
      {bad && <p className="text-xs text-warn">That link can't be embedded; learners will get an "Open the video" button instead.</p>}
      <input ref={input} type="file" accept="video/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (f) { const p = await up.run(f); if (p) onChange({ type: "video", path: p, caption: block.caption }); }
      }} />
      {!block.path && <button className="btn" onClick={() => input.current?.click()} disabled={up.busy}><Upload size={14} />{up.busy ? "Uploading…" : "Or upload a video (50 MB max)"}</button>}
      {up.err && <p className="text-sm text-accent-soft">{up.err}</p>}
      <input className="input" placeholder="Caption (optional)" value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
      {(block.path || (block.url && embedUrl(block.url))) && <div className="max-w-md"><BlockView block={block} /></div>}
    </div>
  );
}

function TableBlock({ block, onChange }: { block: Extract<Block, { type: "table" }>; onChange: (b: Block) => void }) {
  const rows = block.rows.length ? block.rows : [[""]];
  const cols = Math.max(...rows.map((r) => r.length));
  const setCell = (r: number, c: number, v: string) =>
    onChange({ type: "table", rows: rows.map((row, i) => (i === r ? Array.from({ length: cols }, (_, j) => (j === c ? v : row[j] ?? "")) : row)) });
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="text-sm">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {Array.from({ length: cols }, (_, ci) => (
                  <td key={ci} className="p-0.5">
                    <input className={`input !h-8 min-w-[8rem] ${ri === 0 ? "font-semibold" : ""}`} value={r[ci] ?? ""} placeholder={ri === 0 ? "Heading" : ""}
                      onChange={(e) => setCell(ri, ci, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-1">
        <button className="btn-ghost" onClick={() => onChange({ type: "table", rows: [...rows, Array(cols).fill("")] })}><Plus size={13} />Row</button>
        <button className="btn-ghost" onClick={() => rows.length > 2 && onChange({ type: "table", rows: rows.slice(0, -1) })} disabled={rows.length <= 2}><Minus size={13} />Row</button>
        <button className="btn-ghost" onClick={() => onChange({ type: "table", rows: rows.map((r) => [...r, ""]) })}><Plus size={13} />Column</button>
        <button className="btn-ghost" onClick={() => cols > 1 && onChange({ type: "table", rows: rows.map((r) => r.slice(0, cols - 1)) })} disabled={cols <= 1}><Minus size={13} />Column</button>
      </div>
    </div>
  );
}
