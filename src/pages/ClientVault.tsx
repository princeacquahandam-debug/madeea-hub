import { useState } from "react";
import { MessageSquare, ChevronRight, CheckCircle2 } from "lucide-react";
import { CLIENTS } from "@/data/seed";
import type { Client } from "@/types/db";
import { Badge, PageHeader, Modal } from "@/components/ui";
import { initials } from "@/lib/utils";

export default function ClientVault() {
  const [open, setOpen] = useState<Client | null>(null);

  return (
    <div>
      <PageHeader title="Client Vault" subtitle="Complete profiles and preferences for every client" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CLIENTS.map((c) => (
          <div key={c.id} className="card flex flex-col p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent-soft">
                {initials(c.name)}
              </div>
              <div>
                <h3 className="font-semibold">{c.name}</h3>
                <p className="text-xs text-faint">{c.title}</p>
                <p className="text-xs text-faint">{c.company}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-xs text-muted">
              <MessageSquare size={13} />
              <span>Prefers</span>
              <span className="font-medium text-zinc-200">{c.preferred_channel}</span>
              <span>·</span>
              <span>{c.tone}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {c.tags.map((t) => (
                <span key={t} className="pill bg-surface-2 text-faint">{t}</span>
              ))}
            </div>

            <button
              className="btn-ghost mt-4 justify-between border border-border"
              onClick={() => setOpen(c)}
            >
              View Full Profile <ChevronRight size={15} />
            </button>
          </div>
        ))}
      </div>

      <Modal open={open !== null} onClose={() => setOpen(null)}>
        {open && (
          <div>
            <div className="flex items-center gap-4 border-b border-border pb-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/20 text-lg font-semibold text-accent-soft">
                {initials(open.name)}
              </div>
              <div>
                <h2 className="text-lg font-semibold">{open.name}</h2>
                <p className="text-sm text-faint">{open.title}, {open.company}</p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <MessageSquare size={12} />
                  {open.preferred_channel} · {open.tone} tone
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <Section title="Biography"><p className="text-sm text-muted">{open.bio}</p></Section>

              <Section title="Active Tasks">
                <div className="space-y-2">
                  {open.active_tasks.map((t) => (
                    <div key={t.title} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={14} className="text-faint" />
                      <span className="flex-1">{t.title}</span>
                      <Badge tone={t.status.toLowerCase().includes("urgent") ? "urgent" : t.status.toLowerCase().includes("progress") ? "in_progress" : "pending"}>{t.status}</Badge>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Preferences & Notes"><p className="text-sm text-muted">{open.preferences_notes}</p></Section>

              <Section title="Upcoming Schedule">
                <div className="space-y-2">
                  {open.schedule.map((s) => (
                    <div key={s.when} className="flex gap-3 text-sm">
                      <span className="w-28 shrink-0 text-xs font-medium text-muted">{s.when}</span>
                      <span>{s.what}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="field-label">{title}</p>
      {children}
    </div>
  );
}
