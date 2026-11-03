// Generates supabase/migrations/0095_made_ready_curriculum.sql from src/data/academySeed.ts.
// node scripts/academy/gen.cjs   (from the repo root)
const fs = require("fs");
const path = require("path");
const hub = path.resolve(__dirname, "../..");
const ts = require(path.join(hub, "node_modules/typescript"));
const src = fs.readFileSync(path.join(hub, "src/data/academySeed.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, () => ({}));
const { MODULES, LESSONS, SEED_QUESTIONS, RESOURCES } = mod.exports;

// Dollar-quoted text, so apostrophes and line breaks need no escaping.
const lit = (s) => {
  if (s == null) return "null";
  if (s.includes("$t$")) throw new Error("text contains $t$");
  return `$t$${s}$t$`;
};
const mvar = (id) => `m${id.split("-")[1]}`;

let seed = "";
for (const m of MODULES) {
  seed += `    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)\n`;
  seed += `    values (w.id, ${m.day}, ${lit(m.title)},\n      ${lit(m.summary)}, ${m.position}, ${m.pass_pct})\n    returning id into ${mvar(m.id)};\n\n`;
}
for (const l of LESSONS) {
  seed += `    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (${mvar(l.module_id)}, ${lit(l.title)}, '${l.kind}', ${l.minutes}, ${l.position},\n${lit(l.body)});\n`;
}
seed += "\n";
for (const q of SEED_QUESTIONS) {
  seed += `    insert into academy_questions (module_id, prompt, choices, explanation, position) values (${mvar(q.module_id)}, ${lit(q.prompt)},\n      ${lit(JSON.stringify(q.choices))}::jsonb, ${lit(q.explanation)}, ${q.position}) returning id into q;\n`;
  seed += `    insert into academy_answer_key values (q, ${q.answer});\n`;
}
seed += "\n";
RESOURCES.forEach((r, i) => {
  seed += `    insert into academy_resources (workspace_id, title, position) values (w.id, ${lit(r)}, ${i + 1});\n`;
});

const decl = MODULES.map((m) => `${mvar(m.id)} uuid;`).join(" ");
const header = fs.readFileSync(path.join(__dirname, "head.sql"), "utf8");
const out = `${header}
-- ---------- the curriculum ----------
-- GENERATED from src/data/academySeed.ts (node scripts/academy/gen.cjs). Change the
-- curriculum there and regenerate, so demo mode and the database agree.
--
-- Runs once per workspace: a workspace that already has "The MadeEA Standard"
-- is skipped. The old three-day outline is unpublished, not deleted, so past
-- attempts and progress stay on record; unpublished modules are hidden and do
-- not count toward Made Ready.
do $seed$
declare
  w record;
  ${decl}
  q uuid;
begin
  for w in select id from workspaces loop
    if exists (select 1 from academy_modules where workspace_id = w.id and title = 'The MadeEA Standard') then
      continue;
    end if;

    update academy_modules set is_published = false where workspace_id = w.id;

${seed}  end loop;
end $seed$;
`;
const dest = path.join(hub, "supabase/migrations/0095_made_ready_curriculum.sql");
fs.writeFileSync(dest, out);
console.log(`ok: ${MODULES.length} modules, ${LESSONS.length} lessons, ${SEED_QUESTIONS.length} questions, ${RESOURCES.length} resources -> ${dest}`);
