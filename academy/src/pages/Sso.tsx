import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

/**
 * Landing page for "Open MadeEA Academy" in the Hub. The Hub sends a one-time
 * sign-in hash in the URL fragment (never sent to any server); we exchange it
 * for the Academy's own session and clear it from the address bar.
 */
export default function Sso() {
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const t = params.get("t");
    const next = params.get("next");
    history.replaceState(null, "", "/sso");
    if (!t) { setErr("This sign-in link is incomplete. Open the Academy from the Hub again."); return; }
    supabase.auth.verifyOtp({ token_hash: t, type: "email" }).then(({ error }) => {
      if (error) setErr("This sign-in link has expired or was already used. Open the Academy from the Hub again.");
      else nav(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    });
  }, [nav]);

  return (
    <div className="grid min-h-screen place-items-center px-4 text-center">
      {err ? (
        <div className="card max-w-sm p-6">
          <p className="font-semibold">Couldn't sign you in</p>
          <p className="mt-1 text-sm text-muted">{err}</p>
          <a href="/" className="btn mt-4">Go to sign-in</a>
        </div>
      ) : (
        <p className="text-sm text-muted">Signing you in…</p>
      )}
    </div>
  );
}
