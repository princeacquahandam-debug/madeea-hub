/**
 * The reset flow, end to end, on the real project.
 *
 * The parts that could silently fail are the ones worth asserting: the redirect
 * has to be inside the project's allow list (it was empty), and the built-in
 * mailer allows only a couple of sends an hour, so the second attempt should be
 * refused with a rate limit rather than appearing to work.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5174";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1180, height: 800 } })).newPage();

await p.goto(BASE, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);

console.log("Forgot password link present :", await p.getByRole("button", { name: /forgot password/i }).count() > 0);

// Guard: it must ask for an email rather than sending to nothing.
await p.getByRole("button", { name: /forgot password/i }).click();
await p.waitForTimeout(400);
await p.getByRole("button", { name: /send reset link/i }).click();
await p.waitForTimeout(900);
console.log("empty email is refused       :", await p.getByText(/enter your email address first/i).count() > 0);

// Real send, watching what the network actually returns.
const responses = [];
p.on("response", (r) => { if (r.url().includes("/auth/v1/recover")) responses.push(r.status()); });

await p.fill('input[type="email"]', "rio.castillo@madeeas.com");
await p.getByRole("button", { name: /forgot password/i }).click().catch(() => {});
await p.waitForTimeout(300);
const send = p.getByRole("button", { name: /send reset link/i });
if (await send.count()) await send.click();
await p.waitForTimeout(4000);

console.log("POST /auth/v1/recover status  :", responses.join(", ") || "(no request seen)");
const ok = await p.getByText(/reset link is on its way/i).count() > 0;
const rate = await p.getByText(/too many reset emails/i).count() > 0;
const err = await p.locator(".text-red-400").allTextContents();
console.log("confirmation shown            :", ok);
console.log("rate limit message shown      :", rate);
console.log("any error on screen           :", err.filter(Boolean).join(" | ") || "none");

await p.screenshot({ path: "scripts/out-reset.png" });
await b.close();
