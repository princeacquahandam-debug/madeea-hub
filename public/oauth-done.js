/* The end of the connect popup. See oauth-done.html for why it lives here.
   Reads the outcome from the address, tells the page that opened it, closes.
   textContent only: these values come from the address bar.

   TWO WAYS BACK TO THE APP (19 Nov 2026). window.opener is the obvious one,
   but Google's sign-in pages send a strict Cross-Origin-Opener-Policy, and
   once the popup has visited them the browser cuts the link to the opener for
   good. The connection was saved, the popup then had no opener, and the app
   told the person "The login window was closed before it finished" next to a
   row that said Connected. So the result also goes out on a BroadcastChannel,
   which every tab of the same origin hears, opener or not. The app answers on
   the same channel; an answer means a page is waiting, so this window closes.
   No answer means this really was a full-page sign-in (popup blocked), so it
   goes back to Integrations as before. */
(function () {
  var q = new URLSearchParams(window.location.search);
  var ok = q.get("ok") === "1";
  var provider = q.get("provider") || "";
  var account = q.get("account") || "";
  var detail = q.get("detail") || "";

  document.getElementById("title").textContent = ok ? "Account connected" : "Not connected";
  document.getElementById("message").textContent = ok
    ? (account ? "Connected as " + account + "." : "Connected.")
    : (detail || "That did not complete. Nothing was saved, so it is safe to try again.");
  if (!ok) {
    var tick = document.getElementById("tick");
    tick.textContent = "!";
    tick.className = "tick bad";
  }

  var msg = { source: "madeea-oauth", ok: ok, provider: provider, account: account || undefined, error: ok ? undefined : detail || undefined };
  var closeSoon = function () { setTimeout(function () { try { window.close(); } catch (e) {} }, 1200); };
  var goBack = function () {
    document.getElementById("closing").textContent = "Taking you back…";
    var back = "/integrations?" + (ok ? "connected=" + encodeURIComponent(provider) : "error=oauth_failed");
    setTimeout(function () { window.location.replace(back); }, 1200);
  };

  if (window.opener) {
    try { window.opener.postMessage(msg, window.location.origin); } catch (e) { /* the opener went away; closing is still right */ }
    closeSoon();
    return;
  }

  var channel = null;
  try { channel = new BroadcastChannel("madeea-oauth"); } catch (e) { channel = null; }
  if (!channel) { goBack(); return; }

  var heard = false;
  channel.onmessage = function (e) {
    if (e.data && e.data.source === "madeea-oauth-ack") { heard = true; closeSoon(); }
  };
  try { channel.postMessage(msg); } catch (e) { /* fall through to the timeout */ }
  setTimeout(function () { if (!heard) goBack(); }, 800);
})();
