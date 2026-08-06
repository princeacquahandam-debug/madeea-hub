import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Play,
  Rocket,
  CircleCheckBig,
  MessagesSquare,
  ListChecks,
  Sparkles,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useTour } from "@/store/tour";

type Playbook = { icon: LucideIcon; cat: string; title: string; desc: string; cta: string };

const PLAYBOOKS: Playbook[] = [
  { icon: Rocket, cat: "Getting Started", title: "The Command Center starter kit", desc: "The first things to set up in your first week, and how to make them stick.", cta: "Read guide" },
  { icon: CircleCheckBig, cat: "Tasks", title: "Running a clean task board", desc: "How to triage, prioritize and move work across To Do, In Progress and Done.", cta: "Read guide" },
  { icon: MessagesSquare, cat: "Communication", title: "Reaching inbox zero for good", desc: "The triage system top EAs use to keep executives at inbox zero every day.", cta: "Watch video" },
  { icon: ListChecks, cat: "Systems", title: "Building SOPs that stick", desc: "Turn how you work into repeatable playbooks your team can run without you.", cta: "Read guide" },
  { icon: Sparkles, cat: "AI Suite", title: "Working with Madeline AI", desc: "How to combine human judgment with AI-powered actions for maximum leverage.", cta: "Watch video" },
  { icon: ShieldCheck, cat: "Mastery", title: "Delegating without losing control", desc: "Set the guardrails that let you hand off high-trust work with total confidence.", cta: "Read guide" },
];

export default function Academy() {
  const nav = useNavigate();
  const startTour = useTour((s) => s.start);

  return (
    <div className="mx-auto max-w-5xl">
      <button
        onClick={() => nav("/")}
        className="mb-6 inline-flex items-center gap-2 rounded-xl border border-[color:var(--border-strong)] px-3.5 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
      >
        <ArrowLeft size={17} /> Back to Dashboard
      </button>

      {/* Hero */}
      <div className="text-center">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.16em] text-accent">MadeEA Academy</p>
        <h1 className="text-[34px] font-extrabold tracking-[-0.02em]">Master the Command Center</h1>
        <p className="mx-auto mt-2 max-w-xl text-[15.5px] leading-relaxed text-muted">
          Watch the walkthrough, then dig into the playbooks below to become a MadeEA Pro.
        </p>
      </div>

      {/* Video walkthrough */}
      <button
        onClick={startTour}
        className="group relative mx-auto my-11 flex aspect-video max-h-[520px] w-full max-w-3xl items-center justify-center overflow-hidden rounded-[20px] border border-border shadow-lg transition-all duration-500 hover:-translate-y-1.5 hover:border-accent/50"
        style={{ background: "linear-gradient(135deg,#0c1320 0%,#1a1108 60%,#3a1e08 100%)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(circle at 50% 50%, rgba(253,88,17,0.32), rgba(253,88,17,0) 60%)" }}
        />
        <div className="relative flex flex-col items-center gap-4 px-6 text-center">
          <span
            className="flex h-[82px] w-[82px] items-center justify-center rounded-full bg-accent text-white transition-transform duration-300 group-hover:scale-110"
            style={{ boxShadow: "0 10px 34px rgba(253,88,17,0.55)" }}
          >
            <Play size={38} className="ml-1" fill="currentColor" />
          </span>
          <span className="text-[17px] font-bold text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.4)]">
            Navigating the Command Center — Full Walkthrough
          </span>
          <span className="text-[13.5px] text-white/70">12:48 · Start here</span>
        </div>
        <span className="absolute inset-x-0 bottom-0 h-[5px] bg-white/15">
          <span className="block h-full w-[22%] bg-accent" />
        </span>
      </button>

      {/* Guides */}
      <div className="mb-7 text-center">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.16em] text-accent">Guides</p>
        <h2 className="text-[28px] font-extrabold tracking-[-0.02em]">Playbooks to level up.</h2>
        <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed text-muted">
          Practical, no-fluff guides on getting the most out of MadeEA and your executive workflow.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLAYBOOKS.map((p) => (
          <button
            key={p.title}
            className="card flex min-h-[210px] flex-col p-[22px] text-left transition-all hover:-translate-y-0.5 hover:border-accent/60"
          >
            <span
              className="mb-[18px] flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: "var(--nav-active-bg)" }}
            >
              <p.icon size={22} className="text-accent" />
            </span>
            <span className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-faint">{p.cat}</span>
            <span className="mb-2 text-[17px] font-bold leading-snug">{p.title}</span>
            <span className="flex-1 text-[13.5px] leading-relaxed text-muted">{p.desc}</span>
            <span className="mt-4 flex items-center gap-1.5 text-[13.5px] font-bold text-accent">
              {p.cta} <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
