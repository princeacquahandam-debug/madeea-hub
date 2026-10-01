import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { atLeast, useMyRole } from "@/data/hooks";

/**
 * The shared do-not-contact list (migration 0079), in Settings.
 *
 * Every route that messages people checks this list before sending: the Hub's
 * Instagram, WhatsApp and email sends, and n8n's SMS nurture and Instagram
 * follow-ups. People land on it by replying "stop" (or similar) on any
 * channel, or by a team member adding them here.
 *
 * Anyone on the team can add someone; adding is always the safe direction.
 * Only an admin can lift an opt-out, with a reason, and lifting keeps the
 * record: "when did they say stop, and who reversed it" always has an answer.
 */

type Kind = "email" | "phone" | "instagram" | "ghl_contact";

interface Row {
  id: string;
  batch: string;
  kind: Kind;
  value: string;
  source: string;
  message: string | null;
  reason: string | null;
  created_at: string;
  lifted_at: string | null;
  lift_reason: string | null;
}

interface OptOut {
  batch: string;
  firstId: string;
  ids: { kind: Kind; value: string }[];
  source: string;
  message: string | null;
  reason: string | null;
  created_at: string;
  lifted_at: string | null;
  lift_reason: string | null;
}

const KIND_LABEL: Record<Kind, string> = {
  email: "Email",
  phone: "Phone / WhatsApp",
  instagram: "Instagram ID",
  ghl_contact: "GHL contact",
};

const SOURCE_LABEL: Record<string, string> = {
  sms: "Replied STOP by text",
  instagram: "Asked to stop on Instagram",
  whatsapp: "Asked to stop on WhatsApp",
  email: "Asked to stop by email",
  manual: "Added by the team",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function DoNotContactPanel() {
  const qc = useQueryClient();
  const { data: role } = useMyRole();
  const isAdmin = atLeast(role, "admin");
  const [q, setQ] = useState("");
  const [showLifted, setShowLifted] = useState(false);
  const [kind, setKind] = useState<Exclude<Kind, "ghl_contact">>("email");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [lifting, setLifting] = useState<string | null>(null);
  const [liftReason, setLiftReason] = useState("");

  const list = useQuery({
    queryKey: ["do-not-contact"],
    enabled: !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("do_not_contact")
        .select("id,batch,kind,value,source,message,reason,created_at,lifted_at,lift_reason")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as Row[];
    },
  });

  // One opt-out can carry several identifiers (phone, email, GHL contact).
  // Shown, and lifted, as one.
  const optOuts = useMemo<OptOut[]>(() => {
    const by = new Map<string, OptOut>();
    for (const r of list.data ?? []) {
      const o = by.get(r.batch);
      if (o) o.ids.push({ kind: r.kind, value: r.value });
      else by.set(r.batch, { batch: r.batch, firstId: r.id, ids: [{ kind: r.kind, value: r.value }], source: r.source,
        message: r.message, reason: r.reason, created_at: r.created_at, lifted_at: r.lifted_at, lift_reason: r.lift_reason });
    }
    const term = q.trim().toLowerCase();
    // Phones are stored as digits only, so "+44 7700" has to match on its digits.
    const digits = term.replace(/[^0-9]/g, "");
    return [...by.values()].filter((o) =>
      (showLifted || !o.lifted_at) &&
      (!term
        || o.ids.some((i) => i.value.includes(term) || (digits.length >= 4 && i.kind === "phone" && i.value.includes(digits)))
        || (o.reason ?? "").toLowerCase().includes(term)));
  }, [list.data, q, showLifted]);

  const add = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase!.auth.getUser();
      const { error } = await supabase!.from("do_not_contact").insert({
        kind, value: value.trim(), source: "manual", reason: note.trim() || null, created_by: u.user?.id,
      });
      if (error) throw new Error(error.code === "23505" ? "They're already on the list." : error.message.replace(/^do_not_contact: /, ""));
    },
    onSuccess: () => { setValue(""); setNote(""); qc.invalidateQueries({ queryKey: ["do-not-contact"] }); },
  });

  const lift = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase!.rpc("do_not_contact_lift", { p_id: id, p_reason: liftReason });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setLifting(null); setLiftReason(""); qc.invalidateQueries({ queryKey: ["do-not-contact"] }); },
  });

  const missing = list.error && /do_not_contact|relation|does not exist/i.test(String((list.error as Error).message));

  return (
    <section className="card p-5" aria-labelledby="dnc-title">
      <p id="dnc-title" className="field-label flex items-center gap-1.5"><Ban size={13} /> Do not contact</p>
      <p className="mb-4 text-sm text-muted">
        People who asked not to be messaged. Every system checks this list before sending: replies from
        the inbox, and the n8n text, email and Instagram follow-ups. Replying "stop" on any channel adds
        someone automatically.
      </p>

      {!supabase ? (
        <p className="text-sm text-faint">Available once the Hub is connected to its database.</p>
      ) : missing ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-[12.5px] text-muted">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          Run migration 0079 to turn on the do-not-contact list.
        </p>
      ) : (
        <>
          <form
            className="mb-4 grid gap-2 rounded-lg border border-border p-3"
            onSubmit={(e) => { e.preventDefault(); if (value.trim()) add.mutate(); }}
          >
            <p className="text-xs font-semibold text-muted">Add someone</p>
            <div className="flex flex-wrap gap-2">
              <select id="dnc-kind" aria-label="What you have for them" className="input w-auto" value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="email">Email</option>
                <option value="phone">Phone / WhatsApp</option>
                <option value="instagram">Instagram ID</option>
              </select>
              <input id="dnc-value" className="input min-w-0 flex-1" value={value} onChange={(e) => setValue(e.target.value)}
                placeholder={kind === "email" ? "name@example.com" : kind === "phone" ? "+44 7700 900123" : "Instagram ID from the inbox"}
                aria-label="Their email, phone or Instagram ID" />
            </div>
            <input id="dnc-note" className="input" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Why (optional), e.g. asked on a call on 2 Oct" aria-label="Why they're being added" />
            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary" disabled={!value.trim() || add.isPending}>
                <Plus size={15} /> {add.isPending ? "Adding…" : "Add to list"}
              </button>
              {add.error && <span className="text-xs text-red-400">{(add.error as Error).message}</span>}
            </div>
          </form>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input id="dnc-search" className="input pl-8" value={q} onChange={(e) => setQ(e.target.value.toLowerCase())}
                placeholder="Search by email, phone or ID" aria-label="Search the do-not-contact list" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input id="dnc-lifted" type="checkbox" checked={showLifted} onChange={(e) => setShowLifted(e.target.checked)} />
              Show lifted
            </label>
          </div>

          {list.isLoading ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : list.error ? (
            <p className="text-sm text-red-400">Couldn't load the list: {(list.error as Error).message}</p>
          ) : optOuts.length === 0 ? (
            <p className="rounded-lg bg-surface-2/50 p-3 text-sm text-faint">
              {q ? "Nobody on the list matches that." : "Nobody has opted out yet."}
            </p>
          ) : (
            <ul className="space-y-2">
              {optOuts.map((o) => (
                <li key={o.batch} className={`rounded-lg border border-border p-3 ${o.lifted_at ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap gap-1.5">
                    {o.ids.map((i) => (
                      <span key={i.kind + i.value} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs" title={KIND_LABEL[i.kind]}>
                        <span className="text-faint">{KIND_LABEL[i.kind]}:</span> {i.kind === "phone" ? "+" + i.value : i.value}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    {SOURCE_LABEL[o.source] ?? o.source} · {fmt(o.created_at)}
                    {o.message ? <> · "{o.message.slice(0, 60)}"</> : null}
                    {o.reason ? <> · {o.reason}</> : null}
                  </p>
                  {o.lifted_at ? (
                    <p className="mt-1 text-xs text-faint">Lifted {fmt(o.lifted_at)}: {o.lift_reason}</p>
                  ) : isAdmin && lifting !== o.batch ? (
                    <button className="mt-2 text-xs text-muted underline-offset-2 hover:text-text hover:underline"
                      onClick={() => { setLifting(o.batch); setLiftReason(""); lift.reset(); }}>
                      They opted back in: lift this
                    </button>
                  ) : isAdmin ? (
                    <form className="mt-2 flex flex-wrap items-center gap-2"
                      onSubmit={(e) => { e.preventDefault(); if (liftReason.trim()) lift.mutate(o.firstId); }}>
                      <input id={`dnc-lift-${o.batch}`} autoFocus className="input min-w-0 flex-1 text-xs" value={liftReason}
                        onChange={(e) => setLiftReason(e.target.value)} placeholder="How they opted back in, e.g. by email on 3 Oct"
                        aria-label="How they opted back in" />
                      <button type="submit" className="btn-ghost border border-border text-xs" disabled={!liftReason.trim() || lift.isPending}>
                        {lift.isPending ? "Lifting…" : "Lift"}
                      </button>
                      <button type="button" className="text-xs text-faint hover:text-text" onClick={() => setLifting(null)}>Cancel</button>
                      {lift.error && <span className="w-full text-xs text-red-400">{(lift.error as Error).message}</span>}
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {!isAdmin && <p className="mt-3 text-xs text-faint">Only an admin can lift an opt-out.</p>}
        </>
      )}
    </section>
  );
}
