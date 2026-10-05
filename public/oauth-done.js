/* The end of the connect popup. See oauth-done.html for why it lives here.
   Reads the outcome from the address, tells the page that opened it, closes.
   textContent only: these values come from the address bar. */
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

  if (window.opener) {
    try {
      window.opener.postMessage(
        { source: "madeea-oauth", ok: ok, provider: provider, account: account || undefined, error: ok ? undefined : detail || undefined },
        window.location.origin
      );
    } catch (e) { /* the opener went away; closing is still right */ }
    setTimeout(function () { try { window.close(); } catch (e) {} }, 1200);
  } else {
    // Opened as a full page (popup blocked): go back to the app instead.
    document.getElementById("closing").textContent = "Taking you back…";
    var back = "/integrations?" + (ok ? "connected=" + encodeURIComponent(provider) : "error=oauth_failed");
    setTimeout(function () { window.location.replace(back); }, 1200);
  }
})();
