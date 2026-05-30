import { useState } from "react";
import { Sparkles, Mail } from "lucide-react";
import { MESSAGES } from "@/data/seed";
import type { Message } from "@/types/db";
import { Badge, PageHeader } from "@/components/ui";
import { initials } from "@/lib/utils";
import { generate } from "@/lib/ai";

const TABS = ["All", "Urgent", "Awaiting Reply", "Delegated"] as const;
const categoryLabel: Record<string, string> = { urgent: "Urgent", reply: "Reply", delegate: "Delegate", archive: "Archive" };

const TAB_FILTER: Record<(typeof TABS)[number], (m: Message) => boolean> = {
  All: () => true,
  Urgent: (m) => m.category === "urgent",
  "Awaiting Reply": (m) => m.category === "reply",
  Delegated: (m) => m.category === "delegate",
};

export default function Communication() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [selected, setSelected] = useState<Message>(MESSAGES[0]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const list = MESSAGES.filter(TAB_FILTER[tab]);

  async function generateDraft() {
    setBusy(true);
    setDraft("");
    try {
      const out = await generate({
        tool: "quick_action",
        format: "AI Draft Response",
        inputs: { from: selected.sender_name, subject: selected.subject, message: selected.body },
      });
      setDraft(out);
    } finally {
      setBusy(false);
    }
  }

  function pick(m: Message) {
    setSelected(m);
    setDraft("");
  }

  return (
    <div>
      <PageHeader title="Communication Center" subtitle="Triage, draft, and manage executive communications" />

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              tab === t ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Message list */}
        <div className="card p-3">
          <p className="px-2 pb-2 text-xs text-faint">{list.length} messages</p>
          <div className="space-y-1">
            {list.map((m) => (
              <button
                key={m.id}
                onClick={() => pick(m)}
                className={`flex w-full gap-3 rounded-lg p-3 text-left transition-colors ${
                  selected.id === m.id ? "bg-surface-2" : "hover:bg-surface-2"
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-soft">
                  {initials(m.sender_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-medium">{m.sender_name}</span>
                    <span className="text-[11px] text-faint">{m.time}</span>
                  </div>
                  <p className="truncate text-sm">{m.subject}</p>
                  <p className="truncate text-xs text-faint">{m.preview}</p>
                  <div className="mt-1">
                    <Badge tone={m.category}>{categoryLabel[m.category]}</Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Reading + draft */}
        <div className="card p-5">
          <div className="flex items-center gap-3 border-b border-border pb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-soft">
              {initials(selected.sender_name)}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{selected.sender_name}</p>
              {selected.client_title && <p className="text-xs text-faint">{selected.client_title}</p>}
            </div>
            <Badge tone={selected.category}>{categoryLabel[selected.category]}</Badge>
          </div>

          <div className="mt-4">
            <p className="field-label">Original Message</p>
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-sm font-medium">{selected.subject}</p>
              <p className="mt-1 text-sm text-muted">{selected.body}</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="field-label mb-0">AI Draft Response</p>
              <button className="btn-primary py-1.5" onClick={generateDraft} disabled={busy}>
                <Sparkles size={14} /> {busy ? "Drafting…" : "AI Draft Response"}
              </button>
            </div>
            {draft ? (
              <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm text-zinc-200">{draft}</pre>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-center text-faint">
                <Mail size={24} />
                <p className="text-xs">Click "AI Draft Response" to generate a professional reply</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
