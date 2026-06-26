import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Star, CornerDownLeft } from "lucide-react";
import { NAV } from "@/lib/constants";
import { useClients, useTasks, useMessages, useSops } from "@/data/hooks";
import { useFavorites } from "@/store/favorites";
import { cn } from "@/lib/utils";

interface Item { id: string; label: string; sub?: string; path: string; favable?: boolean }

// Global ⌘/Ctrl-K command palette: jump to any page, find any record, pin favorites.
export function CommandPalette() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { favorites, toggle, isFav } = useFavorites();
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: sops = [] } = useSops();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const term = q.trim().toLowerCase();
  const pages: Item[] = NAV.map((n) => ({ id: `page:${n.to}`, label: n.label, sub: n.group, path: n.to, favable: true }));

  const sections = useMemo(() => {
    if (!term) {
      const favItems: Item[] = favorites.map((f) => ({ id: f.id, label: f.label, sub: "Favorite", path: f.path, favable: true }));
      return [
        ...(favItems.length ? [{ title: "Favorites", items: favItems }] : []),
        { title: "Jump to", items: pages },
      ];
    }
    const filteredPages = pages.filter((p) => p.label.toLowerCase().includes(term));
    const records: Item[] = [
      ...clients.filter((c) => `${c.name} ${c.company}`.toLowerCase().includes(term)).slice(0, 4).map((c) => ({ id: `c:${c.id}`, label: c.name, sub: c.company, path: "/clients" })),
      ...tasks.filter((t) => t.title.toLowerCase().includes(term)).slice(0, 4).map((t) => ({ id: `t:${t.id}`, label: t.title, sub: "Task", path: "/tasks" })),
      ...messages.filter((m) => `${m.subject} ${m.sender_name}`.toLowerCase().includes(term)).slice(0, 4).map((m) => ({ id: `m:${m.id}`, label: m.subject, sub: m.sender_name, path: "/communication" })),
      ...sops.filter((s) => s.title.toLowerCase().includes(term)).slice(0, 4).map((s) => ({ id: `s:${s.id}`, label: s.title, sub: "SOP", path: "/sops" })),
    ];
    return [
      ...(filteredPages.length ? [{ title: "Pages", items: filteredPages }] : []),
      ...(records.length ? [{ title: "Records", items: records }] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, favorites, clients, tasks, messages, sops]);

  const flat = sections.flatMap((s) => s.items);
  useEffect(() => { setSel(0); }, [term]);

  function activate(item: Item) { nav(item.path); setOpen(false); }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[sel]) activate(flat[sel]); }
  }

  if (!open) return null;

  let idx = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="card w-full max-w-lg overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} className="text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search or jump to…"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-faint"
          />
          <kbd className="pill bg-surface-2 text-faint">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-faint">No results for "{q}"</p>
          ) : (
            sections.map((sec) => (
              <div key={sec.title} className="mb-1">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{sec.title}</p>
                {sec.items.map((item) => {
                  idx++;
                  const myIdx = idx;
                  const active = myIdx === sel;
                  return (
                    <div
                      key={item.id}
                      onMouseEnter={() => setSel(myIdx)}
                      className={cn("flex items-center gap-2 rounded-md px-2 py-2", active && "bg-surface-2")}
                    >
                      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => activate(item)}>
                        <span className="truncate text-sm">{item.label}</span>
                        {item.sub && <span className="ml-auto truncate text-xs text-faint">{item.sub}</span>}
                      </button>
                      {item.favable && (
                        <button onClick={() => toggle({ id: item.id, label: item.label, path: item.path })} aria-label="Pin to favorites">
                          <Star size={14} className={isFav(item.id) ? "fill-accent text-accent" : "text-faint hover:text-accent"} />
                        </button>
                      )}
                      {active && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
