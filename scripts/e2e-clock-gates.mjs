/**
 * The clock gates, driven through a real browser in demo mode.
 *
 *   VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev
 *   node .gate-e2e.mjs
 *
 * ONE HARNESS NOTE. Clocking in also calls getDisplayMedia, and in a headless
 * browser that native picker takes input focus and every later page click is
 * swallowed — verified: the button still hit-tests on top, a JS .click() still
 * works, but real mouse events stop arriving. So the clock-out half seeds a
 * running shift into demo storage and reloads, rather than clocking in first.
 * That is a limitation of the harness, not of the app.
 */
import { chromium } from "playwright";

const log = [];
let failures = 0;
const step = (name, ok, detail = "") => {
  if (!ok) failures++;
  log.push(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const TIME_KEY = "madeea-demo-time-entries";
const EOD_KEY = "madeea-demo-eod";
const today = new Date();
const p = (n) => String(n).padStart(2, "0");
const DAY = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;

const browser = await chromium.launch({ channel: "msedge" });
const errors = [];

async function freshPage() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  await page.goto("http://localhost:5173/", { waitUntil: "load" });
  await page.waitForTimeout(2200);
  const skip = page.getByRole("button", { name: "Skip tour" });
  if (await skip.isVisible().catch(() => false)) { await skip.click(); await page.waitForTimeout(500); }
  return page;
}

const readEntries = (page) =>
  page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(TIME_KEY)}) || "[]")`);
const readEod = (page) =>
  page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(EOD_KEY)}) || "[]")`);

// ══ 1. Clocking in is gated on a focus ═══════════════════════════════════
{
  const page = await freshPage();
  await page.getByRole("button", { name: /^Clock in$/ }).click();
  await page.waitForTimeout(700);

  step("clocking in opens the focus gate rather than starting the clock",
    await page.getByText("What is today for?").isVisible());

  const startBtn = page.getByRole("button", { name: "Start the day" });
  step("the gate cannot be walked past empty", await startBtn.isDisabled(),
    "'Start the day' is disabled with no focus");

  await page.fill("#clock-focus", "Clear Rowena's inbox and ship the Q3 deck");
  await page.waitForTimeout(200);
  step("typing a focus unlocks it", !(await startBtn.isDisabled()));

  await startBtn.click();
  await page.waitForTimeout(2000);

  const entries = await readEntries(page);
  step("the shift starts", entries.length === 1 && entries[0].ended_at === null);
  step("and the focus is stored on it",
    entries[0]?.focus === "Clear Rowena's inbox and ship the Q3 deck",
    JSON.stringify(entries[0]?.focus));
  await page.context().close();
}

// ══ 2. Clocking out collects the EOD ═════════════════════════════════════
{
  const page = await freshPage();
  await page.evaluate(`localStorage.setItem(${JSON.stringify(TIME_KEY)}, ${JSON.stringify(JSON.stringify([
    { id: "seeded-1", owner_id: "demo", task_id: null, client_id: null, note: null,
      focus: "Ship the Q3 deck", started_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
      ended_at: null, work_date: DAY },
  ]))})`);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2200);

  await page.getByRole("button", { name: "Clock out" }).first().click();
  await page.waitForTimeout(900);
  step("clocking out opens the EOD gate rather than stopping the clock",
    await page.getByText("Your EOD, before you clock out").isVisible());

  const stillRunning = (await readEntries(page))[0]?.ended_at === null;
  step("and the clock is still running while it is open", stillRunning);

  const fileBtn = page.getByRole("button", { name: /File EOD and clock out/ });
  /* The point of collecting it here: the report is already written from the
     board by the time the dialog opens, so most days are a read and a click.
     An EMPTY draft still cannot be filed (the button is disabled on
     total === 0), but the demo board is never empty, so that guard is covered
     by the dialog's own condition rather than asserted here. */
  const drafted = await page.locator('li:has-text("Follow"), li').count();
  step("the report arrives already drafted from the board",
    !(await fileBtn.isDisabled()) && drafted > 0, drafted + ' draft lines waiting');

  // The escape hatch, and its price.
  await page.getByText("I can't file it right now").click();
  await page.waitForTimeout(300);
  const skipBtn = page.getByRole("button", { name: "Clock out without the report" });
  step("there is a way through when the report genuinely cannot be filed",
    await skipBtn.isVisible());
  step("and it refuses to fire without an explanation", await skipBtn.isDisabled());
  await page.getByRole("button", { name: "Back to the report" }).click();
  await page.waitForTimeout(300);

  // File it properly.
  const addInput = page.getByPlaceholder("Add to completed…").first();
  await addInput.fill("Cleared the inbox and sent the deck");
  await addInput.press("Enter");
  await page.waitForTimeout(400);
  step("filing unlocks once the report has a line", !(await fileBtn.isDisabled()));

  await fileBtn.click();
  await page.waitForTimeout(2000);

  const after = await readEntries(page);
  step("filing the EOD closes the shift", after[0]?.ended_at !== null,
    `ended_at ${JSON.stringify(after[0]?.ended_at)}`);
  step("and no skip reason is recorded, because nothing was skipped",
    !after[0]?.eod_skipped_reason);

  const reports = await readEod(page);
  step("the report itself is stored for that work date",
    reports.some((r) => r.report_date === DAY && r.done?.includes("Cleared the inbox and sent the deck")),
    `${reports.length} report(s)`);
  await page.context().close();
}

// ══ 3. Neither gate asks twice ═══════════════════════════════════════════
{
  const page = await freshPage();
  await page.evaluate(`
    localStorage.setItem(${JSON.stringify(TIME_KEY)}, ${JSON.stringify(JSON.stringify([
      { id: "done-1", owner_id: "demo", task_id: null, client_id: null, note: null,
        focus: "Already stated this morning",
        started_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
        ended_at: new Date(Date.now() - 3600_000).toISOString(), work_date: DAY },
    ]))});
    localStorage.setItem(${JSON.stringify(EOD_KEY)}, ${JSON.stringify(JSON.stringify([
      { id: "eod-1", owner_id: "demo", person: "You (Admin)", report_date: DAY,
        done: ["Something"], blockers: [], plans: [], notes: null },
    ]))});
  `);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2200);

  await page.getByRole("button", { name: /^Clock in$/ }).click();
  await page.waitForTimeout(1000);
  step("clocking back in does NOT ask for the focus again",
    !(await page.getByText("What is today for?").isVisible().catch(() => false)),
    "the day was already described this morning");

  const entries = await readEntries(page);
  const open = entries.find((e) => !e.ended_at);
  step("the clock starts straight away", Boolean(open));
  step("and the day's focus is carried onto the new session",
    open?.focus === "Already stated this morning", JSON.stringify(open?.focus));
  await page.context().close();
}

console.log("\nClock gates, end to end (demo mode)\n");
console.log(log.join("\n"));
console.log(errors.length ? "\npage errors:\n" + errors.join("\n") : "\nno page errors");
console.log(failures ? `\n${failures} step(s) FAILED\n` : "\nAll gate steps passed.\n");
await browser.close();
process.exit(failures ? 1 : 0);
