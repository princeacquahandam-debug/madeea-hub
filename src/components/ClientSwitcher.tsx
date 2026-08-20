import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, ChevronsUpDown, Search, Check, Undo2, Users } from "lucide-react";
import { useMyClients } from "@/data/hooks";
import { useClientContext } from "@/store/clientContext";
import { cn, initials } from "@/lib/utils";

/**
 * The client switcher, modelled on GoHighLevel's sub-account picker.
 *
 * Three things make that control work, and all three are load-bearing:
 *
 *   1. It is the FIRST thing in the sidebar, so the answer to "whose work am I
 *      looking at" is never more than a glance away. A scoped view that looks
 *      unscoped is genuinely dangerous: you conclude you have no tasks when in
 *      fact you filtered them out an hour ago and forgot.
 *   2. It searches. Past about a dozen entries a plain list stops being usable,
 *      and an agency's whole point is having more clients than that.
 *   3. There is always a way back out. GHL calls it Switch to Agency View; here
 *      it is All clients, and it is pinned above the list rather than buried as
 *      the first row, so it cannot scroll away.
 *
 * The list is already restricted to the EA's own clients by useMyClients. This
 * control narrows what is DISPLAYED and is never what keeps one EA out of
 * another's data; RLS does that. A filter dressed up as a permission is how
 * leaks ship.
 */
export function ClientSwitcher({ collapsed }: { collapsed?: boolean }) {
  const clients = useMyClients();
  const { clientId, setClient } = useClientContext();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const active = clients.find((c) => c.id === clientId) ?? null;

  /* A persisted id can outlive the thing it points at: the client is deleted,
     or reassigned to another EA and drops out of this list. Left alone, every
     screen would filter to a client that no longer exists and show nothing,
     with no clue why. Fall back to All instead. */
  useEffect(() => {
    if (clientId && clients.length > 0 && !clients.some((c) => c.id === clientId)) {
      setClient(null);
    }
  }, [clientId, clients, setClient]);

  // Close on outside click and on Escape (§1 escape-routes).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQ("");
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((c) =>
      [c.name, c.company, c.title].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [clients, q]);

  function choose(id: string | null) {
    setClient(id);
    setOpen(false);
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={active ? `Working on ${active.name}` : "All clients"}
        aria-label={active ? `Working on ${active.name}. Change client.` : "All clients. Change client."}
        className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
      >
        {active ? (
          <span className="text-[11px] font-bold">{initials(active.name)}</span>
        ) : (
          <Users size={18} />
        )}
      </button>
    );
  }

  return (
    <div ref={boxRef} className="relative px-3 pb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex min-h-[48px] w-full items-center gap-2.5 rounded-xl border px-2.5 text-left transition-colors",
          active
            ? "border-[var(--border-strong)] bg-[var(--nav-active-bg)]"
            : "border-border hover:bg-[var(--chip-bg)]",
        )}
      >
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold",
            active ? "bg-accent/20 text-accent-soft" : "bg-[var(--chip-bg)] text-muted",
          )}
        >
          {active ? initials(active.name) : <Users size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">
            {active ? active.name : "All clients"}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {active ? active.company || active.title || "Client" : `${clients.length} assigned to you`}
          </span>
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-faint" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Choose a client"
          className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-surface shadow-2xl"
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <label htmlFor="client-search" className="sr-only">Search clients</label>
              <input
                ref={searchRef}
                id="client-search"
                className="input h-9 pl-8 text-[13px]"
                placeholder="Search for a client"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          {/* Pinned, not the first row of the list. The way out must not be
              something you have to scroll back up to find. */}
          <button
            onClick={() => choose(null)}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-[13px] font-medium text-accent transition-colors hover:bg-[var(--chip-bg)]"
          >
            <Undo2 size={14} className="shrink-0" />
            <span className="flex-1">All clients</span>
            {!active && <Check size={14} className="shrink-0" />}
          </button>

          <div className="max-h-[280px] overflow-y-auto p-1">
            {filtered.length === 0 && clients.length > 0 && (
              <p className="px-3 py-6 text-center text-[12.5px] text-faint">
                No client matches "{q}".
              </p>
            )}

            {/* The state this will actually launch in, so it says what to do
                rather than looking broken. Nothing is assigned yet: no client
                record has a lead EA. */}
            {clients.length === 0 && (
              <div className="px-3 py-5 text-center">
                <Building2 size={20} className="mx-auto mb-1.5 text-faint" />
                <p className="text-[12.5px] font-medium">No clients assigned to you</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
                  A client appears here once someone sets you as its lead EA.
                </p>
                <Link
                  to="/clients"
                  onClick={() => setOpen(false)}
                  className="mt-2 inline-block text-[12px] font-medium text-accent hover:underline"
                >
                  Open the Client Vault
                </Link>
              </div>
            )}

            {filtered.map((c) => {
              const on = c.id === clientId;
              return (
                <button
                  key={c.id}
                  role="option"
                  aria-selected={on}
                  onClick={() => choose(c.id)}
                  className={cn(
                    "flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
                    on ? "bg-[var(--nav-active-bg)]" : "hover:bg-[var(--chip-bg)]",
                  )}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--chip-bg)] text-[10px] font-bold text-muted">
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{c.name}</span>
                    {(c.company || c.title) && (
                      <span className="block truncate text-[11px] text-faint">
                        {[c.title, c.company].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </span>
                  {on && <Check size={14} className="shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The reminder that a page is filtered.
 *
 * Shown on every screen the context narrows. Without it a scoped page is
 * indistinguishable from an empty one, and the conclusion somebody draws is
 * "there is no work here" rather than "I am looking at one client".
 */
export function ClientScopeBanner({ note }: { note?: string }) {
  const clients = useMyClients();
  const { clientId, setClient } = useClientContext();
  const active = clients.find((c) => c.id === clientId);
  if (!active) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--nav-active-bg)] px-3 py-2 text-[12.5px]">
      <Building2 size={14} className="shrink-0 text-accent" />
      <span>
        Showing <span className="font-semibold">{active.name}</span> only.
        {note ? ` ${note}` : ""}
      </span>
      <button
        onClick={() => setClient(null)}
        className="ml-auto shrink-0 font-medium text-accent hover:underline"
      >
        Show all clients
      </button>
    </div>
  );
}
