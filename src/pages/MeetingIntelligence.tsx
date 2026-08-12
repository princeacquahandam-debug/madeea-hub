import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Brain, RefreshCw, Loader2, CheckSquare, GitBranch, HelpCircle, Handshake,
  Lightbulb, Quote, ExternalLink, AlertTriangle, KeyRound, ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useMeetingNotes, useMeetingDecisions, useFathomSync } from "@/data/hooks";
import { syncMeetings, intelStatus } from "@/lib/meetingIntel";
import type { MeetingNote } from "@/types/db";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

export default function MeetingIntelligence() {
  const qc = useQueryClient();
  const { data: notes = [], isLoading } = useMeetingNotes();
  const { data: decisions = [] } = useMeetingDecisions();
  const { data: sync } = useFathomSync();

  const [tab, setTab] = useState<"meetings" | "decisions">("meetings");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [more, setMore] = useState(false);
  const [configured, setConfigured] = useState<{ fathom: boolean; model: boolean } | null>(null);

  useEffect(() => { intelStatus().then((s) => setConfigured(s.configured)).catch(() => {}); }, []);

  // Either secret missing blocks a sync. Reported one at a time. Both banners at
  // once reads as two problems when it is one unfinished setup, and Fathom comes
  // first because there is nothing to extract from until it answers.
  const missingKey: "FATHOM_API_KEY" | "OPENAI_API_KEY" | null =
    configured === null ? null
      : !configured.fathom ? "FATHOM_API_KEY"
      : !configured.model ? "OPENAI_API_KEY"
      : null;

  const selected = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? notes[0] ?? null,
    [notes, selectedId],
  );

  async function run() {
    setBusy(true); setError(""); setHint("");
    try {
      const r = await syncMeetings(3);
      setMore(r.more);
      qc.invalidateQueries({ queryKey: ["meeting-notes"] });
      qc.invalidateQueries({ queryKey: ["meeting-decisions"] });
      qc.invalidateQueries({ queryKey: ["fathom-sync"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["memories"] });
      setHint(
        r.processed === 0 && r.skipped === 0
          ? "Nothing new in Fathom."
          : `Read ${r.processed} meeting${r.processed === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped} already done` : ""} → ` +
            `${r.tasksCreated} task${r.tasksCreated === 1 ? "" : "s"}, ${r.decisionsLogged} decision${r.decisionsLogged === 1 ? "" : "s"}, ` +
            `${r.memoriesWritten} to memory.` + (r.failures.length ? ` Couldn't extract: ${r.failures.join(", ")}.` : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Meeting Intelligence" subtitle="The tasks, decisions and memory hiding inside your Fathom transcripts" />

      {/* status + sync */}
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <button className="btn-primary" onClick={run} disabled={busy || missingKey !== null}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {busy ? "Reading transcripts…" : more ? "Keep going" : "Sync from Fathom"}
        </button>

        {sync && (
          <div className="flex flex-wrap gap-1.5">
            <span className="pill bg-surface-2 text-muted">{sync.meetings_seen} meetings read</span>
            <span className="pill bg-emerald-500/15 text-emerald-400">{sync.tasks_created} tasks</span>
            <span className="pill bg-sky-500/15 text-sky-400">{sync.decisions_logged} decisions</span>
            <span className="pill bg-violet-500/15 text-violet-300">{sync.memories_written} to memory</span>
          </div>
        )}
        {sync?.last_synced_at && (
          <span className="ml-auto text-xs text-faint">Last run {new Date(sync.last_synced_at).toLocaleString()}</span>
        )}
      </div>

      {missingKey && (
        <div className="card mb-4 flex items-start gap-2 p-4 text-sm text-muted">
          <KeyRound size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <span>
            Add <code className="text-zinc-200">{missingKey}</code> to your Supabase secrets and redeploy the
            <code className="mx-1 text-zinc-200">meeting-intelligence</code> function
            {missingKey === "FATHOM_API_KEY"
              ? ", it's the source the sync reads from."
              : ", it's the model that does the extracting."}
            {" "}Syncing is disabled until then, so no meeting gets marked unreadable over a missing key.
            Everything already extracted stays readable.
          </span>
        </div>
      )}
      {more && !busy && !error && (
        <div className="card mb-4 flex items-center gap-2 p-3 text-sm text-muted">
          <ArrowRight size={15} className="shrink-0 text-accent-soft" />
          There&apos;s more history behind this batch. Press <span className="text-zinc-200">Keep going</span> to work back through it.
        </div>
      )}
      {error && (
        <div className="card mb-4 flex items-start gap-2 p-3 text-sm text-red-400">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {hint && !error && <div className="card mb-4 p-3 text-sm text-muted">{hint}</div>}

      <div className="mb-4 flex gap-2">
        {(["meetings", "decisions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100"}`}
          >
            {t === "meetings" ? `Meetings (${notes.length})` : `Decisions log (${decisions.length})`}
          </button>
        ))}
      </div>

      {tab === "meetings" && (
        isLoading ? (
          <p className="text-sm text-faint">Loading…</p>
        ) : notes.length === 0 ? (
          <div className="card p-10 text-center text-sm text-faint">
            No meetings read yet. Press <span className="text-zinc-300">Sync from Fathom</span>· it works through your
            history a few at a time, so you can start now and keep going.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            <div className="card p-3">
              <div className="max-h-[620px] space-y-1 overflow-y-auto">
                {notes.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    className={`w-full rounded-lg p-3 text-left transition-colors ${selected?.id === n.id ? "bg-surface-2" : "hover:bg-surface-2"}`}
                  >
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    <p className="mt-0.5 text-xs text-faint">{fmtDate(n.recorded_at)}</p>
                    {n.status === "failed" ? (
                      <span className="pill mt-1.5 bg-red-500/15 text-red-400">couldn&apos;t extract</span>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Count n={n.extracted.action_items?.length} label="tasks" />
                        <Count n={n.extracted.decisions?.length} label="decisions" />
                        <Count n={n.extracted.open_questions?.length} label="questions" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div>{selected ? <NoteDetail note={selected} /> : null}</div>
          </div>
        )
      )}

      {tab === "decisions" && (
        <div className="card p-5">
          <p className="mb-4 text-xs text-faint">
            Append-only. Every entry cites the line it came from, and nothing here can be edited or deleted, a
            decision log you can quietly rewrite isn&apos;t one.
          </p>
          {decisions.length === 0 ? (
            <p className="py-8 text-center text-sm text-faint">No decisions logged yet.</p>
          ) : (
            <ol className="space-y-3">
              {decisions.map((d) => (
                <li key={d.id} className="rounded-lg bg-surface-2 p-3.5">
                  <p className="text-sm font-medium">{d.decision}</p>
                  {d.context && <p className="mt-1 text-xs text-muted">{d.context}</p>}
                  {d.quote && <QuoteLine text={d.quote} stamp={d.timestamp_label} />}
                  <p className="mt-2 text-[11px] text-faint">{fmtDate(d.decided_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function Count({ n, label }: { n?: number; label: string }) {
  if (!n) return null;
  return <span className="pill bg-surface-2 text-faint">{n} {label}</span>;
}

function QuoteLine({ text, stamp }: { text: string; stamp?: string | null }) {
  return (
    <p className="mt-2 flex gap-1.5 border-l-2 border-border pl-2.5 text-xs italic text-faint">
      <Quote size={11} className="mt-0.5 shrink-0" />
      <span>
        “{text}”{stamp ? <span className="not-italic"> · {stamp}</span> : null}
      </span>
    </p>
  );
}

function Section({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <h4 className="flex items-center gap-2 text-sm font-semibold">{icon} {title}</h4>
      {subtitle && <p className="mb-3 mt-1 text-xs text-faint">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

function NoteDetail({ note }: { note: MeetingNote }) {
  const e = note.extracted ?? {};
  const items = e.action_items ?? [];
  const decisions = e.decisions ?? [];
  const questions = e.open_questions ?? [];
  const commitments = e.commitments ?? [];
  const insights = e.insights ?? [];

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{note.title}</h3>
            <p className="mt-0.5 text-xs text-faint">
              {fmtDate(note.recorded_at)}
              {note.attendees.length ? ` · ${note.attendees.length} invited` : ""}
              {note.transcript_chars ? ` · ${Math.round(note.transcript_chars / 1000)}k chars` : ""}
            </p>
          </div>
          {(note.share_url || note.meeting_url) && (
            <a
              className="pill bg-surface-2 text-muted"
              href={note.share_url || note.meeting_url || "#"}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={12} /> Fathom
            </a>
          )}
        </div>
        {note.status === "failed" ? (
          <p className="mt-3 text-sm text-red-400">{note.error ?? "Extraction failed."}</p>
        ) : (
          note.summary && <p className="mt-3 text-sm text-muted">{note.summary}</p>
        )}
      </div>

      {items.length > 0 && (
        <Section
          icon={<CheckSquare size={14} className="text-emerald-400" />}
          title={`Action items (${items.length})`}
          subtitle="Already on the task board. These aren't a second copy to work from."
        >
          <ul className="space-y-2.5">
            {items.map((a, i) => (
              <li key={i} className="rounded-lg bg-surface-2 p-3">
                <p className="text-sm">{a.title}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {a.owner && <span className="pill bg-accent/15 text-accent-soft">{a.owner}</span>}
                  {a.due && <span className="pill bg-surface-2 text-faint">{a.due}</span>}
                  {a.priority && a.priority !== "normal" && (
                    <span className="pill bg-amber-500/15 text-amber-400">{a.priority}</span>
                  )}
                </div>
                {a.quote && <QuoteLine text={a.quote} />}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {decisions.length > 0 && (
        <Section icon={<GitBranch size={14} className="text-sky-400" />} title={`Decisions (${decisions.length})`}>
          <ul className="space-y-2.5">
            {decisions.map((d, i) => (
              <li key={i} className="rounded-lg bg-surface-2 p-3">
                <p className="text-sm">{d.decision}</p>
                {d.context && <p className="mt-1 text-xs text-muted">{d.context}</p>}
                {d.quote && <QuoteLine text={d.quote} stamp={d.timestamp} />}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {questions.length > 0 && (
        <Section
          icon={<HelpCircle size={14} className="text-amber-400" />}
          title={`Open questions (${questions.length})`}
          subtitle="Unresolved and unrouted. These stay here on purpose, because there's nowhere honest to file them."
        >
          <ul className="space-y-2.5">
            {questions.map((q, i) => (
              <li key={i} className="rounded-lg bg-surface-2 p-3">
                <p className="text-sm">{q.question}</p>
                {q.quote && <QuoteLine text={q.quote} />}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {commitments.length > 0 && (
        <Section
          icon={<Handshake size={14} className="text-violet-300" />}
          title={`Commitments (${commitments.length})`}
          subtitle="Saved to Memory, so they surface in briefings and drafts later."
        >
          <ul className="space-y-2.5">
            {commitments.map((c, i) => (
              <li key={i} className="rounded-lg bg-surface-2 p-3">
                <p className="text-sm">{c.who ? <span className="text-faint">{c.who}: </span> : null}{c.commitment}</p>
                {c.quote && <QuoteLine text={c.quote} />}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {insights.length > 0 && (
        <Section
          icon={<Lightbulb size={14} className="text-yellow-300" />}
          title={`Insights (${insights.length})`}
          subtitle="Saved to Memory as context."
        >
          <ul className="space-y-2.5">
            {insights.map((s, i) => (
              <li key={i} className="rounded-lg bg-surface-2 p-3">
                <p className="text-sm">{s.insight}</p>
                {s.quote && <QuoteLine text={s.quote} />}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {note.status !== "failed" &&
        !items.length && !decisions.length && !questions.length && !commitments.length && !insights.length && (
          <div className="card p-6 text-center text-sm text-faint">
            <Brain size={20} className="mx-auto mb-2 opacity-50" />
            Nothing extractable in this one. Every item has to carry a verbatim quote, so a meeting with no
            concrete commitments returns empty rather than padded.
          </div>
        )}
    </div>
  );
}
