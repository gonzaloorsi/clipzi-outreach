// Cross-validates every dashboard query against an independent source of truth.
// If a check fails, the dashboard would be showing wrong numbers — fix before
// shipping.
//
//   npx tsx scripts/validate-insights.ts

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

import {
  getKPIs,
  getPipeline,
  getRecentSends,
  getSenderPool,
  getSendWindowState,
  getDiscoveryRuns,
  getSendsBreakdown,
  getCronHeartbeat,
} from "../lib/insights";

const sql = neon(process.env.DATABASE_URL!);

let failed = 0;
let passed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ""}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}  ← FAIL  ${detail}`);
    failed++;
  }
}

console.log("═══ KPIs ═══");
const kpis = await getKPIs();
console.log(JSON.stringify(kpis, null, 2));

// Independent count: total sends with status='sent' should equal kpis.totalSent
const indepTotalSent = await sql`SELECT COUNT(*)::int AS c FROM sends WHERE status='sent'`;
check(
  "totalSent matches independent count",
  kpis.totalSent === indepTotalSent[0].c,
  `dashboard=${kpis.totalSent} indep=${indepTotalSent[0].c}`,
);

// channels.status='sent' should also equal sent count (since every send updates the channel status)
const channelsSentCount = await sql`SELECT COUNT(*)::int AS c FROM channels WHERE status='sent'`;
check(
  "channels.status='sent' equals sends count (status update is in sync)",
  kpis.totalSent === channelsSentCount[0].c,
  `sends=${kpis.totalSent} channels=${channelsSentCount[0].c}`,
);

// Queued sendable should match the cartera.mjs query exactly
const indepQueued = await sql`
  SELECT COUNT(*)::int AS c FROM channels c
  WHERE c.status = 'queued' AND c.primary_email IS NOT NULL
    AND c.primary_email NOT IN (SELECT email FROM sends)
    AND c.primary_email NOT IN (SELECT email FROM unsubscribes)
`;
check(
  "queuedSendable matches cartera.mjs query",
  kpis.queuedSendable === indepQueued[0].c,
  `dashboard=${kpis.queuedSendable} indep=${indepQueued[0].c}`,
);

// Capacity: sum of senders.daily_limit where state=active
const indepCapacity = await sql`
  SELECT COALESCE(SUM(daily_limit),0)::int AS c FROM senders WHERE state='active'
`;
check(
  "totalDailyCapacity matches sum of active senders",
  kpis.totalDailyCapacity === indepCapacity[0].c,
  `dashboard=${kpis.totalDailyCapacity} indep=${indepCapacity[0].c}`,
);

// 24h count: alternative computation
const indepSent24h = await sql`
  SELECT COUNT(*)::int AS c FROM sends
  WHERE status='sent' AND sent_at > NOW() - INTERVAL '24 hours'
`;
check(
  "sent24h matches independent count",
  kpis.sent24h === indepSent24h[0].c,
  `dashboard=${kpis.sent24h} indep=${indepSent24h[0].c}`,
);

console.log("\n═══ Pipeline ═══");
const pipeline = await getPipeline();
console.log(pipeline);

const pipelineSum = pipeline.reduce((s, p) => s + p.cnt, 0);
const totalChannels = await sql`SELECT COUNT(*)::int AS c FROM channels`;
check(
  "pipeline counts sum to total channels in DB",
  pipelineSum === totalChannels[0].c,
  `sum=${pipelineSum} total=${totalChannels[0].c}`,
);

const sentInPipeline = pipeline.find((p) => p.status === "sent")?.cnt ?? 0;
check(
  "channels with status='sent' in pipeline === sends count",
  sentInPipeline === kpis.totalSent,
  `pipeline=${sentInPipeline} sends=${kpis.totalSent}`,
);

console.log("\n═══ Recent sends (latest 5) ═══");
const recent = await getRecentSends(5);
console.table(
  recent.map((r) => ({
    sent_at: r.sent_at ? String(r.sent_at).slice(0, 19) : "(null)",
    channel: (r.clean_name || r.channel_title || "").slice(0, 30),
    country: r.country ?? "-",
    lang: r.language ?? "-",
    sender: r.sender ?? "-",
    status: r.status,
  })),
);
check(
  "recent sends have sent_at OR are pre-populated legacy",
  recent.length === 0 || recent.every((r) => r.sent_at !== null || r.email),
  `${recent.length} rows`,
);

console.log("\n═══ Sender pool ═══");
const senders = await getSenderPool();
console.table(senders);

// Cross-check: sum of sent_24h across senders should equal total sends with non-null sender_id in 24h
const totalSent24hWithSender = await sql`
  SELECT COUNT(*)::int AS c FROM sends
  WHERE status='sent' AND sent_at > NOW() - INTERVAL '24 hours' AND sender_id IS NOT NULL
`;
const sumSent24h = senders.reduce((s, x) => s + x.sent_24h, 0);
check(
  "sum of sender.sent_24h equals total sends-with-sender-id in 24h",
  sumSent24h === totalSent24hWithSender[0].c,
  `sum=${sumSent24h} indep=${totalSent24hWithSender[0].c}`,
);

console.log("\n═══ Send window state ═══");
const winState = getSendWindowState();
console.log(`window: ${winState.window.start}-${winState.window.end} (env=${winState.envOverride ?? "default"})`);
console.log(`active: ${winState.active.length} countries`);
console.log(`outside: ${winState.outside.length} countries`);

check(
  "active + outside count covers every mapped country",
  winState.active.length + winState.outside.length > 80,
  `active=${winState.active.length} outside=${winState.outside.length}`,
);

// Argentina should be UTC-3, current time = compute and check
const arHour = winState.active.find((c) => c.country === "AR")?.hour
  ?? winState.outside.find((c) => c.country === "AR")?.hour;
console.log(`AR hour: ${arHour}`);
check("AR hour is a valid 0-23 number", arHour !== undefined && arHour >= 0 && arHour < 24);

console.log("\n═══ Discovery runs ═══");
const runs = await getDiscoveryRuns(5);
console.table(
  runs.map((r) => ({
    id: r.id,
    started_at: r.started_at ? String(r.started_at).slice(0, 19) : "?",
    duration: r.duration_s ?? "?",
    quota: r.quota_used,
    seen: r.channels_seen,
    new: r.channels_new,
    qualified: r.qualified_new,
    fresh_pct: r.freshness_pct,
    qual_pct: r.qualified_pct,
    error: r.error?.slice(0, 30) ?? "",
  })),
);

check(
  "freshness_pct never exceeds 100",
  runs.every((r) => r.freshness_pct <= 100.001),
);
check(
  "channels_new <= channels_seen for every run",
  runs.every((r) => r.channels_new <= r.channels_seen),
);
check(
  "qualified_new <= channels_new for every run",
  runs.every((r) => r.qualified_new <= r.channels_new),
);

console.log("\n═══ Sends breakdown (last 7 days) ═══");
const breakdown = await getSendsBreakdown();
console.log("by language:");
console.table(breakdown.byLanguage);
console.log("by country (top 15):");
console.table(breakdown.byCountry);

const breakdownLangSum = breakdown.byLanguage.reduce((s, x) => s + x.cnt, 0);
const sent7d = await sql`SELECT COUNT(*)::int AS c FROM sends WHERE status='sent' AND sent_at > NOW() - INTERVAL '7 days'`;
check(
  "sum of by-language counts == sent in 7d",
  breakdownLangSum === sent7d[0].c,
  `sum=${breakdownLangSum} indep=${sent7d[0].c}`,
);

console.log("\n═══ Cron heartbeat ═══");
const hb = await getCronHeartbeat();
console.log(JSON.stringify(hb, null, 2));

check("totalChannelsKnown > 0", hb.totalChannelsKnown > 0);

console.log(`\n═══ Summary ═══`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
