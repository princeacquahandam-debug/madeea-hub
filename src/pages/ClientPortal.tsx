import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LogOut, Send, ShieldCheck, MessageSquare, LayoutDashboard,
  Activity, CalendarDays, StickyNote, Eye, Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ClientOverview } from "@/components/client/ClientOverview";
import { ClientActivity } from "@/components/client/ClientActivity";
import { ClientCalendar } from "@/components/client/ClientCalendar";
import { ClientNotes } from "@/components/client/ClientNotes";
import { ClientPeople } from "@/components/client/ClientPeople";

/**
 * What a client sees. Deliberately not the agency app with things hidden.
 *
 * A client holds no membership, so my_workspace() is NULL and the thirty-three
 * workspace policies deny everything: notes, EOD reports, the staff list. That
 * is 0065's isolation working, and it means there is no agency screen to filter
 * down to — what a client may read is their own row, their two conversations,
 * and the views 0072 and 0073 define.
 *
 * THE TAB ORDER IS THE 14 SEP WALKTHROUGH. Where do I stand, what was done,
 * what is booked, what should they know, and then the two ways to talk to
 * somebody. Messaging sits last because it is the thing a client reaches for
 * when the first four have not already answered them.
 */

type Kind = "client_ea" | "escalation";
type Tab = "overview" | "activity" | "calendar" | "notes" | "people" | Kind;

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

const TABS: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "people", label: "People", icon: Users },
  { id: "client_ea", label: CHANNEL.client_ea.label, icon: CHANNEL.client_ea.icon },
  { id: "escalation", label: CHANNEL.escalation.label, icon: CHANNEL.escalation.icon },
];

/** The panes that are not a conversation, so the message furniture falls away. */
const PANES: Partial<Record<Tab, boolean>> = {
  overview: true,
  activity: true,
  calendar: true,
  notes: true,
  people: true,
};

export default function ClientPortal({ clientId }: { clientId: string }) {
  const { user, signOut } = useAuth();
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
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

  /* A viewer has no channels at all, and that is the point of there being two
     of them: the escalation channel is where a client raises something about
     their assistant. See 0074. The database refuses them underneath, so this
     is about not offering a door that opens onto an error. */
  const tabs = useMemo(
    () => (isViewer ? TABS.filter((t) => PANES[t.id]) : TABS),
    [isViewer],
  );
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: header } = useQuery({
    queryKey: ["client-portal", "header"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_overview")
        .select("client_name, company")
        .maybeSingle();
      if (error) throw error;
      return data as { client_name: string; company: string | null } | null;
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

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--c-bg)" }}>
      <header
        className="flex items-center justify-between gap-4 px-6 py-4"
        style={{ borderBottom: "1px solid var(--c-border)" }}
      >
        <div className="min-w-0">
          <div className="text-faint text-xs uppercase tracking-wider">MadeEA Client Portal</div>
          <h1 className="truncate text-lg font-semibold">
            {header?.client_name ?? "Your account"}
            {header?.company ? <span className="text-faint font-normal"> · {header.company}</span> : null}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {isViewer ? (
            <span className="pill bg-accent/15 text-accent-soft flex items-center gap-1.5 text-xs">
              <Eye size={12} /> View only
            </span>
          ) : null}
          <span className="text-faint hidden text-sm sm:inline">{user?.email}</span>
          <button
            onClick={() => void signOut()}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ border: "1px solid var(--c-border)" }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 px-6 pt-4">
        {tabs.map(({ id, label, icon: Icon }) => {
          const on = id === tab;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
              style={{
                background: on ? "var(--c-accent)" : "transparent",
                color: on ? "#fff" : undefined,
                border: `1px solid ${on ? "var(--c-accent)" : "var(--c-border)"}`,
              }}
            >
              <Icon size={15} /> {label}
            </button>
          );
        })}
      </nav>

      {PANES[tab] ? (
        <div className="flex-1 overflow-y-auto">
          {tab === "overview" ? (
            <ClientOverview onSeeActivity={() => setTab("activity")} readOnly={isViewer} />
          ) : null}
          {tab === "activity" ? <ClientActivity /> : null}
          {tab === "calendar" ? <ClientCalendar /> : null}
          {tab === "notes" ? <ClientNotes readOnly={isViewer} /> : null}
          {tab === "people" ? <ClientPeople readOnly={isViewer} /> : null}
        </div>
      ) : (
        <>
          <p className="text-faint px-6 pt-3 text-sm">{channel!.blurb}</p>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {!active ? (
              <p className="text-faint text-sm">This channel has not been opened yet.</p>
            ) : loadingMessages ? (
              <p className="text-faint text-sm">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="text-faint text-sm">
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
            <p className="px-6 pb-2 text-sm" style={{ color: "var(--c-danger)" }}>
              {sendError}
            </p>
          ) : null}

          <div className="flex items-end gap-2 px-6 pb-6">
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
              className="flex-1 resize-none rounded-xl px-4 py-3 text-sm"
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
        </>
      )}
    </div>
  );
}
