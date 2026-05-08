// Agency discovery cron — runs weekly. Iterates configured (country × category)
// pairs, asks Sonar via AI Gateway for agencies with public emails, falls back
// to website scraping for the ones that didn't get an email from Sonar, and
// upserts to the channels table with discoveredVia="sonar:agency:{country}:{category}".
//
// Triggered by Vercel Cron (or manually with x-cron-secret / Bearer header).
// Query params for testing:
//   ?dry=1                  → no DB writes, returns what would happen
//   ?country=AR             → restrict to one country
//   ?category=marketing     → restrict to one category
//   ?max=5                  → limit pairs processed (for cheap manual tests)

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/db/client";
import { channels, discoveryRuns } from "@/db/schema";
import {
  searchAgencies,
  isPlaceholderEmail,
  type AgencyResult,
} from "@/lib/agency-search";
import { fetchAgencyEmails } from "@/lib/agency-extract";
import { verifyEmailsBatch, isSafeToSend } from "@/lib/bouncer";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

// Configurable defaults — also accepted via query param overrides.
// 30 countries × 10 categories = 300 pairs covered per day.
// Each cron tick (4 per day, every 6 hours) processes 1/4 = 75 pairs.
// Rotation is deterministic by UTC hour bucket so each pair runs ~daily.
const DEFAULT_COUNTRIES = [
  // LATAM
  "AR", "MX", "CO", "CL", "PE", "ES", "BR", "UY", "EC", "VE", "PY", "DO",
  // North America + UK
  "US", "CA", "GB",
  // Europe
  "DE", "FR", "IT", "NL", "PT", "IE", "SE", "DK", "NO", "FI",
  // Asia-Pacific
  "IN", "AU", "NZ", "JP", "KR",
];

const DEFAULT_CATEGORIES = [
  "marketing",
  "communication",
  "creator-management",
  "community-management",
  "pr-boutique",
  "performance-marketing",
  "branding-studio",
  "content-production",
  "events-experiential",
  "digital-transformation",
];

// Slice rotation: with 8 ticks/day (every 3h at :30 — 00:30, 03:30, 06:30,
// 09:30, 12:30, 15:30, 18:30, 21:30 UTC), each tick processes 1/8 of the
// universe. With 300 pairs total → ~38 pairs/tick → ~5 min runtime, well
// inside the 800s function cap. We had hit the cap with 75-pair slices.
const TICKS_PER_DAY = 8;

// Cap how many sites we scrape per pair when Sonar didn't return an email.
// Without this, a pair where Sonar returns 15 entries with 10 missing emails
// would do 10 scrapes × ~10s each = 100s, blowing past the function cap when
// summed across 38 pairs in a slice. Same pattern as standup-discovery.
const MAX_SCRAPES_PER_PAIR = 5;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

function agencyChannelId(domain: string): string {
  const h = createHash("sha1").update(domain.toLowerCase()).digest("hex").slice(0, 16);
  return `agency:${h}`;
}

interface PairResult {
  country: string;
  category: string;
  fromSonar: number;
  domainsTried: number;
  emailsFound: number;
  bouncerSkipped: number; // emails Bouncer flagged as unsafe (undeliverable / unknown / risky-bad)
  qualifiedNew: number;
  insertedNew: number;
  alreadyKnown: number;
  errors: string[];
  inputTokens?: number;
  outputTokens?: number;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const onlyCountry = url.searchParams.get("country")?.toUpperCase();
  const onlyCategory = url.searchParams.get("category");
  const maxPairs = Number(url.searchParams.get("max")) || undefined;
  const log = (msg: string) =>
    console.log(`[agency-discovery ${new Date().toISOString()}]`, msg);

  if (!process.env.AI_GATEWAY_API_KEY && !dryRun) {
    return NextResponse.json(
      {
        ok: false,
        error: "AI_GATEWAY_API_KEY not set in env",
      },
      { status: 500 },
    );
  }

  const countries = onlyCountry ? [onlyCountry] : DEFAULT_COUNTRIES;
  const categories = onlyCategory ? [onlyCategory] : DEFAULT_CATEGORIES;
  const allPairs: Array<{ country: string; category: string }> = [];
  for (const c of countries) {
    for (const cat of categories) {
      allPairs.push({ country: c, category: cat });
    }
  }

  // Slice rotation: divide pairs across TICKS_PER_DAY based on UTC hour.
  // Skip rotation when a manual filter (?country=, ?category=, ?max=) is set —
  // those are explicit override modes for testing.
  const useRotation = !onlyCountry && !onlyCategory && !maxPairs;
  let pairs: Array<{ country: string; category: string }> = allPairs;
  let sliceInfo = `all ${allPairs.length} pairs`;
  if (useRotation) {
    const utcHour = new Date().getUTCHours();
    const bucket = Math.floor(utcHour / Math.ceil(24 / TICKS_PER_DAY)); // 0..3
    const sliceSize = Math.ceil(allPairs.length / TICKS_PER_DAY);
    const start = bucket * sliceSize;
    pairs = allPairs.slice(start, start + sliceSize);
    sliceInfo = `slice ${bucket + 1}/${TICKS_PER_DAY} (pairs ${start}..${start + pairs.length - 1} of ${allPairs.length})`;
  }
  if (maxPairs) pairs = pairs.slice(0, maxPairs);

  log(
    `starting — dry=${dryRun} ${sliceInfo} countries=${countries.length} categories=${categories.length}`,
  );

  const startedAt = new Date();

  // Open telemetry row
  let runId: number | null = null;
  if (!dryRun) {
    const [row] = await db
      .insert(discoveryRuns)
      .values({
        source: "sonar:agency",
        params: { countries, categories, pairs: pairs.length },
        startedAt,
      })
      .returning({ id: discoveryRuns.id });
    runId = row.id;
  }

  const allResults: PairResult[] = [];
  let totalInsertedNew = 0;
  let totalSeen = 0;
  let totalErrors = 0;

  try {
    for (const { country, category } of pairs) {
      const r = await runOnePair({ country, category, dryRun, log });
      allResults.push(r);
      totalInsertedNew += r.insertedNew;
      totalSeen += r.fromSonar;
      totalErrors += r.errors.length;
    }

    if (runId !== null) {
      await db
        .update(discoveryRuns)
        .set({
          endedAt: new Date(),
          channelsSeen: totalSeen,
          channelsNew: totalInsertedNew,
          qualifiedNew: totalInsertedNew, // for agencies, "qualified" == "got into table"
          // quotaUsed semantics aren't applicable here; leave 0
        })
        .where(sql`${discoveryRuns.id} = ${runId}`);
    }

    return NextResponse.json({
      ok: true,
      runId,
      durationMs: Date.now() - startedAt.getTime(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      pairs: pairs.length,
      summary: {
        sonarReturned: totalSeen,
        insertedNew: totalInsertedNew,
        errors: totalErrors,
      },
      perPair: allResults,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${msg}`);
    if (runId !== null) {
      await db
        .update(discoveryRuns)
        .set({ endedAt: new Date(), error: msg })
        .where(sql`${discoveryRuns.id} = ${runId}`);
    }
    return NextResponse.json(
      { ok: false, error: msg, partialResults: allResults },
      { status: 500 },
    );
  }
}

async function runOnePair({
  country,
  category,
  dryRun,
  log,
}: {
  country: string;
  category: string;
  dryRun: boolean;
  log: (s: string) => void;
}): Promise<PairResult> {
  const result: PairResult = {
    country,
    category,
    fromSonar: 0,
    domainsTried: 0,
    emailsFound: 0,
    bouncerSkipped: 0,
    qualifiedNew: 0,
    insertedNew: 0,
    alreadyKnown: 0,
    errors: [],
  };

  log(`pair: ${country} × ${category}`);

  // 1. Sonar search
  let sonar;
  try {
    sonar = await searchAgencies(country, category, { maxResults: 20 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`sonar: ${msg.slice(0, 150)}`);
    return result;
  }
  result.fromSonar = sonar.agencies.length;
  result.inputTokens = sonar.inputTokens;
  result.outputTokens = sonar.outputTokens;
  log(
    `  sonar returned ${sonar.agencies.length} agencies (in=${sonar.inputTokens} out=${sonar.outputTokens})`,
  );

  if (sonar.agencies.length === 0) return result;

  // 2. Dedupe by domain within this batch
  const byDomain = new Map<string, AgencyResult>();
  for (const a of sonar.agencies) {
    if (!byDomain.has(a.website)) byDomain.set(a.website, a);
  }

  // 3. Pass 1: keep entries that already have a usable email from Sonar.
  //    Pass 2: scrape entries without one, capped to MAX_SCRAPES_PER_PAIR so
  //    one bad pair (10+ scrapes with timeouts) can't blow the function cap.
  const enriched: Array<AgencyResult & { extractedEmails?: string[] }> = [];
  const needScrape: AgencyResult[] = [];
  for (const a of byDomain.values()) {
    result.domainsTried++;
    if (a.email && !isPlaceholderEmail(a.email)) {
      enriched.push(a);
      result.emailsFound++;
    } else {
      needScrape.push(a);
    }
  }
  for (const a of needScrape.slice(0, MAX_SCRAPES_PER_PAIR)) {
    const { emails } = await fetchAgencyEmails(a.website);
    if (emails.length > 0) {
      enriched.push({ ...a, email: emails[0], extractedEmails: emails });
      result.emailsFound++;
    }
  }
  if (needScrape.length > MAX_SCRAPES_PER_PAIR) {
    log(
      `  capped scrapes: ${MAX_SCRAPES_PER_PAIR} of ${needScrape.length} entries needed scrape (rest skipped)`,
    );
  }

  log(`  emails found: ${result.emailsFound}/${result.domainsTried}`);

  if (enriched.length === 0) return result;

  // 3.5. Bouncer validation — gate `queued` status on deliverability. Demote
  // to `low_quality` when undeliverable / risky-bad / unknown so they never
  // enter the send pipeline. Skip in dryRun (don't burn API quota).
  const bouncerVerdicts = dryRun
    ? new Map<string, ReturnType<typeof isSafeToSend>>()
    : await (async () => {
        const verdicts = await verifyEmailsBatch(
          enriched.map((a) => a.email!),
          8,
        );
        return new Map(verdicts.map((v) => [v.email, isSafeToSend(v)] as const));
      })();

  // 4. Build rows for upsert
  const discoveredVia = `sonar:agency:${country}:${category}`;
  const rows = enriched.map((a) => {
    const safe = dryRun ? true : (bouncerVerdicts.get(a.email!.toLowerCase()) ?? false);
    if (!safe) result.bouncerSkipped++;
    return {
      id: agencyChannelId(a.website),
      title: a.name,
      cleanName: a.name,
      country,
      language: null,
      subscribers: null,
      videoCount: null,
      primaryEmail: a.email!,
      allEmails: a.extractedEmails && a.extractedEmails.length > 0
        ? a.extractedEmails
        : [a.email!],
      topicCategories: null,
      score: 50, // mid-tier default for agencies; tune later when we have signal
      status: (safe ? "queued" : "low_quality") as "queued" | "low_quality",
      discoveredVia,
      discoveredAt: new Date(),
      lastRefreshedAt: new Date(),
    };
  });
  if (result.bouncerSkipped > 0) {
    log(`  bouncer demoted: ${result.bouncerSkipped} of ${enriched.length} (set status=low_quality)`);
  }

  if (dryRun) {
    result.insertedNew = rows.length; // simulated
    return result;
  }

  // 5. Insert with ON CONFLICT DO NOTHING — duplicates get filtered automatically.
  // Returning gives us the truly new IDs.
  const inserted = await db
    .insert(channels)
    .values(rows)
    .onConflictDoNothing({ target: channels.id })
    .returning({ id: channels.id });

  result.insertedNew = inserted.length;
  result.alreadyKnown = rows.length - inserted.length;
  log(`  inserted: ${result.insertedNew} new, ${result.alreadyKnown} known`);

  return result;
}
