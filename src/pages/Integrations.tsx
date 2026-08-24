import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, CheckCircle2, RefreshCw, Plug, Loader2, Wand2, AlertTriangle } from "lucide-react";
import { SlackMark } from "@/components/BrandIcons";
import { PageHeader } from "@/components/ui";
import { ChannelConnections } from "@/components/ChannelConnections";
import { TeamConnections } from "@/components/TeamConnections";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useMailboxSync, useMailConnections } from "@/data/hooks";
import { reconnectMail } from "@/hooks/useSendEmail";

/**
 * WHERE MAIL WENT, AND WHY IT IS NOT ON THIS PAGE TWICE.
 *
 * Gmail and Outlook connect from their own cards in the channel grid above,
 * not from an account card down here. This page used to have both halves of the
 * same answer in two places: a grid that said whether Gmail was connected, and
 * a card further down that was the only way to connect it. Adding Outlook would
 * have made that four cards for two mailboxes.
 *
 * What is left below is what is genuinely NOT a message channel: the calendar
 * (which rides on the same Google consent but feeds the Dashboard, not the
 * Inbox), Slack's workspace-level sync, and the scheduled organiser.
 */
export default function Integrations() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data: mailboxes = [] } = useMailboxSync();
  const { data: mail } = useMailConnections();
  const googleConnected = mail?.gmail.connected ?? false;

  /* StrictMode runs effects twice in development, and a Microsoft claim code is
     single-use BY DESIGN: the second run would spend a code that has already
     been redeemed and report "this link has expired" over a connection that in
     fact just succeeded. A ref, not state, because it must be set before the
     second invocation and a state write would not be visible in time. */
  const handledReturn = useRef(false);

  async function syncGoogle() {
    if (!supabase) return;
    setBusy("google-sync");
    setNote("");
    try {
      const [gm, cal] = await Promise.all([
        supabase.functions.invoke("gmail-sync"),
        supabase.functions.invoke("calendar-sync"),
      ]);
      const m = (gm.data as { synced?: number })?.synced ?? 0;
      const c = (cal.data as { synced?: number })?.synced ?? 0;
      const err = gm.error?.message || cal.error?.message;
      setNote(err ? `Sync error: ${err}` : `Synced ${m} emails and ${c} calendar events.`);
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Finish a Microsoft connection.
   *
   * The tokens are already at Microsoft's word: what is left is proving they
   * belong to whoever is sitting here. That is the whole point of the claim
   * step (see microsoft-oauth-claim) and it is the reason this page, rather
   * than the callback, is where an Outlook connection becomes real.
   */
  async function finishOutlook(claim: string) {
    if (!supabase) return;
    setBusy("outlook-claim");
    try {
      const { data, error } = await supabase.functions.invoke("microsoft-oauth-claim", { body: { claim } });
      let payload = (data ?? null) as { ok?: boolean; account_email?: string; error?: string } | null;
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try { payload = JSON.parse(await ctx.text()); } catch { payload = null; }
        }
      }
      if (error || !payload?.ok) {
        setNote(payload?.error ?? "Could not finish the Outlook connection. Please connect again.");
        return;
      }
      qc.invalidateQueries({ queryKey: ["mail-connections"] });
      setNote(
        payload.account_email
          ? `Outlook connected as ${payload.account_email}. Pulling your inbox…`
          : "Outlook connected. Pulling your inbox…",
      );

      // Straight into a first sync, so the Inbox has something in it when the
      // person goes looking. A failure here is a sync problem, not a
      // connection problem, and is reported as one.
      const { data: sync, error: syncErr } = await supabase.functions.invoke("outlook-sync");
      const pulled = (sync as { synced?: number })?.synced ?? 0;
      setNote(
        syncErr
          ? "Outlook connected, but the first sync failed. Try Sync mail on the Outlook card."
          : `Outlook connected. Pulled ${pulled} message${pulled === 1 ? "" : "s"}.`,
      );
      qc.invalidateQueries({ queryKey: ["messages"] });
    } finally {
      setBusy(null);
    }
  }

  // On return from a provider's consent screen: confirm, then sync.
  useEffect(() => {
    if (handledReturn.current) return;
    handledReturn.current = true;

    const claim = params.get("claim");
    if (params.get("connect") === "outlook" && claim) {
      params.delete("connect");
      params.delete("claim");
      // Replaced immediately: a claim code in the address bar is a credential,
      // and one left there ends up in history, in a screenshot, or pasted into
      // a support chat.
      setParams(params, { replace: true });
      void finishOutlook(claim);
      return;
    }

    if (params.get("connected") === "google") {
      params.delete("connected");
      setParams(params, { replace: true });
      qc.invalidateQueries({ queryKey: ["mail-connections"] });
      void syncGoogle();
      return;
    }

    const oauthErr = params.get("error");
    if (oauthErr) {
      params.delete("error");
      setParams(params, { replace: true });
      setNote(
        oauthErr === "google_mismatch"
          ? "That Google account doesn't match your MadeEA sign-in email. Connect the Google account you log in with, or connect an Outlook mailbox instead, which has no such restriction."
          : oauthErr === "outlook_failed"
            ? "Microsoft did not complete the connection. If your organisation requires admin approval for new apps, that is the usual cause."
            : "Google connection failed. Please try again.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncSlack() {
    if (!supabase) return;
    setBusy("slack");
    setNote("");
    try {
      const { data, error } = await supabase.functions.invoke("slack-sync");
      if (error) {
        let msg = error.message;
        try {
          const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        setNote(`Slack: ${msg}`);
      } else {
        /* Say which channel and what was skipped, not just a number.
           "Synced 0 messages from 1 channels" reads as broken, and the three
           reasons it can be zero (nothing there, nothing readable, a write that
           failed) all looked identical. */
        const d = data as {
          synced?: number; skipped?: number; channels?: number;
          channel_names?: string[]; errors?: string[];
        };
        const where = d.channel_names?.length ? `#${d.channel_names.join(", #")}` : "no channels";
        if (d.errors?.length) {
          setNote(`Slack: ${d.errors[0]}`);
        } else if ((d.synced ?? 0) > 0) {
          setNote(`Pulled ${d.synced} message${d.synced === 1 ? "" : "s"} from ${where}.`);
        } else if ((d.skipped ?? 0) > 0) {
          setNote(`${where} has nothing new. ${d.skipped} item${d.skipped === 1 ? " was" : "s were"} skipped as joins or system notices rather than messages. Post something in Slack, then sync again.`);
        } else if (!d.channels) {
          setNote("The MadeEA bot is not in any channel yet. In Slack, run /invite @MadeEA in the channel you want to pull.");
        } else {
          setNote(`${where} is empty. Post something in Slack, then sync again.`);
        }
        qc.invalidateQueries({ queryKey: ["messages"] });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect the tools your inbox, calendar and team live in" />

      {note && (
        <div className="mb-4 rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm text-muted">{note}</div>
      )}

      {/* Channel state first: it is the question people arrive at this page
          with, and it used to require three clicks inside the Communication
          Center to answer. Mail connects from here too, on the card that
          already says whether it is connected. */}
      <ChannelConnections />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Google Calendar. The mail half of this consent lives on the Gmail
            card above; what is left here is the part that has nothing to do
            with messages, and it is the same Google connection either way. */}
        <div className="card flex flex-col p-5 md:col-span-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2">
              <Calendar size={20} className="text-accent-soft" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">Google Calendar</h3>
              {googleConnected ? (
                <span className="pill bg-emerald-500/15 text-emerald-400">Connected</span>
              ) : (
                <span className="pill bg-zinc-500/15 text-faint">Not connected</span>
              )}
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">
            {googleConnected
              ? "Your upcoming events feed the Dashboard and meeting prep. Syncing here also pulls new mail, because it is one Google connection."
              : "Rides on the same Google consent as Gmail. Connecting here connects both; there is no separate calendar sign-in."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {!googleConnected ? (
              <button
                className="btn-primary"
                onClick={async () => {
                  const err = await reconnectMail("gmail");
                  if (err) setNote(err);
                }}
                disabled={!isSupabaseConfigured || busy !== null}
              >
                <Plug size={15} /> Connect Google
              </button>
            ) : (
              <button className="btn-primary" onClick={syncGoogle} disabled={busy !== null}>
                {busy === "google-sync" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync now
              </button>
            )}
          </div>
        </div>

        {/* Slack */}
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2">
              <SlackMark size={20} />
            </div>
            <div>
              <h3 className="font-semibold">Slack</h3>
              <span className="pill bg-zinc-500/15 text-faint">Workspace bot</span>
            </div>
          </div>
          <p className="mt-3 flex-1 text-sm text-muted">
            Pull messages from the channels your MadeEA bot has joined into the Inbox.
          </p>
          <button className="btn-primary mt-4" onClick={syncSlack} disabled={!isSupabaseConfigured || busy === "slack"}>
            {busy === "slack" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync Slack
          </button>
        </div>
      </div>

      {/* Who on the team has connected what. Above the organiser card
          deliberately: that one reports what the n8n schedule has DONE, and
          this reports whether there is anything for it to do. Asked in that
          order, the empty organiser stops looking like a fault. */}
      <TeamConnections />

      {/* Team email organiser. Read-only status. The n8n schedule drives it; there
          is deliberately no "run now" button, because gmail_sync_state is
          service-role-write-only and one member must not be able to force a
          re-pull of someone else's mailbox. */}
      <div className="card mt-5 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2">
            <Wand2 size={20} className="text-accent-soft" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">Team email organiser</h3>
            <p className="text-xs text-faint">
              Sorts every connected Gmail mailbox into Urgent / Reply / Delegate / Archive on a schedule. Your real Gmail is never changed. Outlook mailboxes sync and reply, but the scheduled organiser does not cover them yet.
            </p>
          </div>
          {mailboxes.length > 0 && (
            <span className="pill bg-emerald-500/15 text-emerald-400">{mailboxes.length} mailbox{mailboxes.length === 1 ? "" : "es"}</span>
          )}
        </div>

        {mailboxes.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No mailbox has been organised yet. Once a teammate connects Google and the n8n schedule runs,
            their sync status shows up here.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {mailboxes.map((m) => (
              <div key={m.owner_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span className="font-medium">{m.name}</span>
                {m.last_status === "error" ? (
                  <span className="pill bg-red-500/15 text-red-400" title={m.last_error ?? undefined}>
                    <AlertTriangle size={11} />
                    Needs attention
                  </span>
                ) : (
                  <span className="pill bg-emerald-500/15 text-emerald-400">
                    <CheckCircle2 size={11} />
                    Healthy
                  </span>
                )}
                <span className="text-xs text-faint">
                  {m.messages_triaged} sorted
                  {m.last_synced_at ? ` · last run ${new Date(m.last_synced_at).toLocaleString()}` : " · never run"}
                </span>
                {m.last_status === "error" && m.last_error && (
                  <span className="w-full text-xs text-red-400/80">{m.last_error}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <CheckCircle2 size={18} className="mt-0.5 text-emerald-400" />
        <div className="text-sm text-muted">
          <p className="font-medium text-zinc-200">How connections work</p>
          <p className="mt-1">
            OAuth runs server-side via Supabase Edge Functions. Tokens are stored encrypted and the
            browser never sees a provider secret. Connecting redirects you to the provider's consent
            screen, then back here to sync.
          </p>
          {/* Said out loud, because it is the difference people run into and it
              looks arbitrary until you know which way round it is. */}
          <p className="mt-2">
            Google must be the same account you sign into MadeEA with; Microsoft does not have to be,
            so a work Outlook mailbox connects to a Gmail login.
          </p>
        </div>
      </div>
    </div>
  );
}
