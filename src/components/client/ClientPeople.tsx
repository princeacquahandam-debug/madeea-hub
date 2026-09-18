import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Eye, Loader2, ShieldCheck, UserPlus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dateOnly, dayLabel, localDayKey } from "./format";

/**
 * Who can see this account, managed by the client themselves.
 *
 * WHAT A COLLEAGUE GETS, and the limit is the product decision rather than a
 * technical one: everything on this account that is not a conversation. They
 * read the work, the calendar and the notes. They cannot ask the assistant for
 * anything, and they cannot open either message channel.
 *
 * THE CHANNELS ARE THE PART TO BE CAREFUL WITH. The escalation channel is where
 * a client raises something about their assistant that they would not say to
 * their face. A colleague reading that is worse than a colleague reading
 * nothing, so viewers are refused it in can_see_conversation (0074) and the tab
 * is not rendered for them either.
 *
 * FIVE, AND THE NUMBER IS DELIBERATE. The 14 Sep call ruled client-side people
 * out entirely, to stop a client seating their own staff instead of hiring
 * assistants. Read-only colleagues answer the need behind that without giving
 * the line away — but only while the number stays small.
 */

interface Person {
  role: "primary" | "viewer";
  created_at: string;
  is_you: boolean;
  email: string | null;
}

const CAP = 5;

export function ClientPeople({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["client-portal", "people"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_people")
        .select("role, created_at, is_you, email")
        .order("role", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Person[];
    },
  });

  const viewers = people.filter((p) => p.role === "viewer");
  const full = viewers.length >= CAP;

  const invite = useMutation({
    mutationFn: async (addr: string) => {
      const { data, error } = await supabase!.functions.invoke("invite-client-viewer", {
        body: { email: addr },
      });
      if (error) {
        /* The function's own sentence, not "non-2xx status code". It answers
           "they already have access" and "you can give 5 colleagues access"
           with a 409, and both are things the reader can act on. */
        const ctx = (error as { context?: Response }).context;
        let msg = "Could not send that invitation.";
        if (ctx?.text) {
          try {
            const raw = await ctx.text();
            const parsed = JSON.parse(raw) as { error?: string };
            if (parsed.error) msg = parsed.error;
          } catch { /* not JSON, keep the fallback */ }
        }
        throw new Error(msg);
      }
      return data as { ok: boolean; email?: string; linked?: boolean };
    },
    onSuccess: (r) => {
      setDone(
        r.linked
          ? `${r.email} already had an account and now has access.`
          : `Invitation sent to ${r.email}.`,
      );
      setEmail("");
      qc.invalidateQueries({ queryKey: ["client-portal", "people"] });
    },
  });

  const removePerson = useMutation({
    mutationFn: async (addr: string) => {
      const { error } = await supabase!.rpc("client_remove_viewer", { p_email: addr });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-portal", "people"] }),
  });

  async function send() {
    const addr = email.trim();
    if (!addr || invite.isPending) return;
    setError("");
    setDone("");
    try {
      await invite.mutateAsync(addr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that invitation.");
    }
  }

  return (
    <div className="space-y-6">
      {readOnly ? (
        <p className="text-faint text-sm">
          Everyone who can see this account. Only the account owner can add or remove
          people.
        </p>
      ) : (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider">
            Give a colleague access
          </h2>
          <p className="text-faint mb-2 text-sm">
            They will see the work, the calendar and shared notes on this account. They
            cannot request work from your assistant, and they cannot read your messages
            with your assistant or with agency leadership.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
              placeholder="colleague@yourcompany.com"
              disabled={full}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm disabled:opacity-40"
              style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
            />
            <button
              onClick={() => void send()}
              disabled={!email.trim() || invite.isPending || full}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--c-accent)", color: "#fff" }}
            >
              {invite.isPending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              Invite
            </button>
          </div>

          <p className="text-faint mt-2 text-xs">
            {full
              ? `You have added ${CAP} colleagues, which is the limit. Remove one to add another, or talk to us about more seats.`
              : `${viewers.length} of ${CAP} colleague seats used.`}
          </p>

          {error ? (
            <p className="mt-2 flex items-start gap-2 text-sm" style={{ color: "var(--c-danger)" }}>
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}
          {done ? (
            <p className="mt-2 flex items-start gap-2 text-sm" style={{ color: "var(--c-accent)" }}>
              <Check size={15} className="mt-0.5 shrink-0" /> {done}
            </p>
          ) : null}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider">
          Who can see this account
        </h2>
        {isLoading ? (
          <p className="text-faint text-sm">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {people.map((p, i) => (
              <li
                key={p.email ?? `${p.role}-${i}`}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
              >
                {p.role === "primary" ? (
                  <ShieldCheck size={16} className="shrink-0" style={{ color: "var(--c-accent)" }} />
                ) : (
                  <Eye size={16} className="text-faint shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {/* A viewer is not shown colleague addresses (0074), so the
                        row still has to read as somebody without one. */}
                    {p.email ?? (p.role === "primary" ? "Account owner" : "Colleague")}
                    {p.is_you ? <span className="text-faint"> · you</span> : null}
                  </div>
                  <div className="text-faint mt-0.5 text-xs">
                    {p.role === "primary" ? "Full access" : "View only"}
                    {" · added "}
                    {dayLabel(dateOnly(localDayKey(p.created_at)))}
                  </div>
                </div>
                {!readOnly && p.role === "viewer" && p.email ? (
                  <button
                    onClick={() => removePerson.mutate(p.email!)}
                    disabled={removePerson.isPending}
                    className="text-faint shrink-0 rounded-md p-1.5 hover:text-red-400"
                    title={`Remove ${p.email}`}
                    aria-label={`Remove ${p.email} from this account`}
                  >
                    <X size={15} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
