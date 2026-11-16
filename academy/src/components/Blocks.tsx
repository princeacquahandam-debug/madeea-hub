import type { Block } from "@/lib/api";
import { mediaUrl } from "@/lib/supabase";
import { Markdown } from "./Markdown";

/** YouTube, Vimeo and Loom links become an embedded player. */
export function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host.endsWith("youtube.com")) {
      const id = u.searchParams.get("v") ?? (u.pathname.startsWith("/embed/") || u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : null);
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return /^\d+$/.test(id ?? "") ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host === "player.vimeo.com") return url;
    if (host.endsWith("loom.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.loom.com/embed/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return <Markdown text={block.md} />;
    case "image": {
      const src = mediaUrl(block.path);
      return src ? (
        <figure className="my-5">
          <img src={src} alt={block.caption ?? ""} className="w-full rounded-xl border border-border object-cover" loading="lazy" />
          {block.caption && <figcaption className="mt-2 text-center text-xs text-faint">{block.caption}</figcaption>}
        </figure>
      ) : null;
    }
    case "video": {
      const file = mediaUrl(block.path);
      const embed = block.url ? embedUrl(block.url) : null;
      return (
        <figure className="my-5">
          {file ? (
            <video src={file} controls className="w-full rounded-xl border border-border bg-black" preload="metadata" />
          ) : embed ? (
            <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black" style={{ paddingTop: "56.25%" }}>
              <iframe src={embed} title={block.caption ?? "Video"} className="absolute inset-0 h-full w-full" allow="fullscreen; picture-in-picture" allowFullScreen />
            </div>
          ) : block.url ? (
            <a href={block.url} target="_blank" rel="noreferrer noopener" className="btn">Open the video</a>
          ) : null}
          {block.caption && <figcaption className="mt-2 text-center text-xs text-faint">{block.caption}</figcaption>}
        </figure>
      );
    }
    case "table":
      if (!block.rows.length) return null;
      return (
        <div className="my-5 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2">
              <tr>{block.rows[0].map((c, i) => <th key={i} className="px-3 py-2 font-semibold">{c}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((r, i) => (
                <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return <p className="text-sm text-faint">This lesson has no content yet.</p>;
  return <>{blocks.map((b, i) => <BlockView key={i} block={b} />)}</>;
}
