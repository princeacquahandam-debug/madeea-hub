/** UI-only descriptor for a selectable Command Center row. */
import type { LucideIcon } from "lucide-react";

export interface NavOption {
  id: string;
  icon: LucideIcon;
  label: string;
  sub?: string;
  badge?: string;
  /** Invoked on click / Enter. */
  activate: () => void;
  /** History rows only: pin state + toggle. */
  pinned?: boolean;
  onPin?: () => void;
}
