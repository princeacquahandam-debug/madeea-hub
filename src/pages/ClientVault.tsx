import { useState } from "react";
import { MessageSquare, ChevronRight, CheckCircle2, Plus, Trash2, Pencil, AlertTriangle } from "lucide-react";
import type { Client } from "@/types/db";
import { Badge, PageHeader, Modal } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { SlaBadge, TrendArrow, TREND_LABEL } from "@/components/SlaBadge";
import { ClientActivity } from "@/components/ClientActivity";
import { AssigneeAvatar } from "@/components/Assignee";
import { useWorkspaceMembers } from "@/data/hooks";
import { useClients, useTasks, useMeetings, useMessages, useClientMutations } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { clientSla, dayLength, formatDuration } from "@/lib/sla";
import { supabase } from "@/lib/supabase";

const BLANK = { name: "", title: "", company: "", preferred_channel: "Email", tone: "Formal", tags: "", bio: "", preferences_notes: "", image: "" };

export default function ClientVault() {
  const { data: clients = [], isLoading } = useClients();
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const { data: messages = [] } = useMessages();
  const { create, update, remove } = useClientMutations();
  const { data: members = [] } = useWorkspaceMembers();
  const cfg = useSlaSettings((s) => s.config);
  const dl = dayLength(cfg);
  const [open, setOpen] = useState<Client | null>(null);
  const [tab, setTab] = useState<"overview" | "activity">("overview");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  function startCreate() {
    setForm(BLANK); setEditingId(null); setUploadErr(""); setAdding(true);
  }
  function startEdit(c: Client) {
    setForm({
      name: c.name ?? "", title: c.title ?? "", company: c.company ?? "",
      preferred_channel: c.preferred_channel || "Email", tone: c.tone ?? "",
      tags: (c.tags ?? []).join(", "), bio: c.bio ?? "", preferences_notes: c.preferences_notes ?? "",
      image: c.avatar_url ?? "",
    });
    setEditingId(c.id); setOpen(null); setUploadErr(""); setAdding(true);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!supabase) { setUploadErr("Upload needs Supabase — paste an image URL instead."); return; }
    setUploading(true); setUploadErr("");
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("client-avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("client-avatars").getPublicUrl(path);
      setForm((f) => ({ ...f, image: data.publicUrl }));
    } catch {
      setUploadErr("Upload failed — paste an image URL instead.");
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(), title: form.title, company: form.company,
      preferred_channel: form.preferred_channel, tone: form.tone,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      bio: form.bio, preferences_notes: form.preferences_notes,
      avatar_url: form.image.trim() || null,
    };
    if (editingId) update.mutate({ id: editingId, ...payload });
    else create.mutate(payload);
    setForm(BLANK); setEditingId(null); setAdding(false);
  }
  const saving = create.isPending || update.isPending;
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const statusTone = (s: string) =>
    s.toLowerCase().includes("urgent") ? "urgent" : s.toLowerCase().includes("progress") ? "in_progress" : "pending";

  return (
    <div>
      <PageHeader
        title="Client Vault"
        subtitle="Complete profiles and preferences for every client"
        action={<button className="btn-primary" onClick={startCreate}><Plus size={15} /> New Client</button>}
      />

      {isLoading ? (
        <p className="text-sm text-faint">Loading clients…</p>
      ) : clients.length === 0 ? (
        <div className="card p-10 text-center text-sm text-faint">No clients yet. Add your first client to get started.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => {
            const sla = clientSla(c, messages, cfg);
            return (
            <div key={c.id} className="card group flex flex-col p-5">
              <div className="flex items-center gap-3">
                <Avatar name={c.name} url={c.avatar_url} className="h-11 w-11 text-sm" />
                <div className="flex-1">
                  <h3 className="font-semibold">{c.name}</h3>
                  <p className="text-xs text-faint">{c.title}</p>
                  <p className="text-xs text-faint">{c.company}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button className="text-faint hover:text-accent" onClick={() => startEdit(c)} aria-label="Edit client">
                    <Pencil size={14} />
                  </button>
                  <button className="text-faint hover:text-red-400" onClick={() => remove.mutate(c.id)} aria-label="Delete client">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {/* Response-time SLA — the headline service metric for this client. */}
              <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow">Response</span>
                  <span className="shrink-0 whitespace-nowrap"><SlaBadge status={sla.status} /></span>
                </div>
                {sla.avgHours !== null && (
                  <p className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
                    avg {formatDuration(sla.avgHours, dl)} to first reply
                    <TrendArrow trend={sla.trend} />
                  </p>
                )}
                {sla.oldestWaitingHours !== null && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
                    <AlertTriangle
                      size={12}
                      className={`shrink-0 ${sla.status === "breached" ? "text-red-400" : "text-amber-400"}`}
                    />
                    <span className="truncate">
                      Waiting {formatDuration(sla.oldestWaitingHours, dl)} on “{sla.oldestWaitingSubject}”
                    </span>
                  </p>
                )}
              </div>

              {/* Lead EA — accountability, not access control: every EA still sees
                  every client (RLS from 0012 is unchanged). */}
              {(() => {
                const lead = members.find((m) => m.user_id === c.lead_ea_id) ?? null;
                return (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                    <AssigneeAvatar member={lead} />
                    <span>{lead ? `Lead: ${lead.name}` : "No lead EA"}</span>
                  </div>
                );
              })()}

              {(c.preferred_channel || c.tone) && (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                  <MessageSquare size={13} />
                  <span>Prefers</span>
                  <span className="font-medium text-zinc-200">{c.preferred_channel}</span>
                  {c.tone && <><span>·</span><span>{c.tone}</span></>}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.tags?.map((t) => <span key={t} className="pill bg-surface-2 text-faint">{t}</span>)}
              </div>
              <button className="btn-ghost mt-4 justify-between border border-border" onClick={() => { setTab("overview"); setOpen(c); }}>
                View Full Profile <ChevronRight size={15} />
              </button>
            </div>
            );
          })}
        </div>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)}>
        {open && (() => {
          const active = tasks.filter((t) => t.client_name === open.name && t.status !== "done");
          const sched = meetings.filter((m) => m.with === open.name);
          const sla = clientSla(open, messages, cfg);
          const slowest = Math.max(...sla.recent.map((r) => r.hours), 1);
          const barTone: Record<string, string> = {
            on_track: "bg-emerald-500/70",
            at_risk: "bg-amber-500/70",
            breached: "bg-red-500/70",
          };
          return (
            <div>
              <div className="flex items-center gap-4 border-b border-border pb-4">
                <Avatar name={open.name} url={open.avatar_url} className="h-14 w-14 text-lg" />
                <div>
                  <h2 className="text-lg font-semibold">{open.name}</h2>
                  <p className="text-sm text-faint">{open.title}, {open.company}</p>
                  {(open.preferred_channel || open.tone) && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <MessageSquare size={12} />
                      {open.preferred_channel}{open.tone ? ` · ${open.tone} tone` : ""}
                    </div>
                  )}
                </div>
                <button className="btn-ghost ml-auto border border-border py-1.5" onClick={() => startEdit(open)}>
                  <Pencil size={14} /> Edit
                </button>
              </div>

              <div className="mt-4 flex gap-2 border-b border-border">
                {(["overview", "activity"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
                      tab === t
                        ? "border-accent text-accent"
                        : "border-transparent text-muted hover:text-zinc-100"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {tab === "activity" && (
                <div className="mt-4">
                  <ClientActivity client={open} />
                </div>
              )}

              <div className={`mt-4 space-y-4 ${tab === "overview" ? "" : "hidden"}`}>
                <Section title="Response Time">
                  {sla.status === "no_data" && sla.oldestWaitingHours === null ? (
                    <p className="text-sm text-faint">
                      No reply data for this client yet.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg bg-surface-2 p-3">
                          <p className="eyebrow">Average</p>
                          <p className="mt-1 flex items-center gap-1.5 text-lg font-semibold">
                            {sla.avgHours === null ? "—" : formatDuration(sla.avgHours, dl)}
                            <TrendArrow trend={sla.trend} />
                          </p>
                          <p className="mt-0.5 text-[11px] text-faint">{TREND_LABEL[sla.trend]}</p>
                        </div>
                        <div className="rounded-lg bg-surface-2 p-3">
                          <p className="eyebrow">Oldest Waiting</p>
                          <p className="mt-1 text-lg font-semibold">
                            {sla.oldestWaitingHours === null ? "—" : formatDuration(sla.oldestWaitingHours, dl)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-faint">
                            {sla.oldestWaitingCalendarHours === null
                              ? "Nothing outstanding"
                              : `${formatDuration(sla.oldestWaitingCalendarHours)} elapsed`}
                          </p>
                        </div>
                        <div className="rounded-lg bg-surface-2 p-3">
                          <p className="eyebrow">Breaches</p>
                          <p className="mt-1 text-lg font-semibold">{sla.breaches30d}</p>
                          <p className="mt-0.5 text-[11px] text-faint">{sla.breaches7d} in the last 7 days</p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <SlaBadge status={sla.status} />
                        <span className="text-xs text-faint">
                          Target: reply within {sla.thresholds.ok}h
                          {cfg.businessHoursOnly ? " (working hours)" : ""} · breach after {sla.thresholds.risk}h
                        </span>
                      </div>

                      {sla.recent.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          <p className="eyebrow">Recent Threads</p>
                          {sla.recent.map((r) => (
                            <div key={r.id} className="flex items-center gap-2">
                              <span className="w-40 shrink-0 truncate text-xs text-muted" title={r.subject}>
                                {r.subject}
                              </span>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                                <div
                                  className={`h-full rounded-full ${barTone[r.status]}`}
                                  style={{ width: `${Math.max(4, (r.hours / slowest) * 100)}%` }}
                                />
                              </div>
                              <span className="w-14 shrink-0 text-right text-xs text-faint">
                                {formatDuration(r.hours, dl)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </Section>

                {open.bio && <Section title="Biography"><p className="text-sm text-muted">{open.bio}</p></Section>}

                <Section title="Active Tasks">
                  {active.length ? (
                    <div className="space-y-2">
                      {active.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 size={14} className="text-faint" />
                          <span className="flex-1">{t.title}</span>
                          <Badge tone={t.priority}>{t.status === "in_progress" ? "In Progress" : "To Do"}</Badge>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-faint">No active tasks.</p>}
                </Section>

                {open.preferences_notes && (
                  <Section title="Preferences & Notes"><p className="text-sm text-muted">{open.preferences_notes}</p></Section>
                )}

                <Section title="Upcoming Schedule">
                  {sched.length ? (
                    <div className="space-y-2">
                      {sched.map((m) => (
                        <div key={m.id} className="flex gap-3 text-sm">
                          <span className="w-28 shrink-0 text-xs font-medium text-muted">{m.time}</span>
                          <span>{m.title}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-faint">Nothing scheduled.</p>}
                </Section>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={adding} onClose={() => { setAdding(false); setEditingId(null); }}>
        <h2 className="mb-4 text-lg font-semibold">{editingId ? "Edit Client" : "New Client"}</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar name={form.name || "?"} url={form.image} className="h-14 w-14 text-base" />
            <div className="flex-1">
              <label className="field-label">Image (optional)</label>
              <input className="input" value={form.image} onChange={set("image")} placeholder="Paste image URL…" />
              <div className="mt-1.5 flex items-center gap-3 text-xs">
                <label className="cursor-pointer text-accent-soft hover:underline">
                  <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
                  {uploading ? "Uploading…" : "Upload image"}
                </label>
                {form.image && <button className="text-faint hover:text-red-400" onClick={() => setForm((f) => ({ ...f, image: "" }))}>Remove</button>}
                {uploadErr && <span className="text-red-400">{uploadErr}</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="field-label">Name</label><input className="input" autoFocus value={form.name} onChange={set("name")} placeholder="Full name" /></div>
            <div><label className="field-label">Title</label><input className="input" value={form.title} onChange={set("title")} placeholder="e.g. CEO" /></div>
          </div>
          <div><label className="field-label">Company</label><input className="input" value={form.company} onChange={set("company")} placeholder="Company" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Preferred channel</label>
              <select className="input" value={form.preferred_channel} onChange={set("preferred_channel")}>
                <option>Email</option><option>Slack</option><option>WhatsApp</option><option>Phone</option>
              </select>
            </div>
            <div><label className="field-label">Tone</label><input className="input" value={form.tone} onChange={set("tone")} placeholder="e.g. Formal" /></div>
          </div>
          <div><label className="field-label">Tags (comma separated)</label><input className="input" value={form.tags} onChange={set("tags")} placeholder="Board Prep, Travel" /></div>
          <div><label className="field-label">Biography</label><textarea className="input min-h-[70px]" value={form.bio} onChange={set("bio")} /></div>
          <div><label className="field-label">Preferences & Notes</label><textarea className="input min-h-[70px]" value={form.preferences_notes} onChange={set("preferences_notes")} /></div>
          <button className="btn-primary w-full" onClick={submit} disabled={!form.name.trim() || saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Add Client"}
          </button>
        </div>
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
