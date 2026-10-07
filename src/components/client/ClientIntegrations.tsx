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
          <li>MadeEA asks for your <b>calendar only</b>. It cannot read your email.</li>
          <li>Your events are visible to you, {who}, and MadeEA's admins. Not to the rest of the team.</li>
          <li>Disconnect any time. Your events are then removed from MadeEA.</li>
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CALENDAR_PROVIDERS.map((p) => <ProviderCard key={p} provider={p} who={who} />)}
      </div>

      {/* Coming next: listed so the page says what it will hold. */}
      <section className="card p-5">
        <p className="eyebrow mb-3">Coming next</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { title: "Outlook mail for your assistant", body: `Let ${who} read and answer your Outlook email from MadeEA, with your consent.` },
            { title: "Gmail for your assistant", body: `The same for Gmail: let ${who} handle your inbox, with your consent.` },
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
