import { Mail, Calendar, Slack, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";

const INTEGRATIONS = [
  { key: "gmail", name: "Gmail", desc: "Sync inbox into the Communication Center and send approved AI drafts.", icon: Mail },
  { key: "calendar", name: "Google Calendar", desc: "Pull upcoming meetings into the Dashboard and meeting list.", icon: Calendar },
  { key: "slack", name: "Slack", desc: "Receive automation notifications and triage Slack messages.", icon: Slack },
] as const;

export default function Integrations() {
  const { signInWithGoogle, demo } = useAuth();

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect the tools your inbox, calendar and team live in" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.map((i) => (
          <div key={i.key} className="card flex flex-col p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2">
                <i.icon size={20} className="text-accent-soft" />
              </div>
              <div>
                <h3 className="font-semibold">{i.name}</h3>
                <span className="pill bg-zinc-500/15 text-faint">Not connected</span>
              </div>
            </div>
            <p className="mt-3 flex-1 text-sm text-muted">{i.desc}</p>
            <button
              className="btn-ghost mt-4 border border-border"
              onClick={() => i.key !== "slack" && signInWithGoogle()}
              disabled={demo}
            >
              {demo ? "Configure Supabase to connect" : `Connect ${i.name}`}
            </button>
          </div>
        ))}
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <CheckCircle2 size={18} className="mt-0.5 text-emerald-400" />
        <div className="text-sm text-muted">
          <p className="font-medium text-zinc-200">How connections work</p>
          <p className="mt-1">
            OAuth runs server-side via Supabase Edge Functions — tokens are stored encrypted and the
            browser never sees a provider secret. Gmail & Calendar use Google OAuth (offline access
            for refresh tokens); Slack uses its OAuth app install flow.
          </p>
        </div>
      </div>
    </div>
  );
}
