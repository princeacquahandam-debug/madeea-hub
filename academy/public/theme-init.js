// Applies the saved theme before first paint (external file: the CSP allows no inline scripts).
(function () {
  try {
    var t = localStorage.getItem("madeea-academy-theme");
    if (t !== "light" && t !== "dark") t = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
