/** Icon + label per search-entity type. Shared by SearchResults and cards. */
import {
  FolderGit2, StickyNote, CheckSquare, Users, Mail, ClipboardCheck, CalendarClock, Workflow, Sparkles, LayoutDashboard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SearchEntity } from "@/lib/command-center/types";

export const ENTITY_META: Record<SearchEntity, { icon: LucideIcon; label: string }> = {
  project: { icon: FolderGit2, label: "Project" },
  note: { icon: StickyNote, label: "Note" },
  task: { icon: CheckSquare, label: "Task" },
  client: { icon: Users, label: "Client" },
  message: { icon: Mail, label: "Message" },
  sop: { icon: ClipboardCheck, label: "SOP" },
  meeting: { icon: CalendarClock, label: "Meeting" },
  automation: { icon: Workflow, label: "Automation" },
  generation: { icon: Sparkles, label: "AI Output" },
  page: { icon: LayoutDashboard, label: "Page" },
};
