// Local smoke test for church discovery — no DB writes, no API endpoint.
// Exercises the lib code and prints what would be inserted.
//
// Usage:
//   npx tsx scripts/smoke-church.ts                # default: AR × church
//   npx tsx scripts/smoke-church.ts AR church
//   npx tsx scripts/smoke-church.ts BR ministry
//   npx tsx scripts/smoke-church.ts MX church "megachurches and multi-campus churches"

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  searchChurches,
  CHURCH_CATEGORIES,
  CHURCH_ANGLES,
  type ChurchCategory,
} from "../lib/church-search";
import { isPlaceholderEmail } from "../lib/agency-search";
import { fetchAgencyEmails } from "../lib/agency-extract";

const country = (process.argv[2] ?? "AR").toUpperCase();
const category = (process.argv[3] ?? "church") as ChurchCategory;
const angle = process.argv[4] ?? CHURCH_ANGLES[0];

if (!(CHURCH_CATEGORIES as string[]).includes(category)) {
  console.error(`❌ invalid category "${category}" (valid: ${CHURCH_CATEGORIES.join(", ")})`);
  process.exit(1);
}

console.log(`\n═══ Smoke church: ${country} × ${category} · angle="${angle}" ═══\n`);

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("❌ AI_GATEWAY_API_KEY not set in .env.local");
  process.exit(1);
}

console.log("[1/3] Calling Sonar via AI Gateway...");
const t0 = Date.now();
let sonar;
try {
  sonar = await searchChurches(country, category, { maxResults: 15, angle });
} catch (e) {
  console.error("❌ Sonar call failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
const t1 = Date.now();
console.log(`  ✓ ${t1 - t0}ms`);
console.log(`  ✓ ${sonar.results.length} results returned`);
console.log(`  ✓ tokens in/out: ${sonar.inputTokens}/${sonar.outputTokens}`);
console.log(`  ✓ ${sonar.citations.length} citations`);

if (sonar.results.length === 0) {
  console.log("\n⚠ Sonar returned 0 results — check the prompt or country/category");
  console.log("Raw content snippet:", sonar.rawContent.slice(0, 300));
  process.exit(1);
}

console.log("\n[2/3] Sonar results (raw):");
sonar.results.forEach((a, i) => {
  const emailLabel = a.email
    ? isPlaceholderEmail(a.email)
      ? `${a.email} ⚠ placeholder`
      : a.email
    : "—";
  console.log(
    `  ${String(i + 1).padStart(2)}. ${a.name.padEnd(40)} ${a.website.padEnd(30)} ${emailLabel}${a.city ? "  (" + a.city + ")" : ""}`,
  );
});

const withEmail = sonar.results.filter((a) => a.email);
const withoutEmail = sonar.results.filter((a) => !a.email);

console.log(
  `\n  → ${withEmail.length} with email from Sonar, ${withoutEmail.length} need fallback scrape`,
);

console.log("\n[3/3] Fallback scrape for entries without email...");
const enriched: typeof sonar.results = [...withEmail];
for (const a of withoutEmail.slice(0, 6)) {
  const t = Date.now();
  const result = await fetchAgencyEmails(a.website);
  const dur = Date.now() - t;
  if (result.emails.length > 0) {
    console.log(
      `  📧 ${a.name.padEnd(35)} ${a.website.padEnd(30)} → ${result.emails[0]}  (${dur}ms, ${result.pagesVisited.length} pages)`,
    );
    enriched.push({ ...a, email: result.emails[0] });
  } else {
    console.log(
      `  ❌ ${a.name.padEnd(35)} ${a.website.padEnd(30)} → no emails (${dur}ms, status=${result.status})`,
    );
  }
}

console.log(`\n═══ Summary ═══`);
console.log(`  Sonar: ${sonar.results.length} results`);
console.log(`  With email (any source): ${enriched.length}`);
console.log(
  `  Cost approx: $${(((sonar.inputTokens ?? 0) / 1_000_000) * 3 + ((sonar.outputTokens ?? 0) / 1_000_000) * 15).toFixed(4)}`,
);
console.log(
  `\nIf this looks right, the cron would insert ${enriched.length} rows with discoveredVia="sonar:church-org:${country}:${category}".`,
);
