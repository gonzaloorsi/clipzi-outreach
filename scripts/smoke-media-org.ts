// Local smoke test for media-org discovery (radios + podcast networks +
// streaming-TV channels). No DB writes, no API endpoint.
//
// Usage:
//   npx tsx scripts/smoke-media-org.ts                       # default: AR × streaming-tv
//   npx tsx scripts/smoke-media-org.ts AR streaming-tv
//   npx tsx scripts/smoke-media-org.ts ES radio-station
//   npx tsx scripts/smoke-media-org.ts US podcast-network
//   npx tsx scripts/smoke-media-org.ts MX internet-radio

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  searchMediaOrgs,
  MEDIA_ORG_CATEGORIES,
  type MediaOrgCategory,
} from "../lib/media-org-search";
import { isPlaceholderEmail } from "../lib/agency-search";
import { fetchAgencyEmails } from "../lib/agency-extract";

const country = (process.argv[2] ?? "AR").toUpperCase();
const category = (process.argv[3] ?? "streaming-tv") as MediaOrgCategory;

if (!(MEDIA_ORG_CATEGORIES as string[]).includes(category)) {
  console.error(
    `❌ Unknown category "${category}". Valid: ${MEDIA_ORG_CATEGORIES.join(", ")}`,
  );
  process.exit(1);
}

console.log(`\n═══ Smoke media-org: ${country} × ${category} ═══\n`);

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("❌ AI_GATEWAY_API_KEY not set in .env.local");
  process.exit(1);
}

console.log("[1/3] Calling Sonar via AI Gateway...");
const t0 = Date.now();
let sonar;
try {
  sonar = await searchMediaOrgs(country, category, {
    maxResults: 10,
    angle: "comedy and entertainment",
  });
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
  console.log("Raw content snippet:", sonar.rawContent.slice(0, 400));
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
    `  ${String(i + 1).padStart(2)}. ${a.name.padEnd(35)} ${a.website.padEnd(30)} ${emailLabel}${a.city ? "  (" + a.city + ")" : ""}`,
  );
});

const withEmail = sonar.results.filter((a) => a.email);
const withoutEmail = sonar.results.filter((a) => !a.email);

console.log(
  `\n  → ${withEmail.length} with email from Sonar, ${withoutEmail.length} need fallback scrape`,
);

console.log("\n[3/3] Fallback scrape for entries without email...");
const enriched: typeof sonar.results = [...withEmail];
for (const a of withoutEmail.slice(0, 5)) {
  const t = Date.now();
  const result = await fetchAgencyEmails(a.website);
  const dur = Date.now() - t;
  if (result.emails.length > 0) {
    console.log(
      `  📧 ${a.name.padEnd(30)} ${a.website.padEnd(30)} → ${result.emails[0]}  (${dur}ms, ${result.pagesVisited.length} pages)`,
    );
    enriched.push({ ...a, email: result.emails[0] });
  } else {
    console.log(
      `  ❌ ${a.name.padEnd(30)} ${a.website.padEnd(30)} → no emails (${dur}ms, status=${result.status})`,
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
  `\nIf this looks right, the cron would insert ${enriched.length} rows with discoveredVia="sonar:media-org:${country}:${category}".`,
);
