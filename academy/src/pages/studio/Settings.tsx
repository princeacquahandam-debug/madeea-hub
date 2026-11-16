import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eraser, PenLine, Save, Upload } from "lucide-react";
import { useSettings } from "@/lib/api";
import { errText, mediaUrl, supabase, uploadMedia } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Loading, PageTitle } from "@/components/Shell";

/**
 * Academy settings (16 Nov): who signs the certificate, their title, and the
 * signature itself, uploaded as an image or drawn here (Rowena asked for the
 * written signature on the certificate).
 */
export default function Settings() {
  const { me } = useAuth();
  const s = useSettings();
  const qc = useQueryClient();
  const [name, setName] = useState("MadeEA Academy");
  const [signer, setSigner] = useState("");
  const [title, setTitle] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draw, setDraw] = useState(false);

  useEffect(() => {
    if (s.data) { setName(s.data.academy_name); setSigner(s.data.signer_name ?? ""); setTitle(s.data.signer_title ?? ""); setSig(s.data.signature_path); }
  }, [s.data]);

  if (s.isLoading) return <Loading />;
  const ws = me?.workspace_id ?? "";

  const save = async (signature = sig) => {
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("acad_settings").upsert({
      workspace_id: ws, academy_name: name.trim() || "MadeEA Academy", signer_name: signer.trim() || null, signer_title: title.trim() || null,
      signature_path: signature, updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) setMsg({ ok: false, text: errText(error) });
    else { setMsg({ ok: true, text: "Saved. New and existing certificates show it." }); await qc.invalidateQueries({ queryKey: ["settings"] }); }
  };

  const upload = async (file: Blob, ext: string) => {
    try { const p = await uploadMedia(ws, file, "signatures", ext); setSig(p); await save(p); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  };

  const src = mediaUrl(sig);

  return (
    <>
      <PageTitle title="Settings" sub="The Academy's name and the certificate signature." />
      {msg && <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-good/15 text-good" : "bg-accent/15 text-accent-soft"}`}>{msg.text}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-5">
          <h2 className="font-bold">Certificate</h2>
          <div><label className="label" htmlFor="an">Academy name (top of the certificate)</label><input id="an" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label" htmlFor="sn">Signed by</label><input id="sn" className="input" placeholder="e.g. Prince Acquah" value={signer} onChange={(e) => setSigner(e.target.value)} /></div>
          <div><label className="label" htmlFor="st">Their title</label><input id="st" className="input" placeholder="e.g. Founder, MadeEA" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div>
            <p className="label">Signature</p>
            {src ? <img src={src} alt="Signature" className="mb-2 h-20 rounded-lg border border-border bg-white object-contain p-2" /> : <p className="mb-2 text-sm text-faint">None yet.</p>}
            <div className="flex flex-wrap gap-2">
              <label className="btn cursor-pointer"><Upload size={14} />Upload an image
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f, f.name.split(".").pop() ?? "png"); }} />
              </label>
              <button className="btn" onClick={() => setDraw(!draw)}><PenLine size={14} />Draw it</button>
              {src && <button className="btn-ghost" onClick={() => { setSig(null); void save(null); }}>Remove</button>}
            </div>
            {draw && <SignaturePad onDone={(blob) => { setDraw(false); void upload(blob, "png"); }} />}
            <p className="mt-2 text-xs text-faint">A PNG with a transparent or white background looks best.</p>
          </div>
          <button className="btn-primary" onClick={() => save()} disabled={busy}><Save size={15} />{busy ? "Saving…" : "Save"}</button>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-bold">Preview</h2>
          <div className="rounded-xl border-4 border-double border-accent/40 bg-white p-6 text-center text-[#1c1c1e]">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#b8471f]">{name || "MadeEA Academy"}</p>
            <p className="mt-2 text-xl font-extrabold">Certificate of Completion</p>
            <p className="mt-4 text-xs text-[#6e6e73]">This certifies that</p>
            <p className="text-lg font-bold">Learner Name</p>
            <p className="text-xs text-[#6e6e73]">has successfully completed <b>Learning Path</b></p>
            <div className="mx-auto mt-5 w-44">
              {src ? <img src={src} alt="" className="mx-auto h-10 object-contain" /> : <div className="h-10" />}
              <div className="border-t border-[#1c1c1e] pt-1 text-xs"><p className="font-semibold">{signer || "Signer"}</p><p className="text-[#6e6e73]">{title || "Title"}</p></div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function SignaturePad({ onDone }: { onDone: (b: Blob) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1c1c1e";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * ref.current!.width) / r.width, y: ((e.clientY - r.top) * ref.current!.height) / r.height };
  };

  return (
    <div className="mt-3">
      <canvas ref={ref} width={600} height={200} className="w-full touch-none rounded-lg border border-border bg-white"
        onPointerDown={(e) => { drawing.current = true; const p = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(p.x, p.y); (e.target as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const p = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.lineTo(p.x, p.y); ctx.stroke(); setEmpty(false); }}
        onPointerUp={() => { drawing.current = false; }} />
      <div className="mt-2 flex gap-2">
        <button className="btn" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setEmpty(true); }}><Eraser size={14} />Clear</button>
        <button className="btn-primary" disabled={empty} onClick={() => ref.current!.toBlob((b) => b && onDone(b), "image/png")}>Use this signature</button>
      </div>
    </div>
  );
}
