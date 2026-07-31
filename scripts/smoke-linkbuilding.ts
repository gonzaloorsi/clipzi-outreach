// Local smoke test for linkbuilding discovery — no DB writes, no API endpoint.
// Exercises the lib code and prints what would be inserted.
//
// Usage:
//   npx tsx scripts/smoke-linkbuilding.ts                    # default: US × listicle
//   npx tsx scripts/smoke-linkbuilding.ts US listicle
//   npx tsx scripts/smoke-linkbuilding.ts ES blog
//   npx tsx scripts/smoke-linkbuilding.ts GB directory
//   npx tsx scripts/smoke-linkbuilding.ts US listicle "podcast repurposing and video content repurposing workflows"

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  searchLinkbuildingSites,
  LINKBUILDING_CATEGORIES,
  LINKBUILDING_ANGLES,
  type LinkbuildingCategory,
} from "../lib/linkbuilding-search";
import { isPlaceholderEmail } from "../lib/agency-search";
import { fetchAgencyEmails } from "../lib/agency-extract";

const country = (process.argv[2] ?? "US").toUpperCase();
const category = (process.argv[3] ?? "listicle") as LinkbuildingCategory;
const angle = process.argv[4] ?? LINKBUILDING_ANGLES[0];

if (!(LINKBUILDING_CATEGORIES as string[]).includes(category)) {
  console.error(`❌ invalid category "${category}" (valid: ${LINKBUILDING_CATEGORIES.join(", ")})`);
  process.exit(1);
}

console.log(`\n═══ Smoke linkbuilding: ${country} × ${category} · angle="${angle}" ═══\n`);

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("❌ AI_GATEWAY_API_KEY not set in .env.local");
  process.exit(1);
}

console.log("[1/3] Calling Sonar via AI Gateway...");
const t0 = Date.now();
let sonar;
try {
  sonar = await searchLinkbuildingSites(country, category, { maxResults: 15, angle });
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
    `  ${String(i + 1).padStart(2)}. ${a.name.padEnd(35)} ${a.website.padEnd(28)} ${emailLabel}`,
  );
  if (a.articleUrl) console.log(`      ↳ article: ${a.articleUrl}`);
});

const withEmail = sonar.results.filter((a) => a.email);
const withoutEmail = sonar.results.filter((a) => !a.email);
const withArticle = sonar.results.filter((a) => a.articleUrl);

console.log(
  `\n  → ${withEmail.length} with email from Sonar, ${withoutEmail.length} need fallback scrape, ${withArticle.length} with article URL`,
);

console.log("\n[3/3] Fallback scrape for entries without email...");
const enriched: typeof sonar.results = [...withEmail];
for (const a of withoutEmail.slice(0, 6)) {
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
console.log(`  Sonar: ${sonar.results.length} results`);
console.log(`  With email (any source): ${enriched.length}`);
console.log(
  `  Cost approx: $${(((sonar.inputTokens ?? 0) / 1_000_000) * 3 + ((sonar.outputTokens ?? 0) / 1_000_000) * 15).toFixed(4)}`,
);
console.log(
  `\nIf this looks right, the cron would insert ${enriched.length} rows with discoveredVia="sonar:linkbuilding-site:${country}:${category}".`,
);
