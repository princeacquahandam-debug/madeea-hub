import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Inbox, Loader2, Mail, PenSquare, RefreshCw, Reply, Send, ShieldCheck, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { edgeFailure } from "@/lib/edgeError";
import { cn, initials } from "@/lib/utils";

/**
 * A client's Outlook mailbox, worked by their lead EA with the client's
 * permission (0086, client-mail).
 *
 * DELIBERATELY APART FROM THE INBOX. The Communication Center lists
 * `messages`, which every other surface (briefings, search, Madeline,
 * automations) also reads. A client's mail is not in there and must not be,
 * so it opens here, in its own panel, from its own view, and nothing else in
 * the Hub can reach it. No AI drafting in here either: the client was told
 * their mail does not go to MadeEA's AI tools.
 *
 * Shown only to an EA holding a live grant (ea_client_mailboxes); for anyone
 * else the button does not render.
 */

interface Mailbox { client_id: string; client_name: string; provider: string; account_email: string | null; granted_at: string }
interface Mail {
  id: string; client_id: string; thread_id: string | null; direction: "inbound" | "outbound";
  sender_name: string | null; sender_email: string | null; to_emails: string[]; cc_emails: string[];
  subject: string | null; preview: string | null; received_at: string; is_read: boolean;
}

const SYNC_EVERY_MS = 10 * 60 * 1000;
const syncKey = (id: string) => `madeea-client-mail-sync-${id}`;

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase!.functions.invoke("client-mail", { body });
  if (error) throw new Error((await edgeFailure(error, fallback)).message);
  return data as T;
}

export function useClientMailboxes() {
  return useQuery({
    queryKey: ["client-mailboxes"],
    staleTime: 60_000,
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase.from("ea_client_mailboxes").select("client_id, client_name, provider, account_email, granted_at").order("client_name");
      if (error) return []; // before 0086 is applied, simply no button
      return (data ?? []) as Mailbox[];
    },
  });
}

/** The Inbox header button. Renders nothing unless this EA holds a client's grant. */
export function ClientMailboxButton() {
  const { data: boxes = [] } = useClientMailboxes();
  const [open, setOpen] = useState(false);
  if (boxes.length === 0) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost h-10 border border-border px-3 text-sm" title="Mailboxes your clients have shared with you">
        <Inbox size={15} /> Client mailboxes <span className="pill bg-accent/15 text-[11px] text-accent-soft">{boxes.length}</span>
      </button>
      {open && createPortal(<ClientMailboxPanel boxes={boxes} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ClientMailboxPanel({ boxes, onClose }: { boxes: Mailbox[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState(boxes[0].client_id);
  const box = boxes.find((b) => b.client_id === clientId) ?? boxes[0];
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const listKey = ["client-mail", clientId];
  const { data: mail = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const { data, error } = await supabase!.from("ea_client_mail")
        .select("id, client_id, thread_id, direction, sender_name, sender_email, to_emails, cc_emails, subject, preview, received_at, is_read")
        .eq("client_id", clientId).order("received_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Mail[];
    },
  });

  const sync = useMutation({
    mutationFn: () => call<{ synced: number }>({ action: "sync", client_id: clientId }, "Couldn't sync this mailbox."),
    onSuccess: () => {
      try { localStorage.setItem(syncKey(clientId), String(Date.now())); } catch { /* storage blocked */ }
      setError("");
      void qc.invalidateQueries({ queryKey: listKey });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  // Fresh on open, at most every ten minutes per mailbox.
  useEffect(() => {
    let last = 0;
    try { last = Number(localStorage.getItem(syncKey(clientId)) ?? 0); } catch { /* storage blocked */ }
    if (Date.now() - last > SYNC_EVERY_MS) sync.mutate();
    setOpenId(null); setComposing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const selected = mail.find((m) => m.id === openId) ?? null;
  const unread = mail.filter((m) => !m.is_read && m.direction === "inbound").length;

  /* z-[90]: above the docked Madeline (z-[85]) on purpose. The client was told
     their mail stays out of MadeEA's AI tools, so she is covered while it is open. */
  return (
    <div className="fixed inset-0 z-[90] flex bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`${box.client_name}'s mailbox`}>
      <div className="card flex h-full w-full flex-col overflow-hidden rounded-none p-0 sm:rounded-2xl">
        {/* Header: whose mailbox, said plainly, every time. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Mail size={18} className="shrink-0 text-accent" />
          {boxes.length > 1 ? (
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="input h-9 w-auto max-w-[14rem] text-sm font-semibold" aria-label="Client mailbox">
              {boxes.map((b) => <option key={b.client_id} value={b.client_id}>{b.client_name}</option>)}
            </select>
          ) : <p className="font-bold">{box.client_name}</p>}
          <span className="min-w-0 truncate text-xs text-faint">{box.account_email ?? "Outlook"}{unread ? ` · ${unread} unread` : ""}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => sync.mutate()} disabled={sync.isPending} className="btn-ghost h-9 border border-border px-3 text-sm" title="Fetch new mail">
              {sync.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}<span className="hidden sm:inline">Sync</span>
            </button>
            <button onClick={() => { setComposing(true); setOpenId(null); }} className="btn-primary h-9 px-3 text-sm">
              <PenSquare size={14} /><span className="hidden sm:inline">New email</span>
            </button>
            <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-text"><X size={18} /></button>
          </div>
        </div>
        <p className="flex items-start gap-2 border-b border-border bg-amber-500/5 px-4 py-2 text-xs text-amber-400">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          <span>You're in {box.client_name}'s own mailbox. Anything you send goes from their address, and they see a record of it.</span>
        </p>
        {error && <p className="flex items-start gap-2 px-4 py-2 text-sm text-red-400"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>}

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          {/* List: hidden on a phone while a message or the composer is open. */}
          <ul className={cn("min-h-0 overflow-y-auto border-border md:border-r", (selected || composing) && "hidden md:block")}>
            {isLoading ? <li className="p-4 text-sm text-faint">Loading…</li>
              : mail.length === 0 ? <li className="p-4 text-sm text-faint">{sync.isPending ? "Fetching their inbox…" : "Nothing here yet. Press Sync."}</li>
              : mail.map((m) => (
                <li key={m.id}>
                  <button onClick={() => { setOpenId(m.id); setComposing(false); }}
                    className={cn("flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-[var(--chip-bg)]", m.id === openId && "bg-accent/10")}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold">
                      {m.direction === "outbound" ? <Send size={13} /> : initials(m.sender_name ?? "?")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-sm", !m.is_read && m.direction === "inbound" ? "font-bold" : "font-medium")}>
                          {m.direction === "outbound" ? `To ${m.to_emails.join(", ")}` : (m.sender_name ?? m.sender_email)}
                        </span>
                        <span className="shrink-0 text-[11px] text-faint">{shortWhen(m.received_at)}</span>
                      </span>
                      <span className="block truncate text-[13px]">{m.subject ?? "(no subject)"}</span>
                      <span className="block truncate text-xs text-faint">{m.preview}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>

          <div className={cn("min-h-0 overflow-y-auto", !(selected || composing) && "hidden md:block")}>
            {composing ? (
              <Composer clientId={clientId} from={box.account_email} onBack={() => setComposing(false)}
                onSent={() => { setComposing(false); void qc.invalidateQueries({ queryKey: listKey }); }} />
            ) : selected ? (
              <Reader key={selected.id} m={selected} clientId={clientId} onBack={() => setOpenId(null)}
                onSent={() => void qc.invalidateQueries({ queryKey: listKey })}
                onRead={() => void qc.invalidateQueries({ queryKey: listKey })} />
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-sm text-faint">Pick a message.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Reader({ m, clientId, onBack, onSent, onRead }: { m: Mail; clientId: string; onBack: () => void; onSent: () => void; onRead: () => void }) {
  const outbound = m.direction === "outbound";
  const { data, isLoading, error } = useQuery({
    queryKey: ["client-mail-body", m.id],
    enabled: !outbound,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await call<{ text: string }>({ action: "body", client_id: clientId, id: m.id }, "Couldn't open that message.");
      onRead();
      return r;
    },
  });
  const [reply, setReply] = useState("");
  const send = useMutation({
    mutationFn: () => call<{ ok: boolean }>({ action: "send", client_id: clientId, reply_to_id: m.id, text: reply, subject: m.subject ? `Re: ${m.subject.replace(/^re:\s*/i, "")}` : "" }, "Couldn't send the reply."),
    onSuccess: () => { setReply(""); onSent(); },
  });

  return (
    <article className="p-4 sm:p-6">
      <button onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-muted md:hidden"><ArrowLeft size={15} /> Back</button>
      <h2 className="break-words text-lg font-bold">{m.subject ?? "(no subject)"}</h2>
      <p className="mt-1 break-words text-sm text-muted">
        {outbound ? <>Sent to {m.to_emails.join(", ")}</> : <><b className="text-text">{m.sender_name}</b> {m.sender_email ? `<${m.sender_email}>` : ""}</>}
      </p>
      <p className="text-xs text-faint">{new Date(m.received_at).toLocaleString()}{m.cc_emails.length ? ` · cc ${m.cc_emails.join(", ")}` : ""}</p>
      <div className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-4 text-sm leading-relaxed">
        {outbound ? m.preview : isLoading ? <span className="text-faint">Opening…</span> : error ? <span className="text-red-400">{(error as Error).message}</span> : (data?.text || m.preview)}
      </div>

      {!outbound && (
        <div className="mt-4">
          <label className="field-label" htmlFor="client-mail-reply"><Reply size={12} className="mr-1 inline" />Reply as the client</label>
          <textarea id="client-mail-reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={5} className="input w-full text-sm"
            placeholder={`Reply to ${m.sender_name ?? m.sender_email ?? "them"}. It goes from the client's address.`} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send reply
            </button>
            {send.isSuccess && <span className="text-sm" style={{ color: "var(--c-accent)" }}>Sent from the client's mailbox.</span>}
            {send.error && <span className="flex items-start gap-1.5 text-sm text-red-400"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{(send.error as Error).message}</span>}
          </div>
        </div>
      )}
    </article>
  );
}

function Composer({ clientId, from, onBack, onSent }: { clientId: string; from: string | null; onBack: () => void; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const list = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const valid = useMemo(() => list(to).length > 0 && list(to).every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)), [to]);
  const send = useMutation({
    mutationFn: () => call<{ ok: boolean }>({ action: "send", client_id: clientId, to: list(to), cc: list(cc), subject, text }, "Couldn't send it."),
    onSuccess: onSent,
  });
  return (
    <div className="space-y-2.5 p-4 sm:p-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted md:hidden"><ArrowLeft size={15} /> Back</button>
      <h2 className="text-lg font-bold">New email</h2>
      <p className="text-xs text-faint">From {from ?? "the client's Outlook"}</p>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To (comma-separated)" aria-label="To" className="input w-full text-sm" />
      <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc (optional)" aria-label="Cc" className="input w-full text-sm" />
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" className="input w-full text-sm" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Write the message…" aria-label="Message" className="input w-full text-sm" />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!valid || !text.trim() || send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send as the client
        </button>
        {send.error && <span className="flex items-start gap-1.5 text-sm text-red-400"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{(send.error as Error).message}</span>}
      </div>
    </div>
  );
}

function shortWhen(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
