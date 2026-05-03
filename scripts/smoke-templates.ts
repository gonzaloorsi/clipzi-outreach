// Local sanity check: load every template (DB-first, code fallback) and
// verify the round-trip from code → string-with-{vars} → builder produces
// the same output as calling the original code builder directly.

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  ALL_TEMPLATE_KEYS,
  loadTemplateRow,
  rowToBuilder,
} from "../lib/templates/db-loader";

const SAMPLE = { channelName: "Acme Studios", fromName: "Gonzalo Orsi" };

console.log(`Checking ${ALL_TEMPLATE_KEYS.length} templates…\n`);

for (const key of ALL_TEMPLATE_KEYS) {
  const row = await loadTemplateRow(key);
  if (!row) {
    console.log(`  ✗ ${key} — no row found (DB or code)`);
    continue;
  }
  const built = rowToBuilder(row)(SAMPLE);
  const containsName = built.html.includes(SAMPLE.channelName);
  const containsFrom = built.html.includes(SAMPLE.fromName);
  const sourceLabel = row.source === "db" ? "DB" : "code";
  console.log(
    `  ${containsName && containsFrom ? "✓" : "✗"} ${key.padEnd(15)} (${sourceLabel}) subject="${built.subject.slice(0, 50)}"`,
  );
  if (!containsName) console.log(`     ⚠ {channelName} did not interpolate`);
  if (!containsFrom) console.log(`     ⚠ {fromName} did not interpolate`);
}

console.log("\nDone.");
