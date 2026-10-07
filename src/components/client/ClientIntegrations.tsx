import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Loader2, Mail, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { connectAccount } from "@/lib/connect";
import { edgeFailure } from "@/lib/edgeError";

/**
 * Connected accounts, for a client.
 *
 * The client's own calendar, from Google (Phase 1) or Outlook / Microsoft 365
 * (Phase 3; Teams meetings are Outlook calendar events, so they come too).
 * Once connected, their real schedule shows in their portal Calendar, and
 * their lead EA sees it in the Hub to plan around (0083/0084 limit those
 * events to the lead EA and admins). Each provider is asked for calendar
 * access only; nothing here reads their mail.
 *
 * Mail for their EA is listed as coming next, so the client can see what this
 * page will hold without a button that fails.
 */

export type CalendarProvider = "google" | "microsoft";

const PROVIDERS: Record<CalendarProvider, {
  name: string;
  blurb: string;
  table: "google_credentials" | "microsoft_credentials";
  columns: string;
  fn: string;
  rpc: string;
  syncKey: string;
}> = {
  google: {
    name: "Google Calendar",
    blurb: "Your Google or Google Workspace calendar.",
    table: "google_credentials", columns: "connected_at",
    fn: "calendar-sync", rpc: "client_disconnect_google",
    syncKey: "madeea-client-gcal-last-sync",
  },
  microsoft: {
    name: "Outlook / Microsoft 365",
    blurb: "Your Outlook calendar, including Teams meetings.",
    table: "microsoft_credentials", columns: "connected_at, account_email",
    fn: "outlook-calendar-sync", rpc: "client_disconnect_microsoft",
    syncKey: "madeea-client-mscal-last-sync",
  },
};
export const CALENDAR_PROVIDERS = Object.keys(PROVIDERS) as CalendarProvider[];

/** When this provider last synced, from this browser (0 if never). */
export function lastSync(p: CalendarProvider): number {
  try { return Number(localStorage.getItem(PROVIDERS[p].syncKey) ?? 0); } catch { return 0; }
}

/** Is this provider connected for the signed-in client? */
export async function isConnected(p: CalendarProvider): Promise<boolean> {
  const { data: auth } = await supabase!.auth.getUser();
  if (!auth.user) return false;
  const { data } = await supabase!.from(PROVIDERS[p].table).select("owner_id").eq("owner_id", auth.user.id).maybeSingle();
  return !!data;
}

/** Pull the client's calendar into the portal. Shared with the Calendar tab's auto-sync. */
export async function syncClientCalendar(p: CalendarProvider): Promise<{ synced: number }> {
  const timeMin = new Date(Date.now() - 30 * 864e5).toISOString();
  const timeMax = new Date(Date.now() + 120 * 864e5).toISOString();
  const { data, error } = await supabase!.functions.invoke(PROVIDERS[p].fn, { body: { timeMin, timeMax } });
  if (error) throw new Error((await edgeFailure(error, "Couldn't sync your calendar.")).message);
  try { localStorage.setItem(PROVIDERS[p].syncKey, String(Date.now())); } catch { /* storage blocked */ }
  return { synced: Number((data as { synced?: number })?.synced ?? 0) };
}

export function ClientIntegrations({ assistantName }: { assistantName?: string | null }) {
  const who = assistantName || "your assistant";
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
        <p className="flex items-center gap-1.5 font-semibold text-text"><ShieldCheck size={14} className="text-accent" /> Who sees what</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>The calendar cards ask for your <b>calendar only</b>. Your email is shared only if you turn on mail below.</li>
          <li>Your events are visible to you, {who}, and MadeEA's admins. Not to the rest of the team.</li>
          <li>Disconnect any time. Your events are then removed from MadeEA.</li>
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CALENDAR_PROVIDERS.map((p) => <ProviderCard key={p} provider={p} who={who} />)}
      </div>

      <OutlookMailCard who={who} />

      {/* Coming next: listed so the page says what it will hold. */}
      <section className="card p-5">
        <p className="eyebrow mb-3">Coming next</p>
        <div className="grid gap-3">
          {[
            { title: "Gmail for your assistant", body: `The same as Outlook mail above, for Gmail: let ${who} handle your inbox, with your consent.` },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border border-dashed border-border p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Mail size={15} className="text-faint" /> {c.title}</p>
              <p className="mt-1 text-xs text-faint">{c.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProviderCard({ provider, who }: { provider: CalendarProvider; who: string }) {
  const cfg = PROVIDERS[provider];
  const qc = useQueryClient();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const key = ["client-portal", "calendar-connection", provider];

  // The client's own row (non-secret columns only; 0016, 0048).
  const { data: conn, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data: auth } = await supabase!.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase!.from(cfg.table).select(cfg.columns).eq("owner_id", auth.user.id).maybeSingle();
      return (data as { connected_at: string | null; account_email?: string | null } | null) ?? null;
    },
  });
  const connected = !!conn;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["client-portal", "calendar"] });
  };
  const fail = (e: unknown) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });

  const sync = useMutation({
    mutationFn: () => syncClientCalendar(provider),
    onSuccess: ({ synced }) => { setNote({ ok: true, text: `Synced ${synced} event${synced === 1 ? "" : "s"}.` }); refresh(); },
    onError: fail,
  });

  const connect = useMutation({
    mutationFn: async () => {
      const r = await connectAccount(provider);
      if (!r.ok) throw new Error(r.error ?? `${cfg.name} wasn't connected.`);
      return r;
    },
    onSuccess: (r) => {
      setNote({ ok: true, text: `Connected${r.account ? ` as ${r.account}` : ""}. Bringing in your calendar…` });
      refresh();
      sync.mutate();
    },
    onError: fail,
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc(cfg.rpc);
      if (error) throw error;
    },
    onSuccess: () => { setNote({ ok: true, text: "Disconnected. These events have been removed from MadeEA." }); refresh(); },
    onError: fail,
  });

  const busy = connect.isPending || sync.isPending || disconnect.isPending;

  return (
    <section className="card flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2"><CalendarDays size={20} className="text-accent" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-bold">
            {cfg.name}
            {connected && <span className="pill bg-emerald-500/15 text-emerald-400 text-[11px]"><Check size={11} /> Connected</span>}
          </p>
          <p className="mt-1 text-sm text-muted">
            {cfg.blurb} Show your real schedule here, and let {who} see it to plan your day and book meetings around it.
          </p>
          {conn?.account_email && <p className="mt-1 truncate text-xs text-faint">{conn.account_email}</p>}
        </div>
      </div>

      {note && (
        <p className={`mt-3 rounded-lg border px-3 py-2 text-[13px] ${note.ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-red-500/30 bg-red-500/5 text-red-400"}`}>
          {note.text}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {isLoading ? (
          <span className="text-sm text-faint">Checking…</span>
        ) : connected ? (
          <>
            <button onClick={() => sync.mutate()} disabled={busy} className="btn-primary px-3 py-1.5 text-sm">
              {sync.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now
            </button>
            <button
              onClick={() => { if (window.confirm(`Disconnect ${cfg.name}? Its events will be removed from MadeEA.`)) disconnect.mutate(); }}
              disabled={busy}
              className="btn-ghost border border-border px-3 py-1.5 text-sm"
            >
              <Unplug size={14} /> Disconnect
            </button>
            {conn?.connected_at && <span className="text-xs text-faint">Connected {new Date(conn.connected_at).toLocaleDateString()}</span>}
          </>
        ) : (
          <button onClick={() => connect.mutate()} disabled={busy} className="btn-primary px-3 py-1.5 text-sm">
            {connect.isPending ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />} Connect {cfg.name}
          </button>
        )}
      </div>
    </section>
  );
}

/* ── Outlook mail for your assistant (Phase 2, 0086) ─────────────────────
   The client's yes, in two steps they can see: Microsoft is asked for mail
   access (its own consent screen), then MadeEA records who it is shared with.
   Shared with a PERSON: if MadeEA changes their assistant, it pauses until
   they share again. Every message sent in their name is listed here. */

interface MailStatus { provider: string; granted_at: string; granted_to_name: string; active: boolean }
interface MailActivity { id: string; action: "sent" | "replied"; to_emails: string[]; subject: string | null; at: string; actor_name: string }

function OutlookMailCard({ who }: { who: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const key = ["client-portal", "mail-status"];

  const { data: status, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase!.from("client_mail_status").select("provider, granted_at, granted_to_name, active").eq("provider", "microsoft").maybeSingle();
      if (error) throw error;
      return (data as MailStatus | null) ?? null;
    },
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["client-portal", "mail-activity"],
    enabled: !!status,
    queryFn: async () => {
      const { data, error } = await supabase!.from("client_mail_activity").select("id, action, to_emails, subject, at, actor_name").order("at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as MailActivity[];
    },
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["client-portal", "mail-activity"] });
    void qc.invalidateQueries({ queryKey: ["client-portal", "calendar-connection"] });
  };
  const fail = (e: unknown) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });

  const share = useMutation({
    mutationFn: async () => {
      /* Straight to the grant if Microsoft already gave mail access (a pause
         after an assistant change); otherwise ask Microsoft first. */
      const first = await supabase!.rpc("client_grant_mail", { p_provider: "microsoft" });
      if (!first.error) return;
      if (!/access to your mail/i.test(first.error.message)) throw first.error;
      const r = await connectAccount("microsoft", { scopeSet: "mail" });
      if (!r.ok) throw new Error(r.error ?? "Microsoft wasn't connected.");
      const { error } = await supabase!.rpc("client_grant_mail", { p_provider: "microsoft" });
      if (error) throw error;
    },
    onSuccess: () => { setNote({ ok: true, text: `Shared. ${who} can now work your Outlook inbox from MadeEA.` }); refresh(); },
    onError: fail,
  });
  const stop = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_revoke_mail", { p_provider: "microsoft" });
      if (error) throw error;
    },
    onSuccess: () => { setNote({ ok: true, text: "Stopped. Your assistant can no longer see or send your mail, and the copies in MadeEA are deleted." }); refresh(); },
    onError: fail,
  });
  const busy = share.isPending || stop.isPending;

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2"><Mail size={20} className="text-accent" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-bold">
            Outlook mail for your assistant
            {status?.active && <span className="pill bg-emerald-500/15 text-emerald-400 text-[11px]"><Check size={11} /> Shared</span>}
            {status && !status.active && <span className="pill bg-amber-500/15 text-amber-400 text-[11px]">Paused</span>}
          </p>
          <p className="mt-1 text-sm text-muted">
            Let {who} read your Outlook inbox and reply or send on your behalf, from MadeEA.
          </p>
        </div>
      </div>

      {!status && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-muted">
          <li>Only {who} can see your mail. Not MadeEA's other staff, not admins, and not MadeEA's AI tools.</li>
          <li>Messages are sent from your address. Every one is listed here, with who sent it.</li>
          <li>Nothing is marked read or deleted in your Outlook.</li>
          <li>If MadeEA changes your assistant, sharing pauses until you say yes again.</li>
          <li>Stop any time. MadeEA's copies of your mail are deleted when you do.</li>
        </ul>
      )}
      {status && !status.active && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] text-amber-400">
          You shared your mail with {status.granted_to_name}, who is no longer your assistant, so access has stopped. Share it with {who} instead?
        </p>
      )}

      {note && (
        <p className={`mt-3 rounded-lg border px-3 py-2 text-[13px] ${note.ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-red-500/30 bg-red-500/5 text-red-400"}`}>{note.text}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isLoading ? <span className="text-sm text-faint">Checking…</span> : status?.active ? (
          <>
            <button onClick={() => { if (window.confirm("Stop sharing your Outlook mail? Your assistant loses access straight away.")) stop.mutate(); }}
              disabled={busy} className="btn-ghost border border-border px-3 py-1.5 text-sm">
              {stop.isPending ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />} Stop sharing
            </button>
            <span className="text-xs text-faint">Shared with {status.granted_to_name} since {new Date(status.granted_at).toLocaleDateString()}</span>
          </>
        ) : (
          <button onClick={() => share.mutate()} disabled={busy} className="btn-primary px-3 py-1.5 text-sm">
            {share.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Share my Outlook mail with {who}
          </button>
        )}
        {status && !status.active && (
          <button onClick={() => stop.mutate()} disabled={busy} className="btn-ghost px-3 py-1.5 text-sm text-faint">Turn off</button>
        )}
      </div>

      {status && (
        <div className="mt-4">
          <p className="field-label">Sent on your behalf</p>
          {activity.length === 0 ? (
            <p className="text-sm text-faint">Nothing yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <span className="font-medium">{a.actor_name}</span>
                  <span className="text-muted">{a.action === "replied" ? "replied to" : "emailed"} {a.to_emails.join(", ") || "someone"}</span>
                  {a.subject && <span className="min-w-0 truncate text-faint">“{a.subject}”</span>}
                  <span className="ml-auto text-xs text-faint">{new Date(a.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
