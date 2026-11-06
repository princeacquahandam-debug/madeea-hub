/**
 * The switch rule (Abder's "AI quick actions and cost" deck, 6 Nov 2026, slide 12).
 *
 *   "Run 50–100 real requests per action through both models. Switch only if the
 *    small model hits: right tool ≥95% · facts correct ≥98% · format 100% ·
 *    median answer <3 s. Otherwise keep the larger model for that action."
 *
 * Replays real requests from ai_generations (what people actually asked the
 * generate function) through the OLD model (gpt-4o, temp 0.6) and the NEW one
 * for that action (supabase/functions/generate/prompts.ts → specFor), with the
 * exact same system prompt, and scores the new answers:
 *
 *   format   JSON actions: one JSON object with the action's required keys.
 *            Writing actions: a non-empty answer.
 *   facts    gpt-4o as a strict checker: does the answer state any name, date,
 *            number or fact that is not in the request? (≥98% must be clean)
 *   speed    median seconds for the new model (<3 s)
 *   (right tool applies to Madeline chat, which picks tools; the generate
 *    actions have no tool choice, so it is reported as n/a.)
 *
 * HOW TO RUN
 *   1. Supabase → SQL Editor → run, then copy the single cell it returns into
 *      scripts/ai-eval/requests.json:
 *        select json_agg(t) from (
 *          select tool, format, inputs from (
 *            select *, row_number() over (partition by tool order by created_at desc) n
 *            from ai_generations
 *          ) x where n <= 100
 *        ) t;
 *   2. In PowerShell:  $env:OPENAI_API_KEY = "<the key>"   (never commit it)
 *   3. node scripts/ai-eval/switch-check.mjs scripts/ai-eval/requests.json [--per 50]
 *
 * Cost: roughly 3 model calls per request (old, new, check). 50 requests for
 * each of 10 actions is about 1,500 calls, around $3–5 at October 2026 prices.
 * Writes scripts/ai-eval/report-<date>.json and prints a table with a verdict
 * per action. requests.json and the reports hold real client text: they are
 * git-ignored, delete them when done.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fnDir = path.join(here, "..", "..", "supabase", "functions", "generate");
const { specFor, systemFor, userFor } = await import(pathToFileURL(path.join(fnDir, "prompts.ts")).href);
const { FALLBACK, requestBody, isJsonObject } = await import(pathToFileURL(path.join(fnDir, "models.ts")).href);

const KEY = process.env.OPENAI_API_KEY;
const file = process.argv[2];
/* process.exitCode, not process.exit(): exiting straight after the TS imports
   trips a libuv assertion on Windows. */
const problem = !KEY ? "Set OPENAI_API_KEY first." : !file ? "Usage: node scripts/ai-eval/switch-check.mjs requests.json [--per 50]" : "";
const perIdx = process.argv.indexOf("--per");
const PER = perIdx > 0 ? Number(process.argv[perIdx + 1]) : 50;

/* The keys each JSON action must return. */
const REQUIRED = {
  task_prioritize: ["summary", "rows"], task_stuck: ["summary", "rows"], task_breakdown: [],
  home_plan_day: ["summary", "rows"], home_catch_up: ["summary", "groups"], home_follow_ups: ["summary", "items"],
  inbox_summary: ["summary", "rows"], inbox_replies: ["items"], inbox_actions: ["summary", "tasks"],
  time_week: ["summary", "rows"], time_shift_note: ["note"],
  eod_draft: ["completed", "blockers", "plan"], eod_polish: ["items"],
  team_summary: ["summary", "themes", "highlights"], team_attention: ["rows"],
  client_weekly: ["highlights", "completed", "in_progress", "needs_from_you", "next_week"],
};

async function call(spec, messages) {
  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(requestBody(spec, messages)),
  });
  const secs = (Date.now() - t0) / 1000;
  if (!res.ok) return { text: "", secs, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content ?? "", secs };
}

function formatOk(tool, spec, text) {
  if (!spec.json) return text.trim().length > 0;
  if (!isJsonObject(text)) return false;
  const v = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  if (tool === "task_breakdown") return Array.isArray(v.steps) || typeof v.question === "string";
  return (REQUIRED[tool] ?? []).every((k) => k in v);
}

async function factsOk(request, answer) {
  const r = await call({ model: "gpt-4o", temperature: 0, maxTokens: 3 }, [
    { role: "system", content: "You check an AI answer against the request it was given. Reply FACTS_OK if every name, date, time, number and fact in the answer appears in or follows directly from the request. Reply FACTS_WRONG if the answer states any name, date, number or fact that is not supported by the request. Placeholders like [TBC] are fine. Reply with one word." },
    { role: "user", content: `REQUEST:\n${request}\n\nANSWER:\n${answer}` },
  ]);
  return !String(r.text).toUpperCase().includes("WRONG");
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

async function main() {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const byTool = new Map();
  for (const r of rows) {
    if (!r?.tool) continue;
    const list = byTool.get(r.tool) ?? [];
    if (list.length < PER) list.push(r);
    byTool.set(r.tool, list);
  }

  const report = [];
  for (const [tool, list] of byTool) {
    const sample = list[0];
    const spec = specFor(tool, sample.format ?? "");
    if (spec.model === FALLBACK.model) continue;
    let fmt = 0, facts = 0, n = 0, errors = 0;
    const newSecs = [], oldSecs = [];
    process.stdout.write(`${tool} (${list.length}) on ${spec.model} `);
    for (const r of list) {
      const inputs = typeof r.inputs === "string" ? JSON.parse(r.inputs) : r.inputs ?? {};
      const messages = [{ role: "system", content: systemFor(tool, r.format ?? "") }, { role: "user", content: userFor(r.format ?? "", inputs) }];
      const [neu, old] = await Promise.all([call(spec, messages), call({ ...FALLBACK, json: spec.json }, messages)]);
      n++;
      if (neu.error) { errors++; process.stdout.write("x"); continue; }
      newSecs.push(neu.secs); oldSecs.push(old.secs);
      if (formatOk(tool, spec, neu.text)) fmt++;
      if (await factsOk(messages[1].content, neu.text)) facts++;
      process.stdout.write(".");
    }
    const row = {
      tool, model: spec.model, requests: n, errors,
      format_pct: pct(fmt, n), facts_pct: pct(facts, n),
      median_new_s: Math.round(median(newSecs) * 10) / 10, median_old_s: Math.round(median(oldSecs) * 10) / 10,
      right_tool: "n/a",
    };
    row.verdict = n >= 50 && row.format_pct === 100 && row.facts_pct >= 98 && row.median_new_s < 3 && !errors
      ? "SWITCH" : n < 50 ? "MORE DATA (need 50+)" : "KEEP gpt-4o";
    report.push(row);
    console.log(` ${row.verdict}`);
  }

  console.log("\n" + ["action", "model", "n", "format %", "facts %", "median s (new/old)", "verdict"].join(" | "));
  for (const r of report) console.log([r.tool, r.model, r.requests, r.format_pct, r.facts_pct, `${r.median_new_s}/${r.median_old_s}`, r.verdict].join(" | "));
  const out = path.join(here, `report-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`\nSaved ${out}. To keep gpt-4o for an action, add it to KEEP_LARGER in supabase/functions/generate/prompts.ts.`);
}

if (problem) { console.error(problem); process.exitCode = 1; } else await main();
