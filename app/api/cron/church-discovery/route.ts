// Church discovery cron — runs every 3h. Iterates (country × category)
// tuples, asks Sonar via AI Gateway for evangelical churches and Christian
// ministries with ACTIVE YouTube channels (they stream services). Falls back
// to website scraping when Sonar didn't surface an email. Upserts to channels
// with discoveredVia="sonar:church-org:{country}:{category}".
//
// Pilot markets: AR/MX/CO/BR at CHURCH_SEND_RATIO=10 to measure reply rate
// before scaling countries. Church searches rotate through CHURCH_ANGLES
// (denominations/styles) by day-of-year, same pattern as photographer.
//
// Triggered by Vercel Cron (`35 */3 * * *`, 8 ticks/day) or manually via
// Bearer/x-cron-secret. 4 countries × 2 categories = 8 tuples → 1 per tick.
//
// Query params for testing:
//   ?dry=1                → no DB writes
//   ?country=AR           → restrict to one country (skips slice rotation)
//   ?category=church      → restrict to one category
//   ?max=5                → limit total tuples processed (skips rotation)

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/db/client";
import { channels, discoveryRuns } from "@/db/schema";
import {
  searchChurches,
  CHURCH_CATEGORIES,
  CHURCH_ANGLES,
  type ChurchCategory,
} from "@/lib/church-search";
import { fetchAgencyEmails } from "@/lib/agency-extract";
import { isPlaceholderEmail, type AgencyResult } from "@/lib/agency-search";
import { verifyEmailsBatch, isSafeToSend } from "@/lib/bouncer";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

// Pilot: 4 markets with the largest evangelical populations in our funnel.
// Expand (CL, PE, US-hispanic, GT, EC...) once reply rate is validated.
const DEFAULT_COUNTRIES = ["AR", "MX", "CO", "BR"];

// 8 total tuples (4 countries × 2 categories) spread across 8 ticks/day →
// ~1 tuple per tick.
const TICKS_PER_DAY = 8;

// Cap how many sites we scrape per tuple when Sonar didn't return an email.
// Church sites list emails openly, so most entries resolve in pass 1.
const MAX_SCRAPES_PER_TUPLE = 6;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

function churchChannelId(domain: string): string {
  const h = createHash("sha1").update(domain.toLowerCase()).digest("hex").slice(0, 16);
  return `church:${h}`;
}

interface TupleResult {
  country: string;
  category: string;
  angle?: string;
  fromSonar: number;
  domainsTried: number;
  emailsFound: number;
  bouncerSkipped: number;
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
  const onlyCategory = url.searchParams.get("category") as ChurchCategory | null;
  const maxTuples = Number(url.searchParams.get("max")) || undefined;
  const log = (msg: string) =>
    console.log(`[church-discovery ${new Date().toISOString()}]`, msg);

  if (!process.env.AI_GATEWAY_API_KEY && !dryRun) {
    return NextResponse.json(
      { ok: false, error: "AI_GATEWAY_API_KEY not set in env" },
      { status: 500 },
    );
  }

  const countries = onlyCountry ? [onlyCountry] : DEFAULT_COUNTRIES;
  const categories: ChurchCategory[] = onlyCategory ? [onlyCategory] : CHURCH_CATEGORIES;

  type Tuple = { country: string; category: ChurchCategory };
  const allTuples: Tuple[] = [];
  for (const c of countries) {
    for (const cat of categories) {
      allTuples.push({ country: c, category: cat });
    }
  }

  // Slice rotation across TICKS_PER_DAY based on UTC hour bucket. Skipped when
  // any manual filter is present — those are explicit override modes.
  const useRotation = !onlyCountry && !onlyCategory && !maxTuples;
  let sliced: Tuple[] = allTuples;
  let sliceInfo = `all ${allTuples.length} tuples`;
  if (useRotation) {
    const utcHour = new Date().getUTCHours();
    const bucket = Math.floor(utcHour / Math.ceil(24 / TICKS_PER_DAY)); // 0..7
    const sliceSize = Math.ceil(allTuples.length / TICKS_PER_DAY);
    const start = bucket * sliceSize;
    sliced = allTuples.slice(start, start + sliceSize);
    sliceInfo = `slice ${bucket + 1}/${TICKS_PER_DAY} (tuples ${start}..${start + sliced.length - 1} of ${allTuples.length})`;
  }
  if (maxTuples) sliced = sliced.slice(0, maxTuples);

  log(
    `starting — dry=${dryRun} ${sliceInfo} countries=${countries.length}${onlyCategory ? ` category=${onlyCategory}` : ""}`,
  );

  const startedAt = new Date();

  let runId: number | null = null;
  if (!dryRun) {
    const [row] = await db
      .insert(discoveryRuns)
      .values({
        source: "sonar:church",
        params: { countries, tuples: sliced.length },
        startedAt,
      })
      .returning({ id: discoveryRuns.id });
    runId = row.id;
  }

  const allResults: TupleResult[] = [];
  let totalInsertedNew = 0;
  let totalSeen = 0;
  let totalErrors = 0;

  // Day-of-year for deterministic angle rotation. With 6 angles, the same
  // country×category cycles through all styles in 6 days.
  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000,
  );

  try {
    for (let idx = 0; idx < sliced.length; idx++) {
      const t = sliced[idx];
      const angle = CHURCH_ANGLES[(dayOfYear + idx) % CHURCH_ANGLES.length];
      const r = await runOneTuple({ ...t, angle, dryRun, log });
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
          qualifiedNew: totalInsertedNew,
        })
        .where(sql`${discoveryRuns.id} = ${runId}`);
    }

    return NextResponse.json({
      ok: true,
      runId,
      durationMs: Date.now() - startedAt.getTime(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      tuples: sliced.length,
      summary: {
        sonarReturned: totalSeen,
        insertedNew: totalInsertedNew,
        errors: totalErrors,
      },
      perTuple: allResults,
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

async function runOneTuple({
  country,
  category,
  angle,
  dryRun,
  log,
}: {
  country: string;
  category: ChurchCategory;
  angle: string;
  dryRun: boolean;
  log: (s: string) => void;
}): Promise<TupleResult> {
  const result: TupleResult = {
    country,
    category,
    angle,
    fromSonar: 0,
    domainsTried: 0,
    emailsFound: 0,
    bouncerSkipped: 0,
    insertedNew: 0,
    alreadyKnown: 0,
    errors: [],
  };

  log(`tuple: ${country} × ${category} · angle="${angle}"`);

  let sonar;
  try {
    sonar = await searchChurches(country, category, { maxResults: 15, angle });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`sonar: ${msg.slice(0, 150)}`);
    return result;
  }
  result.fromSonar = sonar.results.length;
  result.inputTokens = sonar.inputTokens;
  result.outputTokens = sonar.outputTokens;
  log(
    `  sonar returned ${sonar.results.length} entries (in=${sonar.inputTokens} out=${sonar.outputTokens})`,
  );

  if (sonar.results.length === 0) return result;

  // Dedupe by domain within this batch
  const byDomain = new Map<string, AgencyResult>();
  for (const a of sonar.results) {
    if (!byDomain.has(a.website)) byDomain.set(a.website, a);
  }

  // Pass 1: keep entries that already have a usable email from Sonar.
  // Pass 2: scrape the site for entries without one, capped so a tuple's
  // runtime stays bounded.
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
  for (const a of needScrape.slice(0, MAX_SCRAPES_PER_TUPLE)) {
    const { emails } = await fetchAgencyEmails(a.website);
    if (emails.length > 0) {
      enriched.push({ ...a, email: emails[0], extractedEmails: emails });
      result.emailsFound++;
    }
  }
  if (needScrape.length > MAX_SCRAPES_PER_TUPLE) {
    log(
      `  capped scrapes: ${MAX_SCRAPES_PER_TUPLE} of ${needScrape.length} entries needed scrape (rest skipped)`,
    );
  }

  log(`  emails found: ${result.emailsFound}/${result.domainsTried}`);

  if (enriched.length === 0) return result;

  // Bouncer validation — gate `queued` on deliverability
  const bouncerVerdicts = dryRun
    ? new Map<string, ReturnType<typeof isSafeToSend>>()
    : await (async () => {
        const verdicts = await verifyEmailsBatch(enriched.map((a) => a.email!), 8);
        return new Map(verdicts.map((v) => [v.email, isSafeToSend(v)] as const));
      })();

  const discoveredVia = `sonar:church-org:${country}:${category}`;

  const rows = enriched.map((a) => {
    const safe = dryRun ? true : (bouncerVerdicts.get(a.email!.toLowerCase()) ?? false);
    if (!safe) result.bouncerSkipped++;
    return {
      id: churchChannelId(a.website),
      title: a.name,
      cleanName: a.name,
      country,
      language: null,
      subscribers: null,
      videoCount: null,
      primaryEmail: a.email!,
      allEmails:
        a.extractedEmails && a.extractedEmails.length > 0
          ? a.extractedEmails
          : [a.email!],
      topicCategories: null,
      score: 50,
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
    result.insertedNew = rows.length;
    return result;
  }

  // ON CONFLICT DO UPDATE: only demote existing rows when re-discovery's
  // Bouncer verdict is now low_quality. Never promote. Preserve terminal statuses.
  const affected = await db
    .insert(channels)
    .values(rows)
    .onConflictDoUpdate({
      target: channels.id,
      set: {
        status: sql`EXCLUDED.status`,
        updatedAt: sql`NOW()`,
      },
      setWhere: sql`EXCLUDED.status = 'low_quality' AND channels.status NOT IN ('sent', 'bounced', 'complained', 'opted_out')`,
    })
    .returning({ id: channels.id, isNew: sql<boolean>`xmax = 0` });

  result.insertedNew = affected.filter((r) => r.isNew).length;
  const reDemoted = affected.length - result.insertedNew;
  result.alreadyKnown = rows.length - result.insertedNew;
  log(
    `  inserted: ${result.insertedNew} new, ${result.alreadyKnown} known${reDemoted > 0 ? ` (${reDemoted} re-discovery demoted to low_quality)` : ""}`,
  );

  return result;
}
