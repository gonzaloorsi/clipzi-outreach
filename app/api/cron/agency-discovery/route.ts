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

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

// Configurable defaults — also accepted via query param overrides.
const DEFAULT_COUNTRIES = ["AR", "MX", "CO", "CL", "PE", "ES", "BR", "US"];
const DEFAULT_CATEGORIES = [
  "marketing",
  "communication",
  "creator-management",
  "community-management",
];

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
  let pairs: Array<{ country: string; category: string }> = [];
  for (const c of countries) {
    for (const cat of categories) {
      pairs.push({ country: c, category: cat });
    }
  }
  if (maxPairs) pairs = pairs.slice(0, maxPairs);

  log(
    `starting — dry=${dryRun} pairs=${pairs.length} countries=${countries.length} categories=${categories.length}`,
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

  // 3. For agencies without email from Sonar, fetch site & extract
  const enriched: Array<AgencyResult & { extractedEmails?: string[] }> = [];
  for (const a of byDomain.values()) {
    result.domainsTried++;
    if (a.email && !isPlaceholderEmail(a.email)) {
      enriched.push(a);
      result.emailsFound++;
      continue;
    }
    // fallback to scraping
    const { emails } = await fetchAgencyEmails(a.website);
    if (emails.length > 0) {
      enriched.push({ ...a, email: emails[0], extractedEmails: emails });
      result.emailsFound++;
    } else {
      // skip — can't email without an email
    }
  }

  log(`  emails found: ${result.emailsFound}/${result.domainsTried}`);

  if (enriched.length === 0) return result;

  // 4. Build rows for upsert
  const discoveredVia = `sonar:agency:${country}:${category}`;
  const rows = enriched.map((a) => ({
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
    status: "queued" as const,
    discoveredVia,
    discoveredAt: new Date(),
    lastRefreshedAt: new Date(),
  }));

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
