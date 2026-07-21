import { useMemo, useState } from "react";
import { Sparkles, CalendarDays, ListChecks, Check, FileText } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { MeetingPrepPacket } from "@/components/MeetingPrepPacket";
import { useClients, useMeetings, useTaskMutations } from "@/data/hooks";
import { useMeetingPreps } from "@/store/meetingPreps";
import { generate } from "@/lib/ai";
import { extractActions, extractionSummary, recapPromptInputs, type ActionItem } from "@/lib/meetingNotes";
import type { Meeting, Priority } from "@/types/db";

const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
const meetingLabel: Record<string, string> = {
  prepared: "Prepared",
  needs_prep: "Needs Prep",
  pending: "Pending",
};

export default function MeetingHelper() {
  const { data: meetings = [] } = useMeetings();
  const { data: clients = [] } = useClients();
  const preps = useMeetingPreps((s) => s.preps);
  const { create } = useTaskMutations();

  const [prepFor, setPrepFor] = useState<Meeting | null>(null);
  const [notesFor, setNotesFor] = useState<Meeting | null>(null);
  const [notes, setNotes] = useState("");
  // Extraction is deterministic, but the EA edits the result before anything is
  // created — so the edited list is state, re-seeded whenever the notes change.
  const [items, setItems] = useState<ActionItem[]>([]);
  const [recap, setRecap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(0);

  const now = Date.now();
  const { upcoming, past } = useMemo(() => {
    const withTime = meetings.filter((m) => m.starts_at);
    return {
      upcoming: withTime
        .filter((m) => new Date(m.starts_at!).getTime() >= now)
        .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime()),
      past: withTime
        .filter((m) => new Date(m.starts_at!).getTime() < now)
        .sort((a, b) => new Date(b.starts_at!).getTime() - new Date(a.starts_at!).getTime()),
    };
  }, [meetings, now]);

  function openNotes(m: Meeting) {
    setNotesFor(m);
    setNotes("");
    setItems([]);
    setRecap("");
    setCreated(0);
    setError("");
  }

  function onNotesChange(v: string) {
    setNotes(v);
    setItems(extractActions({ notes: v, clients, defaultClientId: notesFor?.client_id ?? null }));
    setCreated(0);
  }

  const patch = (id: string, p: Partial<ActionItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  async function createTasks() {
    const chosen = items.filter((i) => i.selected);
    for (const i of chosen) {
      await create.mutateAsync({
        title: i.title,
        priority: i.priority,
        due_at: i.due || null,
        client_id: i.client_id,
      });
    }
    setCreated(chosen.length);
  }

  async function writeRecap() {
    if (!notesFor) return;
    setBusy(true);
    setError("");
    setRecap("");
    try {
      const out = await generate({
        tool: "meeting_followup",
        format: `Recap — ${notesFor.title}`,
        inputs: recapPromptInputs(notesFor.title, notesFor.with, notes, items, clients),
      });
      setRecap(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the recap.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Meeting Helper"
        subtitle="Prep before, and follow-through after — notes become real tasks, with dates read from your own wording."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays size={16} className="text-accent-soft" />
            <h2 className="font-semibold">Coming up</h2>
            <span className="ml-auto text-xs text-faint">{upcoming.length}</span>
          </div>
          <div className="space-y-2">
            {upcoming.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="truncate text-xs text-faint">
                    {m.with} · {new Date(m.starts_at!).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                {preps[m.id] ? (
                  <Badge tone="done">Prepped</Badge>
                ) : (
                  <Badge tone={m.status}>{meetingLabel[m.status] ?? "Pending"}</Badge>
                )}
                <button
                  className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-accent/10 hover:text-accent"
                  onClick={() => setPrepFor(m)}
                  title="Prep packet"
                  aria-label={`Open prep packet for ${m.title}`}
                >
                  <Sparkles size={15} />
                </button>
              </div>
            ))}
            {upcoming.length === 0 && (
              <p className="py-4 text-center text-xs text-faint">Nothing scheduled ahead.</p>
            )}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks size={16} className="text-accent-soft" />
            <h2 className="font-semibold">Happened — capture the follow-through</h2>
            <span className="ml-auto text-xs text-faint">{past.length}</span>
          </div>
          <div className="space-y-2">
            {past.slice(0, 8).map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="truncate text-xs text-faint">
                    {m.with} · {new Date(m.starts_at!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <button
                  className={`btn-ghost border border-border py-1 text-xs ${notesFor?.id === m.id ? "border-accent text-accent" : ""}`}
                  onClick={() => openNotes(m)}
                >
                  Notes
                </button>
              </div>
            ))}
            {past.length === 0 && (
              <p className="py-4 text-center text-xs text-faint">No past meetings on record.</p>
            )}
          </div>
        </section>
      </div>

      {notesFor && (
        <section className="card mt-5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-semibold">After: {notesFor.title}</h2>
            <button className="ml-auto text-xs text-faint hover:text-zinc-100" onClick={() => setNotesFor(null)}>
              Close
            </button>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <label className="field-label">Your notes</label>
              <textarea
                className="input min-h-[220px] font-mono text-xs"
                placeholder={"e.g.\n- Bryan to send the revised deck by Friday\n- Priya will confirm the budget next week, it's urgent\n- Discussed Q3 hiring, no decision"}
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
              />
              <p className="mt-2 text-xs text-faint">{extractionSummary(notes, items)}</p>
              <p className="mt-2 text-[11px] leading-snug text-faint">
                Extraction is done in code, not by the AI — every item below comes from a line you
                actually typed, and dates are read from your wording rather than guessed.
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <p className="field-label mb-0">Action items</p>
                <button
                  className="btn-ghost ml-auto border border-border py-1 text-xs"
                  onClick={createTasks}
                  disabled={create.isPending || !items.some((i) => i.selected)}
                >
                  {create.isPending ? "Creating…" : created ? `Created ${created}` : "Create tasks"}
                </button>
              </div>

              <div className="space-y-2">
                {items.map((i) => (
                  <div
                    key={i.id}
                    className={`rounded-lg border p-3 ${i.selected ? "border-border bg-surface-2" : "border-border/50 bg-surface-2/40 opacity-60"}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => patch(i.id, { selected: !i.selected })}
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          i.selected ? "border-accent bg-accent text-white" : "border-border"
                        }`}
                        aria-label={i.selected ? `Exclude ${i.title}` : `Include ${i.title}`}
                      >
                        {i.selected && <Check size={11} />}
                      </button>
                      <input
                        className="input py-1 text-sm"
                        value={i.title}
                        onChange={(e) => patch(i.id, { title: e.target.value })}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                      <input
                        type="date"
                        className="input w-auto py-1 text-xs"
                        value={i.due}
                        onChange={(e) => patch(i.id, { due: e.target.value })}
                      />
                      <select
                        className="input w-auto py-1 text-xs"
                        value={i.priority}
                        onChange={(e) => patch(i.id, { priority: e.target.value as Priority })}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <select
                        className="input w-auto py-1 text-xs"
                        value={i.client_id ?? ""}
                        onChange={(e) => patch(i.id, { client_id: e.target.value || null })}
                      >
                        <option value="">No client</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {i.owner && <Badge tone="reply">{i.owner}</Badge>}
                    </div>

                    <p className="mt-2 pl-6 text-[11px] italic text-faint">from: “{i.source}”</p>
                  </div>
                ))}
                {!items.length && (
                  <p className="py-6 text-center text-xs text-faint">
                    Action items appear here as you type.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-3 flex items-center gap-2">
              <p className="field-label mb-0">Recap message</p>
              <button
                className="btn-primary ml-auto py-1.5 text-xs"
                onClick={writeRecap}
                disabled={busy || !notes.trim()}
              >
                <Sparkles size={14} />
                {busy ? "Writing…" : "Write the recap"}
              </button>
            </div>
            {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
            {recap ? (
              <OutputViewer output={recap} title={`Recap — ${notesFor.title}`} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-faint">
                <FileText size={24} />
                <p className="text-xs">The AI writes the recap prose — it doesn't decide what was agreed</p>
              </div>
            )}
          </div>
        </section>
      )}

      <MeetingPrepPacket meeting={prepFor} open={Boolean(prepFor)} onClose={() => setPrepFor(null)} />
    </div>
  );
}
