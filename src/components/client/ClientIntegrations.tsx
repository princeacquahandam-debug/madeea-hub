import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Loader2, Mail, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { connectAccount } from "@/lib/connect";
import { edgeFailure } from "@/lib/edgeError";

/**
 * Connected accounts, for a client.
 *
 * Phase 1: the client's own Google Calendar. Once connected, their real
 * schedule shows in their portal Calendar, and their lead EA sees it in the
 * Hub to plan around (0083 limits those events to the lead EA and admins).
 * Google is asked for calendar access only; nothing here reads their mail.
 *
 * Gmail for their EA, and Outlook/Teams, are listed as coming next, so the
 * client can see what this page will hold without a button that fails.
 */

export const CLIENT_LAST_SYNC_KEY = "madeea-client-gcal-last-sync";

/** Pull the client's calendar into the portal. Shared with the Calendar tab's auto-sync. */
export async function syncClientCalendar(): Promise<{ synced: number }> {
  const timeMin = new Date(Date.now() - 30 * 864e5).toISOString();
  const timeMax = new Date(Date.now() + 120 * 864e5).toISOString();
  const { data, error } = await supabase!.functions.invoke("calendar-sync", { body: { timeMin, timeMax } });
  if (error) throw new Error((await edgeFailure(error, "Couldn't sync your calendar.")).message);
  try { localStorage.setItem(CLIENT_LAST_SYNC_KEY, String(Date.now())); } catch { /* storage blocked */ }
  return { synced: Number((data as { synced?: number })?.synced ?? 0) };
}

export function ClientIntegrations({ assistantName }: { assistantName?: string | null }) {
  const qc = useQueryClient();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // The client's own Google row (non-secret columns only; 0016).
  const { data: google, isLoading } = useQuery({
    queryKey: ["client-portal", "google-connection"],
    queryFn: async () => {
      const { data: auth } = await supabase!.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase!.from("google_credentials").select("scopes,connected_at").eq("owner_id", auth.user.id).maybeSingle();
      return (data as { scopes: string | null; connected_at: string | null } | null) ?? null;
    },
  });
  const connected = !!google;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["client-portal", "google-connection"] });
    void qc.invalidateQueries({ queryKey: ["client-portal", "calendar"] });
  };

  const sync = useMutation({
    mutationFn: syncClientCalendar,
    onSuccess: ({ synced }) => { setNote({ ok: true, text: `Synced ${synced} event${synced === 1 ? "" : "s"} from your Google Calendar.` }); refresh(); },
    onError: (e) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }),
  });

  const connect = useMutation({
    mutationFn: async () => {
      const r = await connectAccount("google");
      if (!r.ok) throw new Error(r.error ?? "Google wasn't connected.");
      return r;
    },
    onSuccess: async (r) => {
      setNote({ ok: true, text: `Connected${r.account ? ` as ${r.account}` : ""}. Bringing in your calendar…` });
      refresh();
      sync.mutate();
    },
    onError: (e) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_disconnect_google");
      if (error) throw error;
    },
    onSuccess: () => { setNote({ ok: true, text: "Disconnected. Your calendar events have been removed from MadeEA." }); refresh(); },
    onError: (e) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }),
  });

  const who = assistantName || "your assistant";
  const busy = connect.isPending || sync.isPending || disconnect.isPending;

  return (
    <div className="space-y-4">
      {note && (
        <p className={`rounded-xl border px-4 py-2.5 text-sm ${note.ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-red-500/30 bg-red-500/5 text-red-400"}`}>
          {note.text}
        </p>
      )}

      {/* Google Calendar */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2"><CalendarDays size={20} className="text-accent" /></span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-bold">
              Google Calendar
              {connected && <span className="pill bg-emerald-500/15 text-emerald-400 text-[11px]"><Check size={11} /> Connected</span>}
            </p>
            <p className="mt-1 text-sm text-muted">
              Show your real schedule in your Calendar here, and let {who} see it in MadeEA to plan your day and book
              meetings around it.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
          <p className="flex items-center gap-1.5 font-semibold text-text"><ShieldCheck size={14} className="text-accent" /> Who sees what</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>MadeEA asks Google for your <b>calendar only</b>. It cannot read your email.</li>
            <li>Your events are visible to you, {who}, and MadeEA's admins. Not to the rest of the team.</li>
            <li>Disconnect any time. Your events are then removed from MadeEA.</li>
          </ul>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isLoading ? (
            <span className="text-sm text-faint">Checking…</span>
          ) : connected ? (
            <>
              <button onClick={() => sync.mutate()} disabled={busy} className="btn-primary px-3 py-1.5 text-sm">
                {sync.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now
              </button>
              <button
                onClick={() => { if (window.confirm("Disconnect Google Calendar? Your events will be removed from MadeEA.")) disconnect.mutate(); }}
                disabled={busy}
                className="btn-ghost border border-border px-3 py-1.5 text-sm"
              >
                <Unplug size={14} /> Disconnect
              </button>
              {google?.connected_at && <span className="text-xs text-faint">Connected {new Date(google.connected_at).toLocaleDateString()}</span>}
            </>
          ) : (
            <button onClick={() => connect.mutate()} disabled={busy} className="btn-primary px-3 py-1.5 text-sm">
              {connect.isPending ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />} Connect Google Calendar
            </button>
          )}
        </div>
      </section>

      {/* Coming next: listed so the page says what it will hold. */}
      <section className="card p-5">
        <p className="eyebrow mb-3">Coming next</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { icon: Mail, title: "Gmail for your assistant", body: `Let ${who} read and answer your email from MadeEA, with your consent.` },
            { icon: Mail, title: "Outlook and Teams", body: "The same for Microsoft 365: your calendar, and your mail for your assistant." },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border border-dashed border-border p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><c.icon size={15} className="text-faint" /> {c.title}</p>
              <p className="mt-1 text-xs text-faint">{c.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
