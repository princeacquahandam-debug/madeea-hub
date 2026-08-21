/**
 * Measure real contrast ratios in the running app.
 *
 * The page has no opaque ancestor: `body` paints a gradient and every card is
 * translucent, so a colour picked out of CSS means nothing on its own. This
 * composites each element's background over its ancestors before computing, and
 * reports what a person actually sees.
 *
 *   node scripts/verify-contrast.mjs [route]
 */
import { chromium } from "playwright";


/* Credentials come from the environment. They were hardcoded here, which put a
   real password into a repository other people can read, and into its history.
   See .env.example. */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set E2E_EMAIL and E2E_PASSWORD before running this. See .env.example.");
  process.exit(1);
}

const ROUTE = process.argv[2] ?? "/communication";
const BASE = "http://localhost:5174";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(BASE, { waitUntil: "networkidle" });
if (await page.locator('input[type="password"]').count()) {
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForTimeout(4500);
}
const skip = page.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(700); }
await page.goto(BASE + ROUTE, { waitUntil: "networkidle" });

const probe = async (theme) => {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
    const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);

    /* Composite up the tree, starting from the THEME's base colour.
       Starting from white was wrong and silently so: `body` paints a gradient,
       and getComputedStyle().backgroundColor reports a gradient as
       rgba(0,0,0,0), so the walk never found an opaque ancestor and every dark
       measurement was taken against white. It reported the dark timestamp at
       3.78:1 on a white page that does not exist. --c-bg is the real floor. */
    const base = parse(getComputedStyle(document.documentElement).getPropertyValue("--c-bg")).slice(0, 3);
    const backdrop = (el) => {
      let bg = base.length === 3 ? [...base] : [255, 255, 255];
      const chain = [];
      for (let n = el; n; n = n.parentElement) chain.push(n);
      for (const n of chain.reverse()) {
        const c = getComputedStyle(n).backgroundColor;
        if (!c || c === "rgba(0, 0, 0, 0)" || c === "transparent") continue;
        const m = parse(c);
        const a = m.length > 3 ? m[3] : 1;
        bg = [0, 1, 2].map((i) => m[i] * a + bg[i] * (1 - a));
      }
      return bg;
    };

    /* Only elements that actually render text. An earlier version matched empty
       spans and reported 1.03:1, which is not a contrast failure, it is a
       measurement of nothing. */
    const pick = (sel, label) => {
      const el = [...document.querySelectorAll(sel)].find((n) => n.textContent.trim().length > 1);
      if (!el) return null;
      const fg = parse(getComputedStyle(el).color).slice(0, 3);
      const bg = backdrop(el);
      return {
        label,
        ratio: +ratio(fg, bg).toFixed(2),
        fg: fg.map(Math.round).join(","),
        bg: bg.map(Math.round).join(","),
      };
    };

    const rows = [
      pick("span.tabular-nums.text-faint", "row timestamp"),
      pick("button span.block.truncate", "row summary"),
      pick("button[class*=btn-primary]", "primary button"),
      pick("span[aria-hidden][style*=background]", "avatar initials"),
      pick("span.text-faint", "faint text"),
    ].filter(Boolean);

    // Every avatar, since the old bug was that contrast floated with hue.
    const avatars = [...document.querySelectorAll("span[aria-hidden][style*=background]")]
      .map((el) => ratio(parse(getComputedStyle(el).color).slice(0, 3), backdrop(el)));
    return {
      rows,
      avatarMin: avatars.length ? +Math.min(...avatars).toFixed(2) : null,
      avatarMax: avatars.length ? +Math.max(...avatars).toFixed(2) : null,
      avatarCount: avatars.length,
    };
  });
};

for (const theme of ["dark", "light"]) {
  const r = await probe(theme);
  console.log(`\n=== ${theme.toUpperCase()} ===`);
  for (const { label, ratio } of r.rows) {
    console.log(`  ${label.padEnd(18)} ${String(ratio).padStart(6)}:1  ${ratio >= 4.5 ? "PASS" : "FAIL"}   fg ${r.rows.find((x) => x.label === label).fg}  on  ${r.rows.find((x) => x.label === label).bg}`);
  }
  console.log(`  ${String(r.avatarCount).padStart(3)} avatars      ${r.avatarMin}:1 .. ${r.avatarMax}:1  ${r.avatarMin >= 4.5 ? "PASS" : "FAIL"}  (was 1.58 .. 5.56)`);
  await page.screenshot({ path: `verify-inbox-${theme}.png` });
}

await browser.close();
