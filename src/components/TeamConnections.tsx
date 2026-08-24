import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Users, X } from "lucide-react";
import { GmailMark, OutlookMark, TeamsMark } from "@/components/BrandIcons";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Which teammates have connected a mailbox, and which have not.
 *
 * WHY THIS EXISTS. Mail connections have always been per person: each EA
 * authorises their own Google or Microsoft account and RLS makes everyone
 * else's invisible. That is the correct privacy model and it is not changing.
 *
 * The cost of it was that nobody could answer "has Rowena connected her mail
 * yet?" There was no screen for it, and the nearest thing (the organiser's
 * health list) stays empty until the n8n schedule has run, so "connected an
 * hour ago" and "never connected" looked exactly the same. Setting a new
 * teammate up therefore meant asking them, waiting, and asking again.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW. Anybody's messages. This is a list of
 * whether the plumbing is attached, not a window into a colleague's inbox: the
 * message policies from 0040 are untouched, and mail stays private to its
 * owner. Tokens are not readable here either, by anyone, including an admin.
 *
 * WHY IT LISTS PEOPLE WHO HAVE CONNECTED NOTHING. They are the whole point. A
 * list of the connected tells you who is fine; a list of everyone tells you who
 * still needs a nudge, which is the question being asked.
 */

interface TeamConnection {
  user_id: string;
  name: string;
  login_email: string | null;
  gmail_connected: boolean;
  gmail_connected_at: string | null;
  outlook_connected: boolean;
  outlook_account: string | null;
  outlook_connected_at: string | null;
  teams_ready: boolean;
}

function Pill({ on, label, icon: Icon, title }: {
  on: boolean;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "pill gap-1",
        on ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-faint",
      )}
    >
      <Icon size={11} />
      {label}
      {/* A word and a mark, not colour alone: this gets screenshotted into
          Slack constantly and green-vs-grey does not survive that. */}
      {on ? <Check size={10} /> : <X size={10} />}
    </span>
  );
}

export function TeamConnections() {
  const { data, isLoading, error } = useQuery<TeamConnection[]>({
    queryKey: ["team-connections"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase.rpc("team_mail_connections");
      if (error) throw error;
      return (data as TeamConnection[]) ?? [];
    },
  });

  /* Silent when the migration has not been applied yet, rather than a red
     error on a page whose other half works. The function is the only thing
     0051 adds that the UI reads, so its absence means exactly one thing. */
  if (error) return null;

  return (
    <div className="card mt-5 p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2">
          <Users size={20} className="text-accent-soft" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Team connections</h3>
          <p className="text-xs text-faint">
            Everyone connects their own mailbox from the cards above. This is who has.
          </p>
        </div>
        {data && data.length > 0 && (
          <span className="pill bg-zinc-500/15 text-faint">
            {data.filter((m) => m.gmail_connected || m.outlook_connected).length} of {data.length} connected
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-faint">
          <Loader2 size={14} className="animate-spin" /> Loading the team…
        </p>
      ) : !data?.length ? (
        <p className="mt-4 text-sm text-muted">
          No teammates yet. Invite them from the Admin panel; each one connects their own mail here.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {data.map((m) => {
            const none = !m.gmail_connected && !m.outlook_connected;
            return (
              <div
                key={m.user_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-sm"
              >
                <span className="font-medium">{m.name}</span>
                {m.login_email && <span className="text-xs text-faint">{m.login_email}</span>}

                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <Pill on={m.gmail_connected} label="Gmail" icon={GmailMark} />
                  <Pill
                    on={m.outlook_connected}
                    label="Outlook"
                    icon={OutlookMark}
                    /* The address, because on Microsoft it is routinely NOT the
                       login email, and "Outlook ✓" without it does not say
                       which mailbox was connected. */
                    title={m.outlook_account ?? undefined}
                  />
                  <Pill
                    on={m.teams_ready}
                    label="Teams"
                    icon={TeamsMark}
                    title={
                      m.outlook_connected && !m.teams_ready
                        ? "Connected to Microsoft before Teams was supported. Reconnecting once switches it on."
                        : undefined
                    }
                  />
                </div>

                {none && (
                  <p className="w-full text-xs text-faint">
                    Nothing connected yet. They sign in and press Connect on the Gmail or Outlook card.
                  </p>
                )}
                {m.outlook_connected && !m.teams_ready && (
                  <p className="w-full text-xs text-amber-400/80">
                    Microsoft connected before Teams support. One reconnect from the Teams card adds chats.
                  </p>
                )}
                {m.outlook_account && (
                  <p className="w-full truncate text-xs text-faint">Outlook: {m.outlook_account}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
