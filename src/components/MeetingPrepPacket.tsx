import { useMemo } from "react";
import { Calendar, CheckSquare, FileText, Mail, Sparkles, Users } from "lucide-react";
import { Badge, Modal } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { assemblePrepContext, isThinContext, type PrepContext } from "@/lib/meetingPrep";
import { meetingItem } from "@/lib/madelineItems";
import { PREP_MEETING } from "@/lib/madelineActions";
import { useClients, useClientDocs, useMeetings, useMessages, useTasks } from "@/data/hooks";
import { useMadelineContext } from "@/hooks/useMadeline";
import { useMadeline } from "@/store/madeline";
import type { Meeting } from "@/types/db";

const RECENT_ICONS = { email: Mail, meeting: Calendar, task: CheckSquare } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="eyebrow mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-surface-2 p-3 text-xs text-faint">{children}</p>;
}

function since(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function MeetingPrepPacket({
  meeting,
  open,
  onClose,
}: {
  meeting: Meeting | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: meetings = [] } = useMeetings({ mine: true });

  // Resolve the client first so docs can be fetched for just this one.
  const client = useMemo(() => {
    if (!meeting) return null;
    return (
      clients.find((c) => c.id === meeting.client_id) ??
      clients.find((c) => c.name.toLowerCase() === meeting.with.trim().toLowerCase()) ??
      null
    );
  }, [meeting, clients]);
  const { data: docs = [] } = useClientDocs(client?.id);

  const context: PrepContext | null = useMemo(
    () => (meeting ? assemblePrepContext({ meeting, clients, tasks, messages, meetings, docs }) : null),
    [meeting, clients, tasks, messages, meetings, docs],
  );

  /* While the packet is open, Madeline knows which meeting "this" is. */
  const item = meeting ? meetingItem(meeting) : null;
  useMadelineContext(open ? item : null);

  /* The brief used to come from a `meeting-prep` function that was never
     deployed, so every "AI brief" was the offline fallback. Madeline has the
     same facts (and reads tasks, emails and the client herself), so the
     packet hands over to her like every other page button. */
  function prep() {
    if (!item) return;
    useMadeline.getState().ask(PREP_MEETING.prompt, { item, display: "modal", title: PREP_MEETING.title });
  }

  if (!meeting || !context) return null;
  const thin = isThinContext(context);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="pr-8">
        <div className="flex items-center gap-2">
          <span className="eyebrow">Prep Packet</span>
          <Badge tone={context.meeting.scope === "external" ? "reply" : "normal"}>
            {context.meeting.scope === "external" ? "External" : "Internal"}
          </Badge>
        </div>
        <h2 className="display mt-1 text-2xl">{context.meeting.title}</h2>
        <p className="mt-1 text-sm text-muted">
          {context.meeting.date} · {context.meeting.time}
        </p>
      </div>

      <Section title="Brief">
        <div className="rounded-lg bg-surface-2 p-4">
          <p className="text-xs text-faint">
            {thin
              ? "Little is on file for this meeting yet. Madeline will still pull together what there is."
              : "Madeline reads this meeting, the client, open tasks and recent emails, and tells you what you need to know walking in."}
          </p>
          <button className="btn-primary mt-3 w-full" onClick={prep}>
            <Sparkles size={14} /> Prep me for this meeting
          </button>
        </div>
      </Section>

      <Section title="Attendees">
        {client ? (
          <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
            <Avatar name={client.name} url={client.avatar_url} className="h-9 w-9 shrink-0 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{client.name}</p>
              <p className="truncate text-xs text-faint">
                {client.title}, {client.company}
              </p>
            </div>
            {client.preferred_channel && <Badge tone="normal">{client.preferred_channel}</Badge>}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
            <Users size={16} className="text-faint" />
            <p className="text-xs text-faint">
              {context.meeting.attendees.length
                ? `${context.meeting.attendees.join(", ")}. No matching client in the Vault.`
                : "No attendees recorded. Treating this as internal."}
            </p>
          </div>
        )}
        {client?.preferences_notes && (
          <p className="mt-2 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
            {client.preferences_notes}
          </p>
        )}
      </Section>

      <Section title="Recent Interactions">
        {context.recent.length ? (
          <div className="space-y-2">
            {context.recent.map((r) => {
              const Icon = RECENT_ICONS[r.kind];
              return (
                <div key={r.kind} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                  <Icon size={16} className="shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{r.detail}</p>
                    <p className="truncate text-xs text-faint">
                      {r.label} · {r.when}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No emails, meetings or completed tasks on file yet.</Empty>
        )}
      </Section>

      <Section title="Open Action Items">
        {context.openItems.length ? (
          <div className="space-y-2">
            {context.openItems.map((t) => (
              <div key={t.title} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <CheckSquare size={16} className="shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{t.title}</p>
                  <p className="truncate text-xs text-faint">{t.due}</p>
                </div>
                <Badge tone={t.priority}>{t.priority}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Nothing outstanding.</Empty>
        )}
      </Section>

      <Section title="Relevant Docs">
        {context.docs.length ? (
          <div className="space-y-2">
            {context.docs.map((d, i) => (
              <div key={i} className="rounded-lg bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="shrink-0 text-faint" />
                  <p className="truncate text-sm font-medium">{d.format}</p>
                  <span className="ml-auto shrink-0 text-xs text-faint">{d.when}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{d.excerpt}</p>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No documents generated for this client yet.</Empty>
        )}
      </Section>
    </Modal>
  );
}
