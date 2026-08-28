import { useMemo, useState, type ReactNode } from "react";
import { Send, Target, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui";
import { DraftList } from "@/components/EodDraftList";
import { draftFromTasks, type EodDraft } from "@/lib/eodDraft";
import { eodForDay, focusForDay } from "@/lib/clockGates";
import { useEodReports, useSubmitEod, useTasks, useTimeEntries, useWorkspaceMembers } from "@/data/hooks";
import { workDate } from "@/lib/workday";
import type { TimeEntry } from "@/types/db";

/**
 * The clock, gated on reporting.
 *
 *   Clocking IN  asks what the day is for.
 *   Clocking OUT collects that day's EOD.
 *
 * ── WHY A HOOK AND NOT TWO BUTTONS ───────────────────────────────────────
 * There are two places to clock in and out: the header control on every page,
 * and the Time page. A gate implemented twice is a gate with two behaviours,
 * and the one that gets forgotten is the one people actually use — which here
 * is the header, because it is the control that is always on screen.
 *
 * So the rules and the dialogs live here once. A surface calls requestClockIn
 * or requestClockOut, renders `dialog`, and is told what to do through the
 * callbacks it passed in. It keeps its own clock-in arguments (client, note)
 * and its own extra questions (the early-finish reason on the Time page).
 *
 * ── THE CALLBACK RUNS INSIDE THE CLICK ───────────────────────────────────
 * onClockIn is called synchronously from the dialog's own button handler, and
 * that matters beyond tidiness: clocking in also asks the browser for the
 * screen share, and getDisplayMedia is granted only during a real user gesture.
 * Anything awaited between the click and that call loses the gesture, and the
 * share is then refused without ever showing a prompt.
 */

export interface ClockGate {
  /** The day's stated focus, or null when it has not been given yet. */
  focus: string | null;
  /** Collect what is missing, then clock in. */
  requestClockIn: () => void;
  /** Collect what is missing, then clock out of this entry. */
  requestClockOut: (entry: TimeEntry) => void;
  /** Render inside the surface. Nothing shows until a gate actually stops someone. */
  dialog: ReactNode;
}

export function useClockGate(opts: {
  onClockIn: (focus: string) => void;
  /** Null when the report was filed, the words why when it was not. */
  onClockOut: (skippedReason: string | null) => void;
}): ClockGate {
  const { onClockIn, onClockOut } = opts;
  const { data: entries = [] } = useTimeEntries();
  const { data: reports = [] } = useEodReports();
  const { data: members = [] } = useWorkspaceMembers();
  const [asking, setAsking] = useState<{ kind: "focus" } | { kind: "eod"; entry: TimeEntry } | null>(null);

  const me = members.find((m) => m.is_me);
  const focus = focusForDay(entries, workDate());

  const close = () => setAsking(null);

  const requestClockIn = () => {
    /* Already stated today. Somebody back from lunch is starting a second
       session of a day they have already described, and asking again is how a
       required field becomes a field people type "x" into. */
    if (focus) { onClockIn(focus); return; }
    setAsking({ kind: "focus" });
  };

  const requestClockOut = (entry: TimeEntry) => {
    /* Filed already — from the EOD page, earlier in the day, from anywhere. The
       gate is "the report exists", not "the report was written here". */
    if (eodForDay(reports, { name: me?.name, userId: me?.user_id }, entry.work_date)) {
      onClockOut(null);
      return;
    }
    setAsking({ kind: "eod", entry });
  };

  const dialog = (
    <>
      <FocusGate
        open={asking?.kind === "focus"}
        onClose={close}
        onConfirm={(text) => { close(); onClockIn(text); }}
      />
      <EodGate
        open={asking?.kind === "eod"}
        workDay={asking?.kind === "eod" ? asking.entry.work_date : null}
        me={me?.name}
        myUserId={me?.user_id}
        onClose={close}
        onDone={(skipped) => { close(); onClockOut(skipped); }}
      />
    </>
  );

  return { focus, requestClockIn, requestClockOut, dialog };
}

/** Clocking in: one sentence about what the day is for. */
function FocusGate({
  open, onClose, onConfirm,
}: { open: boolean; onClose: () => void; onConfirm: (focus: string) => void }) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex items-start gap-3">
        <Target size={20} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 className="display text-xl">What is today for?</h2>
          <p className="mt-1 text-sm text-muted">
            One line, before the clock starts. Asked once a day rather than once a session, and it is
            what tonight&apos;s EOD gets read against.
          </p>
        </div>
      </div>

      <form className="mt-5" onSubmit={(e) => { e.preventDefault(); if (ready) onConfirm(text.trim()); }}>
        <label className="field-label" htmlFor="clock-focus">Focus for the day</label>
        <input
          id="clock-focus"
          className="input"
          autoFocus
          placeholder="Clear Rowena's inbox and get the Q3 deck to first draft"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={!ready}>
            Start the day
          </button>
          <button type="button" className="btn-ghost border border-border" onClick={onClose}>
            Not yet
          </button>
          {!ready && <span className="text-xs text-faint">The clock starts once this is filled in.</span>}
        </div>
      </form>
    </Modal>
  );
}

/**
 * Clocking out: the EOD, collected here rather than pointed at.
 *
 * Sending somebody to another page to write a report before they may leave is
 * how a gate turns into something people work around — by not clocking out at
 * all, which loses the timesheet AND the report. The draft is already built
 * from the board, so on most days this is a read and a click.
 */
function EodGate({
  open, workDay, me, myUserId, onClose, onDone,
}: {
  open: boolean;
  workDay: string | null;
  me?: string;
  myUserId?: string;
  onClose: () => void;
  onDone: (skippedReason: string | null) => void;
}) {
  /* Loaded here rather than in the hook: the board is only needed once somebody
     is actually standing at this gate, and the header would otherwise pull the
     whole task list on every page for a dialog that usually never opens. */
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const submit = useSubmitEod();

  const day = workDay ?? "";
  const auto = useMemo(() => draftFromTasks(tasks, myUserId, day), [tasks, myUserId, day]);
  const [draft, setDraft] = useState<EodDraft | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState("");

  /* The board's version until it is edited, the edited version afterwards. NOT
     an effect that copies `auto` into state: the tasks query refetches on window
     focus, and an effect would overwrite whatever had been typed here the moment
     somebody alt-tabbed. That is the exact bug the EOD page's notes field had. */
  const current = draft ?? auto;
  const total = current.done.length + current.blockers.length + current.plans.length;

  const fileIt = async () => {
    setError("");
    try {
      await submit.mutateAsync({
        person: me ?? "",
        report_date: day,
        done: current.done,
        blockers: current.blockers,
        plans: current.plans,
        notes,
      });
      onDone(null);
    } catch (e) {
      /* Still clocked in. A report that failed to save beside a shift that
         closed anyway is the worst of both: the gate counts it as filed and the
         record does not have it. */
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex items-start gap-3">
        <Send size={19} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 className="display text-xl">Your EOD, before you clock out</h2>
          <p className="mt-1 text-sm text-muted">
            Drafted from your board for {day}. Edit anything, add what the board never saw, then file it
            and the clock stops.
          </p>
        </div>
      </div>

      {tasksLoading && <p className="mt-4 text-xs text-faint">Pulling your board…</p>}

      <div className="mt-5 space-y-4">
        <DraftList
          title="Completed"
          items={current.done}
          dot="bg-emerald-400"
          empty="Nothing marked done on the board. Add what you did."
          onChange={(done) => setDraft({ ...current, done })}
        />
        <DraftList
          title="Blockers"
          items={current.blockers}
          dot="bg-red-400"
          empty="Nothing blocked."
          onChange={(blockers) => setDraft({ ...current, blockers })}
        />
        <DraftList
          title="Plan for next day"
          items={current.plans}
          dot="bg-amber-400"
          empty="No open tasks assigned to you."
          onChange={(plans) => setDraft({ ...current, plans })}
        />

        <div>
          <label className="field-label" htmlFor="gate-eod-notes">Notes (things that aren&apos;t tasks)</label>
          <textarea
            id="gate-eod-notes"
            className="input min-h-[70px]"
            placeholder="Attended the Monday meeting, OLJ subscription still down…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error} — you are still clocked in.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={() => void fileIt()} disabled={submit.isPending || total === 0}>
          <Send size={14} />
          {submit.isPending ? "Filing…" : "File EOD and clock out"}
        </button>
        <button className="btn-ghost border border-border" onClick={onClose}>
          Keep working
        </button>
        {total === 0 && (
          <span className="text-xs text-faint">
            Add at least one line, or say below why there is nothing to file.
          </span>
        )}
      </div>

      {/* ── The way through, for the day it genuinely cannot be filed ──────
          Not a quiet bypass. A shift that cannot be CLOSED is worse than one
          closed without a report: the clock keeps running, the one-open-timer
          rule blocks tomorrow morning, and the timesheet this whole feature
          exists to protect is the thing that ends up wrong. So there is always
          a way out, and it always costs an explanation that an admin reads
          beside the shift it belongs to. */}
      <div className="mt-5 border-t border-border pt-4">
        {!skipping ? (
          <button
            className="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
            onClick={() => setSkipping(true)}
          >
            I can&apos;t file it right now
          </button>
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-400" />
              <p className="text-xs text-amber-100/90">
                The shift closes with no report against it, and this is what an admin sees in its place.
              </p>
            </div>
            <textarea
              className="input mt-2 min-h-[56px] text-sm"
              autoFocus
              placeholder="Why the report can't be filed now, and when it will be"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="btn-ghost border border-amber-500/40 px-3 py-1 text-xs"
                disabled={!reason.trim()}
                onClick={() => onDone(reason.trim())}
              >
                Clock out without the report
              </button>
              <button
                className="btn-ghost px-3 py-1 text-xs"
                onClick={() => { setSkipping(false); setReason(""); }}
              >
                Back to the report
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
