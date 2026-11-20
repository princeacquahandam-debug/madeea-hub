import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

/**
 * Your name, editable (19 Nov 2026). It used to be readable only: a new
 * account took its name from the email address, and fixing it meant SQL.
 * One save updates both places the Hub reads a name from: your sign-in
 * details (the greeting, the avatar initials) and your profile (task
 * assignees, the team list, EOD reports filed from now on).
 */
export function AccountCard({ hint }: { hint?: string } = {}) {
  const { user, demo } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const clean = name.replace(/\s+/g, " ").trim();
  const initialsOf = (n: string) => n.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const invalid = clean.length < 2 ? "Enter at least 2 characters." : clean.length > 60 ? "60 characters at most." : "";

  async function save() {
    if (!supabase || !user || invalid) return;
    setSaving(true);
    setError("");
    const { error: e1 } = await supabase.auth.updateUser({ data: { full_name: clean } });
    const { error: e2 } = e1
      ? { error: null }
      : await supabase.from("profiles").update({ full_name: clean, initials: initialsOf(clean) }).eq("id", user.id);
    setSaving(false);
    if (e1 || e2) {
      setError((e1 ?? e2)?.message ?? "Could not save your name.");
      return;
    }
    // Names show in many lists (assignees, team, reports); refetch them.
    await qc.invalidateQueries();
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <section className="card p-5">
      <p className="field-label">Account</p>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent-soft">
          {editing && clean ? initialsOf(clean) : user?.initials ?? "-"}
        </div>
        {editing ? (
          <form
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
          >
            <label htmlFor="account-name" className="sr-only">Your name</label>
            <input
              id="account-name"
              className="input h-9 min-w-[12rem] flex-1"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setError(""); } }}
            />
            <button type="submit" className="btn-primary h-9 px-3" disabled={saving || !!invalid || clean === user?.name}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost h-9 px-3" onClick={() => { setEditing(false); setError(""); }}>
              Cancel
            </button>
            {(error || (name && invalid)) && <p className="w-full text-xs text-red-400">{error || invalid}</p>}
          </form>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{user?.name ?? "-"}</p>
              <p className="text-xs text-faint">{user?.email ?? ""}</p>
            </div>
            {saved && <span className="text-xs text-emerald-400">Saved</span>}
            {!demo && (
              <button className="btn-ghost h-8 border border-border px-3 text-[13px]" onClick={() => { setName(user?.name ?? ""); setEditing(true); }}>
                Edit name
              </button>
            )}
          </>
        )}
      </div>
      {editing && <p className="mt-2 text-xs text-faint">{hint ?? "Shown in your greeting, on tasks assigned to you, in the team list and on reports you file from now on."}</p>}
    </section>
  );
}
