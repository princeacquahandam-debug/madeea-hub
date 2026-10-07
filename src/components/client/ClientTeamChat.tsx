import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, MessageSquare, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { clockTime, dayLabel, dateOnly, localDayKey } from "./format";
import { fetchTeamChat, TEAM_CHAT_KEY } from "./memberData";

/**
 * Messages between a client and their own staff (0085).
 *
 * One thread per staff member. A staff member sees exactly one: theirs, with
 * the account owner. The owner sees a thread per staff member and picks one.
 * The agency is not in these threads (0078: these are not its people), which
 * is why this is not one of the two agency channels.
 *
 * Polled rather than realtime, every 15 seconds while open: the agency
 * channels in this portal work the same way and nobody has asked for faster.
 */

interface Person { role: string; email: string | null }

export function ClientTeamChat({ asOwner }: { asOwner: boolean }) {
  const qc = useQueryClient();
  const { data: msgs = [], isLoading } = useQuery({ queryKey: TEAM_CHAT_KEY, queryFn: fetchTeamChat, refetchInterval: 15_000 });

  // The owner's staff list, to open a thread with someone who has not written yet.
  const { data: people = [] } = useQuery({
    queryKey: ["client-portal", "people"],
    enabled: asOwner,
    queryFn: async () => {
      const { data, error } = await supabase!.from("client_people").select("role, email");
      if (error) throw error;
      return (data ?? []) as Person[];
    },
  });
  const staff = useMemo(() => {
    const emails = new Set(people.filter((p) => p.role === "member" && p.email).map((p) => p.email!));
    for (const m of msgs) if (m.member_email) emails.add(m.member_email);
    return [...emails].sort();
  }, [people, msgs]);

  const [who, setWho] = useState<string | null>(null);
  useEffect(() => { if (asOwner && !who && staff.length) setWho(staff[0]); }, [asOwner, who, staff]);

  const thread = asOwner ? msgs.filter((m) => m.member_email === who) : msgs;
  const lastFrom = (email: string) => [...msgs].reverse().find((m) => m.member_email === email);

  const [draft, setDraft] = useState("");
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_team_send", { p_body: draft.trim(), p_member_email: asOwner ? who : null });
      if (error) throw error;
    },
    onSuccess: () => { setDraft(""); void qc.invalidateQueries({ queryKey: TEAM_CHAT_KEY }); },
  });

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [thread.length, who]);

  if (asOwner && !isLoading && staff.length === 0) {
    return <p className="card p-5 text-sm text-faint">No staff yet. Add a staff member under People, then message them here.</p>;
  }

  return (
    <div className={cn("grid gap-4", asOwner && "md:grid-cols-[15rem_minmax(0,1fr)]")}>
      {asOwner && (
        <>
          {/* Phone: a picker. Wider: a list with the last line of each thread. */}
          <select value={who ?? ""} onChange={(e) => setWho(e.target.value)} aria-label="Staff member" className="input md:hidden">
            {staff.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <nav className="card hidden p-2 md:block" aria-label="Staff threads">
            {staff.map((s) => {
              const last = lastFrom(s);
              return (
                <button key={s} onClick={() => setWho(s)} aria-current={who === s}
                  className={cn("block w-full rounded-lg px-3 py-2 text-left transition-colors",
                    who === s ? "bg-accent/15" : "hover:bg-[var(--chip-bg)]")}>
                  <span className={cn("block truncate text-sm", who === s ? "font-semibold text-accent-soft" : "font-medium")}>{s}</span>
                  <span className="block truncate text-xs text-faint">{last ? `${last.mine ? "You: " : ""}${last.body}` : "No messages yet"}</span>
                </button>
              );
            })}
          </nav>
        </>
      )}

      <section className="card flex min-h-[24rem] min-w-0 flex-col p-0">
        <div ref={scroller} className="max-h-[60vh] min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {isLoading ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : thread.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
              <MessageSquare size={22} className="mb-2 text-faint" />
              <p className="text-sm text-faint">
                {asOwner ? `No messages with ${who ?? "this person"} yet.` : "No messages yet. Questions about your work go to the account owner here."}
              </p>
            </div>
          ) : thread.map((m, i) => {
            const day = localDayKey(m.sent_at);
            const newDay = i === 0 || localDayKey(thread[i - 1].sent_at) !== day;
            return (
              <div key={m.id}>
                {newDay && <p className="my-2 text-center text-[11px] text-faint">{dayLabel(dateOnly(day))}</p>}
                <div className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm sm:max-w-[70%]",
                    m.mine ? "bg-accent text-white" : "bg-surface-2")}>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={cn("mt-0.5 text-[10px]", m.mine ? "text-white/70" : "text-faint")}>{clockTime(m.sent_at)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <form className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => { e.preventDefault(); if (draft.trim() && !send.isPending) send.mutate(); }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} maxLength={4000}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (draft.trim() && !send.isPending) send.mutate(); } }}
            placeholder={asOwner ? `Message ${who ?? ""}` : "Message the account owner"} aria-label="Message"
            className="input min-w-0 flex-1 resize-none text-sm" />
          <button type="submit" className="btn-primary shrink-0" disabled={!draft.trim() || send.isPending || (asOwner && !who)} aria-label="Send">
            {send.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </form>
        {send.error && (
          <p className="flex items-start gap-1.5 px-3 pb-3 text-sm text-red-400"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {(send.error as Error).message}</p>
        )}
      </section>
    </div>
  );
}
