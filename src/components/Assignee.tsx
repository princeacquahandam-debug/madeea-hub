import { useEffect, useRef, useState } from "react";
import { UserPlus, Check, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneFor } from "@/lib/team";
import { useAssignTask, useWorkspaceMembers, DEMO_ME, type Member } from "@/data/hooks";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { Task } from "@/types/db";

/** Initials in a colour that's stable per person, so the same EA reads the same everywhere. */
export function AssigneeAvatar({
  member,
  size = "sm",
  className,
}: {
  member: Member | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const dim = size === "md" ? "h-8 w-8 text-xs" : "h-6 w-6 text-[10px]";
  if (!member) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-dashed border-border text-faint",
          dim,
          className,
        )}
        title="Unassigned"
      >
        <UserPlus size={size === "md" ? 14 : 11} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        toneFor(member.user_id),
        dim,
        className,
      )}
      title={`${member.name}${member.is_me ? " (you)" : ""}`}
    >
      {member.initials}
    </span>
  );
}

/**
 * Click the avatar to reassign. In demo mode there's no database, so the change is
 * kept locally — the menu says so rather than implying it saved to a server.
 */
export function AssigneePicker({ task, size = "sm" }: { task: Task; size?: "sm" | "md" }) {
  const { data: members = [] } = useWorkspaceMembers();
  const assign = useAssignTask();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = members.find((m) => m.user_id === task.assignee_id) ?? null;
  const me = members.find((m) => m.is_me);

  function pick(to: string | null) {
    setOpen(false);
    if (to === (task.assignee_id ?? null)) return;
    assign.mutate({
      task_id: task.id,
      from: task.assignee_id ?? null,
      to,
      actor_id: me?.user_id ?? DEMO_ME,
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onPointerDown={(e) => e.stopPropagation()} // don't start a drag on the kanban board
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="rounded-full transition-transform hover:scale-110"
        aria-label={current ? `Assigned to ${current.name}. Reassign` : "Assign this task"}
      >
        <AssigneeAvatar member={current} size={size} />
      </button>

      {open && (
        <div className="card absolute right-0 z-50 mt-1.5 w-52 p-1 shadow-xl">
          <p className="eyebrow px-2 py-1.5">Assign to</p>
          {members.map((m) => (
            <button
              key={m.user_id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); pick(m.user_id); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
            >
              <AssigneeAvatar member={m} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {m.name}
                {m.is_me && <span className="text-faint"> (you)</span>}
              </span>
              {m.user_id === task.assignee_id && <Check size={13} className="shrink-0 text-accent" />}
            </button>
          ))}
          {task.assignee_id && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); pick(null); }}
              className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 pt-2 text-left text-xs text-faint hover:bg-surface-2 hover:text-zinc-100"
            >
              <UserMinus size={13} /> Unassign
            </button>
          )}
          {!isSupabaseConfigured && (
            <p className="border-t border-border px-2 py-1.5 pt-2 text-[11px] text-faint">
              Demo mode — saved in this browser only.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
