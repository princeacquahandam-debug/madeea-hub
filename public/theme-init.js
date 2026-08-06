// Applies the saved theme before first paint, so a light-theme user never sees a
// dark flash while the bundle boots.
//
// This deliberately lives in its own file rather than inline in index.html:
// vercel.json sets `script-src 'self'` with no 'unsafe-inline', so an inline
// script is blocked outright and the anti-flash guard silently stops running.
// Same reason vite.config.ts disables Vite's inline modulePreload polyfill.
//
// The key must stay in sync with src/store/theme.ts, and must keep the `madeea-`
// prefix that lib/localData.ts sweeps on sign-out.
(function () {
  try {
    var t = localStorage.getItem("madeea-theme");
    if (t !== "light" && t !== "dark") t = "dark";
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  } catch (e) {
    // Blocked/unavailable localStorage must never stop the app booting.
  }
})();
