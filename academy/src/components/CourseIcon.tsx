import {
  BookOpen, Bot, Briefcase, Calendar, GraduationCap, Inbox, Lightbulb, MessageSquare, Plane, ShieldCheck, Sparkles, Target,
} from "lucide-react";

export const ICONS = {
  book: BookOpen, graduation: GraduationCap, ai: Bot, sparkles: Sparkles, inbox: Inbox, calendar: Calendar,
  travel: Plane, briefcase: Briefcase, chat: MessageSquare, shield: ShieldCheck, target: Target, idea: Lightbulb,
} as const;

export type IconName = keyof typeof ICONS;

export function CourseIcon({ icon, size = "md" }: { icon: string; size?: "sm" | "md" | "lg" }) {
  const Icon = ICONS[icon as IconName] ?? BookOpen;
  const box = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-8 w-8" : "h-11 w-11";
  const px = size === "lg" ? 26 : size === "sm" ? 15 : 20;
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl bg-accent/15 text-accent-soft ${box}`}>
      <Icon size={px} />
    </span>
  );
}
