import { useEffect, useRef, useState } from "react";
import { Search, Users, CheckSquare, Mail, ClipboardCheck, StickyNote } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useClients, useTasks, useMessages, useSops, useNotes } from "@/data/hooks";
import { noteHeading } from "@/lib/notes";

export function GlobalSearch() {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: sops = [] } = useSops();
  const { data: notes = [] } = useNotes();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const term = q.trim().toLowerCase();
  const r = term
    ? {
        clients: clients.filter((c) => `${c.name} ${c.company} ${c.title}`.toLowerCase().includes(term)).slice(0, 5),
        tasks: tasks.filter((t) => `${t.title} ${t.client_name}`.toLowerCase().includes(term)).slice(0, 5),
        messages: messages.filter((m) => `${m.subject} ${m.sender_name} ${m.preview}`.toLowerCase().includes(term)).slice(0, 5),
        sops: sops.filter((s) => `${s.title} ${s.description} ${s.category}`.toLowerCase().includes(term)).slice(0, 5),
        notes: notes.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(term)).slice(0, 5),
      }
    : null;
  const total = r ? r.clients.length + r.tasks.length + r.messages.length + r.sops.length + r.notes.length : 0;

  function go(path: string) {
    nav(path);
    setOpen(false);
    setQ("");
  }

  return (
    <div className="relative" ref={ref}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        className="input w-56 pl-9 lg:w-72"
        // The placeholder is not an accessible name: it isn't reliably announced
        // and it disappears as soon as anything is typed.
        aria-label="Search clients, tasks and emails"
        placeholder="Search clients, tasks, emails..."
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && term && (
        <div className="card absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto p-2 shadow-xl">
          {total === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-faint">No matches for "{q}"</p>
          ) : (
            <>
              <Group title="Clients" icon={Users} items={r!.clients.map((c) => ({ key: c.id, label: c.name, sub: c.company }))} onPick={() => go("/clients")} />
              <Group title="Tasks" icon={CheckSquare} items={r!.tasks.map((t) => ({ key: t.id, label: t.title, sub: t.client_name }))} onPick={() => go("/tasks")} />
              <Group title="Messages" icon={Mail} items={r!.messages.map((m) => ({ key: m.id, label: m.subject, sub: m.sender_name }))} onPick={() => go("/communication")} />
              <Group title="SOPs" icon={ClipboardCheck} items={r!.sops.map((s) => ({ key: s.id, label: s.title, sub: s.category }))} onPick={() => go("/sops")} />
              <Group title="Notes" icon={StickyNote} items={r!.notes.map((n) => ({ key: n.id, label: noteHeading(n), sub: "Note" }))} onPick={() => go("/notes")} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  title, icon: Icon, items, onPick,
}: {
  title: string;
  icon: typeof Users;
  items: { key: string; label: string; sub: string }[];
  onPick: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1">
      <p className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
        <Icon size={11} /> {title}
      </p>
      {items.map((i) => (
        <button key={i.key} onClick={onPick} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
          <span className="block truncate text-sm">{i.label}</span>
          <span className="block truncate text-xs text-faint">{i.sub}</span>
        </button>
      ))}
    </div>
  );
}
