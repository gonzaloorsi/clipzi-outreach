// Smoke-test the discovery endpoint locally.
//
// Usage:
//   1. Add YOUTUBE_API_KEY=... (and optionally _2.._5) to .env.local
//   2. In one terminal:  npm run dev
//   3. In another:       node scripts/smoke-discovery.mjs
//
// What it does:
//   GET /api/cron/discovery?maxQuota=8&regions=US,AR
//   That's 8 calls × 1 unit = ~80-200 channels discovered, ~5-30 enriched.
//   Cheap, real, end-to-end.

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

console.log(`→ GET ${BASE}/api/cron/discovery?maxQuota=8&regions=US,AR`);
console.log("(no auth header in dev — endpoint allows it when CRON_SECRET unset)\n");

const t0 = Date.now();
const res = await fetch(`${BASE}/api/cron/discovery?maxQuota=8&regions=US,AR`);
const ms = Date.now() - t0;
const body = await res.json();

console.log(`HTTP ${res.status} in ${ms}ms\n`);
console.log(JSON.stringify(body, null, 2));

if (!body.ok) {
  console.error("\n❌ smoke test failed");
  process.exit(1);
}

console.log("\n✅ smoke test passed");
console.log(`   freshness: ${(body.freshness * 100).toFixed(1)}%`);
console.log(`   quota used: ${body.quotaUsed}`);
console.log(`   channels discovered: ${body.trending.channelsSeen} (${body.trending.channelsNew} new)`);
console.log(`   enrichment queued: ${body.enrichment?.queued ?? 0}`);
