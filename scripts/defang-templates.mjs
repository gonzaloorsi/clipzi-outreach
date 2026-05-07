// One-off migration: apply the same spam-flag-dodging text replacements to the
// email_templates DB rows that override the code defaults. Defensive — no-op
// if the patterns don't match (so any custom edits the user made survive).
//
// Replacements (mirror what we did in lib/templates/*.ts):
//   1. "co-founder"                       → "founder"        (lowercase, body)
//   2. "Co-founder &amp; CEO, Clipzi"     → "Founder, Clipzi"
//   3. "Co-Founder &amp; CEO, Clipzi"     → "Founder, Clipzi" (de variant, capital F)
//   4. "Co-fondateur &amp; CEO, Clipzi"   → "Fondateur, Clipzi" (fr variant)
//   5. "(https://clipzi.app/)"            → "(clipzi.app)"
//
// Usage: npx tsx scripts/defang-templates.mjs

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const REPLACEMENTS = [
  ["co-founder", "founder"],
  ["Co-founder &amp; CEO, Clipzi", "Founder, Clipzi"],
  ["Co-Founder &amp; CEO, Clipzi", "Founder, Clipzi"],
  ["Co-fondateur &amp; CEO, Clipzi", "Fondateur, Clipzi"],
  // Catch already-edited variants where the user dropped "Co-" but left "& CEO".
  ["Founder &amp; CEO, Clipzi", "Founder, Clipzi"],
  ["Fondateur &amp; CEO, Clipzi", "Fondateur, Clipzi"],
  ["(https://clipzi.app/)", "(clipzi.app)"],
];

function applyReplacements(s) {
  let out = s;
  let any = false;
  for (const [from, to] of REPLACEMENTS) {
    if (out.includes(from)) {
      out = out.split(from).join(to); // global replace, no regex escaping needed
      any = true;
    }
  }
  return { out, changed: any };
}

const rows = await sql`SELECT key, subject, html FROM email_templates ORDER BY key`;
console.log(`Inspecting ${rows.length} DB-stored templates…\n`);

let updated = 0;
let unchanged = 0;
for (const row of rows) {
  const subj = applyReplacements(row.subject);
  const body = applyReplacements(row.html);
  if (!subj.changed && !body.changed) {
    console.log(`  · ${row.key.padEnd(20)} no patterns matched (skipping)`);
    unchanged++;
    continue;
  }
  await sql`
    UPDATE email_templates
    SET subject = ${subj.out}, html = ${body.out}, updated_at = NOW()
    WHERE key = ${row.key}
  `;
  console.log(
    `  ✓ ${row.key.padEnd(20)} updated (subject:${subj.changed ? "✓" : "—"} body:${body.changed ? "✓" : "—"})`,
  );
  updated++;
}

console.log(`\nDone. Updated ${updated}, unchanged ${unchanged}.`);
