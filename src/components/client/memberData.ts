import { supabase } from "@/lib/supabase";

/**
 * Reads shared by the staff panel (a client's own team members, 0078/0085).
 *
 * ONE SHAPE PER KEY. My Work, the board, the header search and the bell all
 * read the member's tasks, under one key and one select, so a pane can never
 * be handed another pane's narrower rows from the cache.
 */

export type MyTaskStatus = "todo" | "in_progress" | "follow_up" | "review" | "done";

export interface MyTask {
  id: string;
  title: string;
  status: MyTaskStatus;
  priority: string | null;
  due_label: string | null;
  due_at: string | null;
  blocked: boolean;
  client_visible_blocker: string | null;
  completed_at: string | null;
  created_at: string;
}

export const MY_TASKS_KEY = ["client-portal", "my-tasks"] as const;

export async function fetchMyTasks(): Promise<MyTask[]> {
  const { data, error } = await supabase!
    .from("client_my_tasks")
    .select("id, title, status, priority, due_label, due_at, blocked, client_visible_blocker, completed_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MyTask[];
}

export interface TeamMessage {
  id: string;
  body: string;
  sent_at: string;
  mine: boolean;
  /** The thread's staff member; the primary sees it, staff never do. */
  member_email: string | null;
}

export const TEAM_CHAT_KEY = ["client-portal", "team-chat"] as const;

export async function fetchTeamChat(): Promise<TeamMessage[]> {
  const { data, error } = await supabase!
    .from("client_team_chat")
    .select("id, body, sent_at, mine, member_email")
    .order("sent_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as TeamMessage[];
}

export interface StaffReport {
  id: string;
  work_date: string;
  done: string;
  blocked: string;
  next: string;
  created_at: string;
  updated_at: string;
  is_you: boolean;
  email: string | null;
}

export const TEAM_REPORTS_KEY = ["client-portal", "team-reports"] as const;

export async function fetchTeamReports(): Promise<StaffReport[]> {
  const { data, error } = await supabase!
    .from("client_team_reports")
    .select("id, work_date, done, blocked, next, created_at, updated_at, is_you, email")
    .order("work_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as StaffReport[];
}

/** Today as the member's own calendar date (0027: their day, not the server's). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
