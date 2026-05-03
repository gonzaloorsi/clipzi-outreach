// Comprehensive local smoke for agency discovery — runs all 32 pairs that
// the weekly cron would run, but only does Sonar (no website scraping) for
// speed. Prints a summary table at the end.
//
// What we validate:
//   - Sonar returns >0 agencies per pair
//   - Country resolves to the actual country (not US state ambiguity)
//   - JSON parsing succeeds for all pairs
//   - Total token cost is in the expected range
//
// Cost: 32 calls × ~$0.005 = ~$0.16
// Runtime: ~3-5 minutes

import { config } from "dotenv";
config({ path: ".env.local" });

import { searchAgencies, isPlaceholderEmail } from "../lib/agency-search";

const COUNTRIES = ["AR", "MX", "CO", "CL", "PE", "ES", "BR", "US"] as const;
const CATEGORIES = [
  "marketing",
  "communication",
  "creator-management",
  "community-management",
] as const;

type RowResult = {
  country: string;
  category: string;
  ok: boolean;
  count: number;
  withEmailFromSonar: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  durationMs: number;
  sampleAgency?: string;
  sampleCity?: string | null;
  error?: string;
};

const rows: RowResult[] = [];
const startedAt = Date.now();

console.log(
  `\n═══ Running ${COUNTRIES.length * CATEGORIES.length} pairs (${COUNTRIES.length} countries × ${CATEGORIES.length} categories) ═══\n`,
);

let n = 0;
for (const country of COUNTRIES) {
  for (const category of CATEGORIES) {
    n++;
    process.stdout.write(`  [${n}/32] ${country} × ${category}…`);
    const t = Date.now();
    try {
      const sonar = await searchAgencies(country, category, { maxResults: 10 });
      const dur = Date.now() - t;
      const withEmail = sonar.agencies.filter(
        (a) => a.email && !isPlaceholderEmail(a.email),
      ).length;
      const cost =
        ((sonar.inputTokens ?? 0) / 1_000_000) * 3 +
        ((sonar.outputTokens ?? 0) / 1_000_000) * 15;
      rows.push({
        country,
        category,
        ok: true,
        count: sonar.agencies.length,
        withEmailFromSonar: withEmail,
        inputTokens: sonar.inputTokens,
        outputTokens: sonar.outputTokens,
        costUsd: cost,
        durationMs: dur,
        sampleAgency: sonar.agencies[0]?.name,
        sampleCity: sonar.agencies[0]?.city,
      });
      process.stdout.write(
        ` ✓ ${sonar.agencies.length} agencies, ${withEmail} with email (${dur}ms, $${cost.toFixed(4)})\n`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({
        country,
        category,
        ok: false,
        count: 0,
        withEmailFromSonar: 0,
        costUsd: 0,
        durationMs: Date.now() - t,
        error: msg.slice(0, 100),
      });
      process.stdout.write(` ✗ ${msg.slice(0, 60)}\n`);
    }
  }
}

const totalDuration = Date.now() - startedAt;
const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
const totalAgencies = rows.reduce((s, r) => s + r.count, 0);
const totalWithEmail = rows.reduce((s, r) => s + r.withEmailFromSonar, 0);
const failures = rows.filter((r) => !r.ok).length;

console.log(`\n═══ Summary ═══`);
console.log(`  Total time: ${(totalDuration / 1000).toFixed(1)}s`);
console.log(`  Total cost: $${totalCost.toFixed(4)}`);
console.log(`  Total agencies returned: ${totalAgencies}`);
console.log(`  With email (from Sonar only): ${totalWithEmail}`);
console.log(`  Failures: ${failures}/32`);
console.log(`  Avg per pair: ${(totalAgencies / 32).toFixed(1)} agencies\n`);

console.log(`Per pair detail:`);
console.log(
  `  ${"Country".padEnd(8)} ${"Category".padEnd(20)} ${"Count".padEnd(7)} ${"Email".padEnd(7)} ${"Cost".padEnd(8)} Sample`,
);
for (const r of rows) {
  const sample = r.ok
    ? `${r.sampleAgency ?? "?"}${r.sampleCity ? ` (${r.sampleCity})` : ""}`
    : `ERROR: ${r.error}`;
  console.log(
    `  ${r.country.padEnd(8)} ${r.category.padEnd(20)} ${String(r.count).padEnd(7)} ${String(r.withEmailFromSonar).padEnd(7)} $${r.costUsd.toFixed(4)}  ${sample.slice(0, 60)}`,
  );
}

console.log(`\nIf yield looks reasonable, the prod cron should produce`);
console.log(
  `~${Math.round((totalAgencies / 32) * 32 * 0.6)} new agencies/week after dedup + email validation.`,
);
