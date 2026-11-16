import { useEffect, useRef, useState } from "react";
import { academySignInUrl, ACADEMY_URL } from "@/lib/academy";

/**
 * hub.madeea.io/academy-sso: where the Academy's "Continue with MadeEA Hub"
 * button lands. If the person isn't signed in to the Hub they see the Hub's
 * sign-in first (App.tsx), then come straight back here and on to the
 * Academy, signed in.
 */
export default function AcademySso() {
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    academySignInUrl()
      .then((url) => window.location.replace(url))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  return (
    <div className="flex h-screen items-center justify-center px-4 text-center">
      {err ? (
        <div className="card max-w-sm p-6">
          <p className="font-semibold">Couldn't open the Academy</p>
          <p className="mt-1 text-sm text-muted">{err}</p>
          <div className="mt-4 flex justify-center gap-2">
            <a className="btn" href="/">Go to the Hub</a>
            <a className="btn" href={ACADEMY_URL}>Academy sign-in</a>
          </div>
        </div>
      ) : (
        <p className="text-sm text-faint">Opening MadeEA Academy…</p>
      )}
    </div>
  );
}
