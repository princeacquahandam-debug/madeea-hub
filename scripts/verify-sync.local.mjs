/**
 * Are screenshots really server-side, and would another device see them?
 *
 * A fresh browser profile with no cookies, no localStorage, no IndexedDB and no
 * cache is the only honest test of "syncs to all devices": anything it can
 * render came from the server, because it had nothing else to render from.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5174";
const browser = await chromium.launch();

// A brand new context: as different from the first device as a different laptop.
const ctx = await browser.newContext();
const p = await ctx.newPage();

const storageBefore = await (async () => {
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  return p.evaluate(() => ({
    localStorage: Object.keys(localStorage).length,
    sessionStorage: Object.keys(sessionStorage).length,
  }));
})();
console.log("fresh profile, before sign-in : localStorage keys =", storageBefore.localStorage);

await p.fill('input[type="email"]', "rio.castillo@madeeas.com");
await p.fill('input[type="password"]', "DemoPass!2026-madeea");
await p.getByRole("button", { name: /sign in/i }).first().click();
await p.waitForTimeout(5000);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await p.waitForTimeout(700); }

await p.goto(`${BASE}/screenshots`, { waitUntil: "networkidle" });
await p.waitForTimeout(4500);

const seen = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll("img")].filter((i) => i.naturalWidth > 0);
  return {
    thumbs: document.querySelectorAll('button[aria-label^="Screenshot at"]').length,
    renderedImages: imgs.length,
    // Where the bytes actually came from.
    hosts: [...new Set(imgs.map((i) => { try { return new URL(i.src).host; } catch { return "inline"; } }))],
    anyDataUri: imgs.some((i) => i.src.startsWith("data:")),
  };
});
console.log("screenshots visible on it     :", seen.thumbs, "thumbnails,", seen.renderedImages, "images rendered");
console.log("image bytes served from       :", seen.hosts.join(", "));
console.log("any embedded/local image data :", seen.anyDataUri);

// Is any screenshot content cached locally rather than fetched?
const local = await p.evaluate(async () => {
  const keys = Object.keys(localStorage);
  const dbs = (await indexedDB.databases?.()) ?? [];
  return {
    localStorageKeys: keys,
    indexedDbNames: dbs.map((d) => d.name),
    localStorageHasImageData: keys.some((k) => (localStorage.getItem(k) ?? "").includes("data:image")),
  };
});
console.log("");
console.log("localStorage keys             :", local.localStorageKeys.join(", ") || "(none)");
console.log("IndexedDB databases           :", local.indexedDbNames.join(", ") || "(none)");
console.log("image data held locally       :", local.localStorageHasImageData);

await browser.close();
