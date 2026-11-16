import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GraduationCap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { openAcademy } from "@/lib/academy";

interface Summary { paths: number; lessonsDone: number; lessonsTotal: number; certificates: number }

/**
 * The Academy's entry point inside the Hub (Abder, 16 Nov): a short summary
 * of your learning, and one click into the Academy without signing in again.
 */
export function AcademyCard() {
  const [opening, setOpening] = useState(false);
  const q = useQuery({
    queryKey: ["academy-summary"],
    enabled: !!supabase,
    retry: false,
    queryFn: async (): Promise<Summary | null> => {
      const { data: paths, error } = await supabase!.from("acad_paths").select("id").eq("status", "published");
      if (error) return null; // migration 0103 not run yet
      const { data: u } = await supabase!.auth.getUser();
      const progress = await Promise.all((paths ?? []).map((p) => supabase!.rpc("acad_path_progress", { p_path: p.id })));
      const { count } = await supabase!.from("acad_certificates").select("id", { count: "exact", head: true }).eq("user_id", u.user?.id ?? "");
      let done = 0, total = 0;
      for (const r of progress) {
        const row = (r.data as { lessons_total: number; lessons_done: number }[] | null)?.[0];
        if (row) { done += row.lessons_done; total += row.lessons_total; }
      }
      return { paths: paths?.length ?? 0, lessonsDone: done, lessonsTotal: total, certificates: count ?? 0 };
    },
  });
  const s = q.data;
  const pct = s && s.lessonsTotal ? Math.round((s.lessonsDone * 100) / s.lessonsTotal) : 0;

  return (
    <div className="card mb-5 flex flex-wrap items-center gap-4 p-5">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent-soft"><GraduationCap size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold">MadeEA Academy</p>
        <p className="text-sm text-muted">
          {s
            ? s.paths
              ? `${s.paths} learning path${s.paths === 1 ? "" : "s"} for you · ${s.lessonsDone} of ${s.lessonsTotal} lessons done (${pct}%) · ${s.certificates} certificate${s.certificates === 1 ? "" : "s"}`
              : "Courses, learning paths and certificates. Nothing is assigned to you yet."
            : "Courses, learning paths and certificates, on their own site. Same sign-in as the Hub."}
        </p>
        {s && s.lessonsTotal > 0 && (
          <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
      <button className="btn-primary" disabled={opening} onClick={async () => { setOpening(true); await openAcademy(); setOpening(false); }}>
        <ExternalLink size={15} />{opening ? "Opening…" : "Open the Academy"}
      </button>
    </div>
  );
}
