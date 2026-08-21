import { useMemo, useState } from "react";
import { Camera, Monitor, Keyboard, MousePointer, Clock, Info, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ScreenshotThumb } from "@/components/ScreenshotThumb";
import {
  signedScreenshotUrl, useScreenshots, useMyRole, useWorkspaceMembers,
  atLeast, ROLE_LABEL, workDate, type ScreenshotRow,
} from "@/data/hooks";
import { cn } from "@/lib/utils";

/**
 * Screenshot review.
 *
 * WHAT THIS SCREEN IS FOR. Not "look at pictures". A reviewer is answering one
 * question per screenshot: does what was happening here match what was claimed?
 * So every image is shown WITH the activity for the period it closes, never on
 * its own. A screenshot without its numbers invites a judgement based on how
 * somebody's desktop looked, which is exactly the wrong basis.
 *
 * THE SCOPE WARNING IS NOT DECORATION. Keyboard and mouse counts come from a
 * browser and cover one tab, so an EA writing in Outlook records zero. Shown
 * next to the number, every time, because the alternative is a manager reading
 * "0 keystrokes" as "did nothing" in a performance conversation. Screen change
 * is the figure that covers the whole machine, and it is labelled as such.
 */
export default function Screenshots() {
  const { data: role } = useMyRole();
  const canReview = atLeast(role, "manager");
  const [day, setDay] = useState(workDate());
  /* "Everyone" is the reviewer's default, because the first question of a
     morning is usually who captured anything at all, not how one named person
     did. Narrowing to a person is a deliberate act. */
  const [who, setWho] = useState<string>("all");
  const { data: members = [] } = useWorkspaceMembers();
  const { data: shots = [], isLoading, isError } = useScreenshots({
    /* Only a reviewer may narrow to someone else. Below manager this stays
       undefined and RLS returns their own rows regardless: the client never
       gets to decide whose screenshots it is allowed to ask for. */
    day, ownerId: canReview && who !== "all" ? who : undefined,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* Whose screen each image is. A grid of anonymous desktops is not reviewable:
     a manager cannot act on it, or worse, acts on the wrong person. */
  const byId = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  /* Who the screen is currently about, if anyone. An empty state that says
     "nothing captured" while a reviewer has someone else selected reads as
     advice about their own machine, and the absence gets attributed to the
     wrong person. */
  const focused = who === "all" ? null : byId.get(who)?.name ?? null;

  const selected = shots.find((s) => s.id === selectedId) ?? shots[0] ?? null;

  /* Grouped by session, because a screenshot's meaning is relative to the shift
     it belongs to. A flat grid of a whole day hides where one sitting ended and
     the next began. */
  const sessions = useMemo(() => {
    const map = new Map<string, ScreenshotRow[]>();
    for (const s of shots) {
      /* Keyed by owner AND session. time_entry_id is unique per person, but
         every screenshot without one shares the "unassigned" bucket, so keying
         on it alone merged different people's stray captures into a single
         block that presented itself as one person's sitting. */
      const key = `${s.owner_id}::${s.time_entry_id ?? "unassigned"}`;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [shots]);

  return (
    <div>
      <PageHeader
        title="Screenshots"
        subtitle={canReview ? "The team's captured activity, with the numbers behind each image" : "Your own captured activity"}
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="field-label" htmlFor="shot-day">Day</label>
          <input id="shot-day" type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        {canReview && (
          <div>
            <label className="field-label" htmlFor="shot-who">Person</label>
            <select
              id="shot-who" className="input" value={who}
              onChange={(e) => { setWho(e.target.value); setSelectedId(null); }}
            >
              <option value="all">Everyone</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}{m.is_me ? " (you)" : ""} · {ROLE_LABEL[m.role] ?? m.role}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="ml-auto text-xs tabular-nums text-faint">
          {shots.length} screenshot{shots.length === 1 ? "" : "s"}
        </span>
      </div>

      {isError && (
        <p className="card mb-3 flex items-start gap-2 p-3 text-[12.5px] text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Could not load screenshots. This is a read failure, not evidence that none exist.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : shots.length === 0 ? (
        <div className="card p-10 text-center">
          <Camera size={24} className="mx-auto mb-2 text-faint" />
          <p className="text-sm font-medium">
            {focused ? `${focused} captured nothing on this day.` : "Nothing captured on this day."}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-faint">
            Screenshots are taken while the timer is running and screen sharing is on. A shift with no images
            means sharing was never started or was stopped. It is not evidence that no work happened, and the
            images were not lost.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {sessions.map(([key, list]) => (
              <section key={key} className="card p-3">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {canReview && (
                    <span className="text-xs font-semibold">
                      {byId.get(list[0].owner_id)?.name ?? "Unknown person"}
                    </span>
                  )}
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">
                    {list[0].time_entry_id ? "Session" : "No session"}
                  </h2>
                  <span className="text-xs text-faint">
                    {new Date(list[list.length - 1].captured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" – "}
                    {new Date(list[0].captured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-faint">{list.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {list.map((s) => (
                    <ScreenshotThumb
                      key={s.id}
                      shot={s}
                      selected={selected?.id === s.id}
                      onSelect={() => setSelectedId(s.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="xl:sticky xl:top-4 xl:self-start">
            {selected ? (
              <ScreenshotDetail
                shot={selected}
                person={canReview ? byId.get(selected.owner_id)?.name ?? "Unknown person" : null}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** One screenshot, full size, with the activity it belongs to. */
function ScreenshotDetail({ shot, person }: { shot: ScreenshotRow; person: string | null }) {
  const [full, setFull] = useState<string | null>(null);
  useState(() => { void signedScreenshotUrl(shot.storage_path).then(setFull); });

  const seconds =
    shot.period_start && shot.period_end
      ? Math.max(1, Math.round((new Date(shot.period_end).getTime() - new Date(shot.period_start).getTime()) / 1000))
      : null;
  const activityPercent =
    seconds !== null && shot.idle_seconds !== null
      ? Math.max(0, Math.min(100, Math.round(((seconds - Math.min(shot.idle_seconds, seconds)) / seconds) * 100)))
      : null;
  const perMinute = (n: number | null) =>
    n === null || seconds === null ? "—" : (n * 60 / seconds).toFixed(1);

  const tabScoped = shot.activity_source === "browser";

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Camera size={15} className="text-accent" />
        <div className="min-w-0">
          {person && <p className="truncate text-sm font-semibold">{person}</p>}
          <p className={cn("tabular-nums", person ? "text-[11.5px] text-faint" : "text-sm font-semibold")}>
            {new Date(shot.captured_at).toLocaleString()}
          </p>
        </div>
      </div>

      {full ? (
        <a href={full} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border">
          <img src={full} alt={`Screen at ${new Date(shot.captured_at).toLocaleTimeString()}`} className="w-full" />
        </a>
      ) : (
        <div className="aspect-video w-full animate-pulse rounded-lg bg-surface-2" />
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Metric icon={<Monitor size={13} />} label="Screen change" value={shot.screen_change_percent === null ? "—" : `${shot.screen_change_percent}%`} scope="whole screen" />
        <Metric icon={<Clock size={13} />} label="Active" value={activityPercent === null ? "—" : `${activityPercent}%`} scope={tabScoped ? "this tab" : "machine"} />
        <Metric icon={<Keyboard size={13} />} label="Keys / min" value={perMinute(shot.keystrokes)} scope={tabScoped ? "this tab" : "machine"} />
        <Metric icon={<MousePointer size={13} />} label="Mouse / min" value={perMinute(shot.mouse_events)} scope={tabScoped ? "this tab" : "machine"} />
      </dl>

      {tabScoped && (
        /* The single most important sentence on this screen. Without it, a
           reviewer reads "0 keys/min" as "did no work", when it may only mean
           the work happened in another application. */
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-2.5 text-[12px] leading-relaxed text-muted">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>
            Keyboard and mouse counts were recorded by the browser and cover only this app's tab. Work done in
            another application counts as zero here. <span className="font-medium text-text">Screen change</span> is
            the figure that covers the whole screen.
          </span>
        </p>
      )}

      <p className="mt-2 text-[11.5px] text-faint">
        Shared surface: {shot.surface ?? "unknown"}
        {shot.blurred && " · blurred at capture; the original was never stored"}
      </p>
    </div>
  );
}

function Metric({ icon, label, value, scope }: { icon: React.ReactNode; label: string; value: string; scope: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-2.5">
      <dt className="flex items-center gap-1.5 text-[11px] text-faint">{icon} {label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      {/* Scope on every metric, not in a footnote. A number whose coverage is
          ambiguous is worse than no number. */}
      <dd className={cn("text-[10.5px]", scope === "this tab" ? "text-amber-400" : "text-faint")}>{scope}</dd>
    </div>
  );
}
