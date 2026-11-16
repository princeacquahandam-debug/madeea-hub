import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, Printer } from "lucide-react";
import { fmtDate, useMyCertificates, usePaths } from "@/lib/api";
import { mediaUrl, supabase } from "@/lib/supabase";
import { Empty, Loading, PageTitle } from "@/components/Shell";

export function CertificateList() {
  const certs = useMyCertificates();
  const paths = usePaths();
  if (certs.isLoading || paths.isLoading) return <Loading />;
  return (
    <>
      <PageTitle title="Certificates" sub="Every learning path you've completed." />
      {!certs.data?.length ? (
        <Empty icon={Award} title="No certificates yet">Finish a learning path, and its final assessment if it has one, to earn one.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {certs.data.map((c) => (
            <Link key={c.id} to={`/certificate/${c.code}`} className="card flex items-center gap-4 p-4 hover:border-accent">
              <Award className="shrink-0 text-good" size={26} />
              <div className="min-w-0 flex-1">
                <p className="font-bold">{paths.data?.find((p) => p.id === c.path_id)?.title ?? "Learning path"}</p>
                <p className="text-sm text-muted">{fmtDate(c.issued_at)}{c.score != null ? ` · ${c.score}%` : ""} · {c.code}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

interface CertData {
  code: string; issued_at: string; score: number | null; learner: string; path: string; academy: string;
  signer_name: string | null; signer_title: string | null; signature_path: string | null;
}

/** A printable certificate. "Print or save as PDF" uses the browser's print. */
export function CertificateView() {
  const { code } = useParams();
  const q = useQuery({
    queryKey: ["cert", code],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("acad_certificate", { p_code: code });
      if (error) throw error;
      return data as CertData | null;
    },
  });
  if (q.isLoading) return <Loading />;
  const c = q.data;
  if (!c) return <p className="py-16 text-center text-muted">Certificate not found.</p>;
  const sig = mediaUrl(c.signature_path);

  return (
    <>
      <div className="no-print mb-4 flex items-center gap-2">
        <Link to="/certificates" className="btn-ghost -ml-2"><ArrowLeft size={15} />Certificates</Link>
        <div className="flex-1" />
        <button className="btn-primary" onClick={() => window.print()}><Printer size={15} />Print or save as PDF</button>
      </div>
      <div className="mx-auto aspect-[1.414] w-full max-w-4xl rounded-2xl border-[10px] border-double border-accent/40 bg-white p-[5%] text-center text-[#1c1c1e] print:max-w-none print:border-[#d2562b]">
        <div className="flex h-full flex-col items-center justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-[#b8471f]">{c.academy}</p>
            <p className="mt-4 text-3xl font-extrabold sm:text-4xl">Certificate of Completion</p>
          </div>
          <div>
            <p className="text-sm text-[#6e6e73]">This certifies that</p>
            <p className="my-2 text-3xl font-extrabold sm:text-4xl">{c.learner}</p>
            <p className="text-sm text-[#6e6e73]">has successfully completed</p>
            <p className="mt-2 text-xl font-bold sm:text-2xl">{c.path}</p>
            {c.score != null && <p className="mt-1 text-sm text-[#6e6e73]">with a final score of {c.score}%</p>}
          </div>
          <div className="flex w-full items-end justify-between gap-6 text-left text-sm">
            <div>
              <p className="text-[#6e6e73]">Date</p>
              <p className="font-semibold">{fmtDate(c.issued_at)}</p>
              <p className="mt-2 text-xs text-[#74747a]">Certificate no. {c.code}</p>
            </div>
            <div className="min-w-[12rem] text-center">
              {sig ? <img src={sig} alt="Signature" className="mx-auto h-14 object-contain" /> : <div className="h-14" />}
              <div className="border-t border-[#1c1c1e] pt-1">
                <p className="font-semibold">{c.signer_name ?? c.academy}</p>
                {c.signer_title && <p className="text-xs text-[#6e6e73]">{c.signer_title}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
