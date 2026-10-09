import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Send, ShieldCheck, MessageSquare, LayoutDashboard,
  Activity, CalendarDays, StickyNote, Users, Share2, Briefcase, UsersRound, KanbanSquare, ClipboardList, Plug, MessagesSquare,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ClientOverview } from "@/components/client/ClientOverview";
import { ClientActivity } from "@/components/client/ClientActivity";
import { ClientIntegrations } from "@/components/client/ClientIntegrations";
import { ClientMemberBoard } from "@/components/client/ClientMemberBoard";
import { ClientStaffReport } from "@/components/client/ClientStaffReport";
import { ClientTeamChat } from "@/components/client/ClientTeamChat";
import { ClientCalendar } from "@/components/client/ClientCalendar";
import { ClientNotes } from "@/components/client/ClientNotes";
import { ClientPeople } from "@/components/client/ClientPeople";
import { ClientDelegation } from "@/components/client/ClientDelegation";
import { ClientShell, type ClientNavItem } from "@/components/client/ClientShell";
import { ClientSettings } from "@/components/client/ClientSettings";
import { ClientMyWork } from "@/components/client/ClientMyWork";
import { ClientTeam } from "@/components/client/ClientTeam";
import { ClientBoard } from "@/components/client/ClientBoard";
import { ClientReports } from "@/components/client/ClientReports";
import { ClientHeaderTools } from "@/components/client/ClientHeaderTools";
import { ClientMadeline } from "@/components/client/ClientMadeline";

/**
 * What a client sees. Deliberately not the agency app with things hidden.
 *
 * A client holds no membership, so my_workspace() is NULL and the thirty-three
 * workspace policies deny everything: notes, EOD reports, the staff list. That
 * is 0065's isolation working, and it means there is no agency screen to filter
 * down to — what a client may read is their own row, their two conversations,
 * and the views 0072 and 0073 define.
 *
 * THE NAV ORDER IS THE 14 SEP WALKTHROUGH. Where do I stand, what was done,
 * what is booked, what should they know, and then the two ways to talk to
 * somebody. Messaging sits last because it is the thing a client reaches for
 * when the first four have not already answered them.
 *
 * The shell around it is ClientShell, which borrows the agency sidebar's own
 * wordmark, nav-item and card classes rather than restating them. The portal
 * is the only screen most clients ever see, and it used to be the one screen
 * in the product with no design on it.
 */

type Kind = "client_ea" | "escalation";
type Tab = "overview" | "tasks" | "reports" | "activity" | "calendar" | "notes" | "delegate" | "people" | "team" | "mywork" | "settings" | "accounts" | "mytasks" | "myreport" | "staffchat" | Kind;

interface Conversation {
  id: string;
  kind: Kind;
}

interface Message {
  id: string;
  body: string;
  sent_at: string;
  sender_id: string | null;
}

const CHANNEL: Record<Kind, { label: string; blurb: string; icon: typeof MessageSquare }> = {
  client_ea: {
    label: "Your assistant",
    blurb:
      "Private between you and the assistant accountable for your account. Agency management cannot read this channel.",
    icon: MessageSquare,
  },
  escalation: {
    label: "Agency leadership",
    blurb:
      "For anything you would rather not raise with your assistant. Your assistant cannot read this channel.",
    icon: ShieldCheck,
  },
};

/* Grouped, because eight destinations in one flat row gave equal weight to
   "where does my account stand" and "message the agency about a problem". The
   headings answer three different questions, in the order a client asks them. */
const TABS: (ClientNavItem & { id: Tab; title: string; subtitle: string })[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Your account",
    title: "Overview", subtitle: "Where your account stands right now." },
  { id: "tasks", label: "Tasks", icon: KanbanSquare, group: "Your account",
    title: "Tasks", subtitle: "Everything on your account, by where it stands." },
  { id: "reports", label: "Daily reports", icon: ClipboardList, group: "Your account",
    title: "Daily reports", subtitle: "What your assistant got done each day, what's blocked, and what's next." },
  { id: "activity", label: "Activity", icon: Activity, group: "Your account",
    title: "Activity", subtitle: "What your assistant did, day by day." },
  { id: "calendar", label: "Calendar", icon: CalendarDays, group: "Your account",
    title: "Calendar", subtitle: "What is booked on your account." },
  { id: "notes", label: "Notes", icon: StickyNote, group: "Working together",
    title: "Notes", subtitle: "Things your assistant should keep to hand." },
  { id: "delegate", label: "Delegate", icon: Share2, group: "Working together",
    title: "Delegate", subtitle: "Hand a piece of work over properly." },
  { id: "team", label: "Staff", icon: UsersRound, group: "Working together",
    title: "Your staff", subtitle: "Their hours, their screenshots, and the work you hand them." },
  { id: "people", label: "People", icon: Users, group: "Working together",
    title: "People", subtitle: "Who can see this account." },
  { id: "accounts", label: "Connected accounts", icon: Plug, group: "Working together",
    title: "Connected accounts", subtitle: "Bring your Google or Outlook calendar into MadeEA, so your assistant can plan around it." },
  { id: "client_ea", label: CHANNEL.client_ea.label, icon: CHANNEL.client_ea.icon, group: "Messages",
    title: CHANNEL.client_ea.label, subtitle: CHANNEL.client_ea.blurb },
  { id: "escalation", label: CHANNEL.escalation.label, icon: CHANNEL.escalation.icon, group: "Messages",
    title: CHANNEL.escalation.label, subtitle: CHANNEL.escalation.blurb },
  { id: "staffchat", label: "Your staff", icon: MessagesSquare, group: "Messages",
    title: "Your staff", subtitle: "A private thread with each of your staff. Your assistant and the agency don't see these." },
];

/** The panes that are not a conversation, so the message furniture falls away. */
const PANES: Partial<Record<Tab, boolean>> = {
  overview: true,
  tasks: true,
  reports: true,
  activity: true,
  calendar: true,
  notes: true,
  delegate: true,
  people: true,
  team: true,
  mywork: true,
  settings: true,
  accounts: true,
  mytasks: true,
  myreport: true,
  staffchat: true,
};

/* A member's nav is not the client's with things removed. They get their own
   work, and the two panes that give it context -- what is booked, and what the
   client wrote down. Overview, Activity, Delegate, Team and People are the
   account's, not theirs. */
const MEMBER_NAV: (ClientNavItem & { id: Tab; title: string; subtitle: string })[] = [
  { id: "mywork", label: "My Work", icon: Briefcase, group: "Today",
    title: "My work", subtitle: "Your clock, your tasks, and the day so far." },
  { id: "calendar", label: "Calendar", icon: CalendarDays, group: "Today",
    title: "Calendar", subtitle: "What is booked on this account." },
  { id: "mytasks", label: "Tasks", icon: KanbanSquare, group: "Work",
    title: "Tasks", subtitle: "Your work, by where it stands. Stuck? Say so and the account owner is told." },
  { id: "myreport", label: "Daily report", icon: ClipboardList, group: "Work",
    title: "Daily report", subtitle: "What you did, what's blocked, and what's next, for the account owner." },
  { id: "notes", label: "Notes", icon: StickyNote, group: "Notes & messages",
    title: "Notes", subtitle: "What's been shared on this account." },
  { id: "staffchat", label: "Account owner", icon: MessagesSquare, group: "Notes & messages",
    title: "Messages", subtitle: "A private thread between you and the account owner." },
];

/* Madeline's source chips name the client's tabs; a member has their own. */
const MEMBER_TAB_FOR: Record<string, Tab> = { tasks: "mytasks", activity: "mywork" };

/* Reached from the sidebar footer rather than the nav, which is where the staff
   app keeps it too. It is account housekeeping, not a place you work. */
const SETTINGS_META = {
  title: "Settings",
  subtitle: "Your sign-in, your password, and the way out.",
};

export default function ClientPortal({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  /* primary is the client. viewer is a colleague they added, who may read the
     account and nothing else (0074). Everything below reads this rather than
     testing the string in six places. */
  const { data: clientRole } = useQuery({
    queryKey: ["client-portal", "role"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc("my_client_role");
      if (error) throw error;
      return (data as string | null) ?? "primary";
    },
  });
  const isViewer = clientRole === "viewer";
  const isMember = clientRole === "member";
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const landed = useRef(false);

  /* A viewer has no channels at all, and that is the point of there being two
     of them: the escalation channel is where a client raises something about
     their assistant. See 0074. The database refuses them underneath, so this
     is about not offering a door that opens onto an error. */
  const tabs = useMemo(() => {
    if (isMember) return MEMBER_NAV;
    return isViewer ? TABS.filter((t) => PANES[t.id] && t.id !== "team" && t.id !== "accounts" && t.id !== "staffchat") : TABS;
  }, [isViewer, isMember]);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Once, when the role first resolves. A member opening on Overview would see
     an account summary they have no rows for, which reads as an empty account
     rather than as the wrong page. */
  useEffect(() => {
    if (landed.current || !clientRole) return;
    landed.current = true;
    if (clientRole === "member") setTab("mywork");
  }, [clientRole]);

  const { data: header } = useQuery({
    queryKey: ["client-portal", "header"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_overview")
        .select("client_name, company, assistant_name")
        .maybeSingle();
      if (error) throw error;
      return data as { client_name: string; company: string | null; assistant_name: string | null } | null;
    },
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ["client-portal", "conversations", clientId],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("conversations")
        .select("id, kind")
        .eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []) as Conversation[];
    },
  });

  // A pane tab matches no conversation, which is what makes the channel
  // furniture fall away without a second piece of state deciding it.
  const active = useMemo(
    () => conversations.find((c) => c.kind === tab) ?? null,
    [conversations, tab],
  );

  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ["client-portal", "messages", active?.id],
    enabled: !!active,
    // The agency replies out of band, so poll rather than leaving a client
    // staring at a reply that has already been written.
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("conversation_messages")
        .select("id, body, sent_at, sender_id")
        .eq("conversation_id", active!.id)
        .order("sent_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  const send = useMutation({
    mutationFn: async (body: string) => {
      /* sender_id is left to its column default of auth.uid(). The insert
         policy requires sender_id = auth.uid(), so setting it from here could
         only ever match or be refused; the default is the honest way to say
         "me", and it cannot drift from whoever is actually signed in. */
      const { error } = await supabase!
        .from("conversation_messages")
        .insert({ conversation_id: active!.id, body });
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["client-portal", "messages", active?.id] }),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function submit() {
    const body = draft.trim();
    if (!body || !active || send.isPending) return;
    setSendError("");
    try {
      await send.mutateAsync(body);
      setDraft("");
    } catch (e) {
      // The draft survives a failure. Retyping a message is worse than a full box.
      setSendError(e instanceof Error ? e.message : "Could not send that message.");
    }
  }

  const channel = PANES[tab] ? null : CHANNEL[tab as Kind];
  const meta = tab === "settings"
    ? SETTINGS_META
    : (tabs.find((t) => t.id === tab) ?? tabs[0]);

  return (
    <ClientShell
      nav={tabs}
      active={tab}
      onSelect={(id) => setTab(id as Tab)}
      clientName={header?.client_name ?? "Your account"}
      company={header?.company ?? null}
      email={user?.email}
      isViewer={isViewer}
      isMember={isMember}
      // The staff account gets the Hub's hover menus (9 Oct 2026).
      hoverMenus={isMember}
      headerTools={
        <>
          {/* Staff get the same tools over their own work (0085): their tasks,
              their thread with the owner, and a Madeline that reads only that. */}
          <ClientHeaderTools member={isMember} onNavigate={(id: string) => setTab(id as Tab)} />
          <ClientMadeline readOnly={isViewer} member={isMember}
            onNavigate={(id: string) => setTab((isMember ? (MEMBER_TAB_FOR[id] ?? id) : id) as Tab)} />
        </>
      }
      title={meta.title}
      subtitle={meta.subtitle}
      onOpenSettings={() => setTab("settings")}
      settingsActive={tab === "settings"}
    >
      {PANES[tab] ? (
        <>
          {tab === "overview" ? <ClientOverview onSeeActivity={() => setTab("activity")} readOnly={isViewer} /> : null}
          {tab === "tasks" ? <ClientBoard /> : null}
          {tab === "reports" ? <ClientReports /> : null}
          {tab === "activity" ? <ClientActivity /> : null}
          {tab === "calendar" ? <ClientCalendar /> : null}
          {tab === "notes" ? <ClientNotes readOnly={isViewer} member={isMember} /> : null}
          {tab === "mytasks" && isMember ? <ClientMemberBoard /> : null}
          {tab === "myreport" && isMember ? <ClientStaffReport /> : null}
          {tab === "staffchat" && !isViewer ? <ClientTeamChat asOwner={!isMember} /> : null}
          {tab === "delegate" ? <ClientDelegation readOnly={isViewer} /> : null}
          {tab === "people" ? <ClientPeople readOnly={isViewer} /> : null}
          {tab === "team" ? <ClientTeam /> : null}
          {tab === "mywork" ? <ClientMyWork clientId={clientId} onNavigate={(id) => setTab(id as Tab)} /> : null}
          {tab === "settings" ? <ClientSettings email={user?.email} /> : null}
          {tab === "accounts" && !isViewer && !isMember ? <ClientIntegrations assistantName={header?.assistant_name} /> : null}
        </>
      ) : (
        /* A conversation is one object, so it gets one card: the thread scrolls
           inside it and the composer is pinned to its foot, rather than the
           whole page scrolling and the box drifting off the bottom. */
        <div className="card flex h-[calc(100dvh-13rem)] min-h-[22rem] flex-col overflow-hidden">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {!active ? (
              <p className="text-sm text-faint">This channel has not been opened yet.</p>
            ) : loadingMessages ? (
              <p className="text-sm text-faint">Loading&hellip;</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-faint">
                No messages yet. Anything you send here starts the thread.
              </p>
            ) : (
              messages.map((m) => {
                /* A message with no sender_id is one whose account was removed —
                   0065 keeps the words when the account goes, so it must render. */
                const mine = !!m.sender_id && m.sender_id === user?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className="max-w-[min(36rem,80%)] rounded-2xl px-4 py-2.5 text-sm"
                      style={{
                        background: mine ? "var(--c-accent)" : "var(--glass)",
                        color: mine ? "#fff" : undefined,
                        border: mine ? "none" : "1px solid var(--c-border)",
                      }}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className="mt-1 text-[11px] opacity-70">
                        {new Date(m.sent_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {sendError ? (
            <p className="px-4 pb-2 text-sm" style={{ color: "var(--c-danger)" }}>{sendError}</p>
          ) : null}

          <div className="flex items-end gap-2 border-t border-border p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder={`Message ${channel!.label.toLowerCase()}…`}
              disabled={!active}
              className="min-w-0 flex-1 resize-none rounded-xl px-4 py-3 text-sm"
              style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
            />
            <button
              onClick={() => void submit()}
              disabled={!active || !draft.trim() || send.isPending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
              style={{ background: "var(--c-accent)", color: "#fff" }}
              aria-label="Send message"
            >
              <Send size={17} />
            </button>
          </div>
        </div>
      )}
    </ClientShell>
  );
}
