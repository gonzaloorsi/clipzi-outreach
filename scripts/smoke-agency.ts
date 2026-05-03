// Local smoke test for agency discovery — no DB writes, no API endpoint.
// Just exercises the lib code and prints what we'd actually insert.
//
// Usage:
//   npx tsx scripts/smoke-agency.ts                       # default: AR × marketing
//   npx tsx scripts/smoke-agency.ts MX communication
//   npx tsx scripts/smoke-agency.ts ES creator-management

import { config } from "dotenv";
config({ path: ".env.local" });

import { searchAgencies, isPlaceholderEmail } from "../lib/agency-search";
import { fetchAgencyEmails } from "../lib/agency-extract";

const country = (process.argv[2] ?? "AR").toUpperCase();
const category = process.argv[3] ?? "marketing";

console.log(`\n═══ Smoke: ${country} × ${category} ═══\n`);

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("❌ AI_GATEWAY_API_KEY not set in .env.local");
  process.exit(1);
}

console.log("[1/3] Calling Sonar via AI Gateway...");
const t0 = Date.now();
let sonar;
try {
  sonar = await searchAgencies(country, category, { maxResults: 10 });
} catch (e) {
  console.error("❌ Sonar call failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
const t1 = Date.now();
console.log(`  ✓ ${t1 - t0}ms`);
console.log(`  ✓ ${sonar.agencies.length} agencies returned`);
console.log(`  ✓ tokens in/out: ${sonar.inputTokens}/${sonar.outputTokens}`);
console.log(`  ✓ ${sonar.citations.length} citations`);

if (sonar.agencies.length === 0) {
  console.log("\n⚠ Sonar returned 0 agencies — check the prompt or country/category");
  console.log("Raw content snippet:", sonar.rawContent.slice(0, 300));
  process.exit(1);
}

console.log("\n[2/3] Sonar results (raw):");
sonar.agencies.forEach((a, i) => {
  const emailLabel = a.email
    ? isPlaceholderEmail(a.email)
      ? `${a.email} ⚠ placeholder`
      : a.email
    : "—";
  console.log(
    `  ${String(i + 1).padStart(2)}. ${a.name.padEnd(35)} ${a.website.padEnd(28)} ${emailLabel}${a.city ? "  (" + a.city + ")" : ""}`,
  );
});

const withSonarEmail = sonar.agencies.filter(
  (a) => a.email && !isPlaceholderEmail(a.email),
);
const withoutEmail = sonar.agencies.filter(
  (a) => !a.email || isPlaceholderEmail(a.email),
);

console.log(
  `\n  → ${withSonarEmail.length} with email from Sonar, ${withoutEmail.length} need fallback scrape`,
);

console.log("\n[3/3] Fallback scrape for agencies without email...");
const enriched: typeof sonar.agencies = [...withSonarEmail];
for (const a of withoutEmail.slice(0, 5)) {
  const t = Date.now();
  const result = await fetchAgencyEmails(a.website);
  const dur = Date.now() - t;
  if (result.emails.length > 0) {
    console.log(
      `  📧 ${a.name.padEnd(30)} ${a.website.padEnd(28)} → ${result.emails[0]}  (${dur}ms, ${result.pagesVisited.length} pages)`,
    );
    enriched.push({ ...a, email: result.emails[0] });
  } else {
    console.log(
      `  ❌ ${a.name.padEnd(30)} ${a.website.padEnd(28)} → no emails (${dur}ms, status=${result.status})`,
    );
  }
}

console.log(`\n═══ Summary ═══`);
console.log(`  Sonar: ${sonar.agencies.length} agencies`);
console.log(`  With email (any source): ${enriched.length}`);
console.log(`  Cost approx: $${(((sonar.inputTokens ?? 0) / 1_000_000) * 3 + ((sonar.outputTokens ?? 0) / 1_000_000) * 15).toFixed(4)}`);
console.log(
  `\nIf this looks right, the cron would insert ${enriched.length} rows with discoveredVia="sonar:agency:${country}:${category}".`,
);
