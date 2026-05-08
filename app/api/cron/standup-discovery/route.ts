// Standup discovery cron — runs every 3h. Iterates (country × kind × category)
// tuples, asks Sonar via AI Gateway for stand-up comedians (individuals) and
// stand-up organizations (schools, clubs, festivals, production companies).
// Falls back to website scraping when Sonar didn't surface an email. Upserts to
// channels with discoveredVia="sonar:standup-individual:{country}:comedian" or
// discoveredVia="sonar:standup-org:{country}:{category}".
//
// Triggered by Vercel Cron (`15 */3 * * *`, 8 ticks/day) or manually via
// Bearer/x-cron-secret. With 21 countries × (1 individual + 4 org) = 105
// tuples, slice rotation processes ~13 tuples/tick keeping each run inside the
// 800s function cap. Each tuple scrapes at most 5 sites without email to keep
// p99 runtime predictable.
//
// Query params for testing:
//   ?dry=1                       → no DB writes
//   ?country=AR                  → restrict to one country (skips slice rotation)
//   ?kind=individual|org         → restrict to one kind (default: both)
//   ?category=school             → restrict to one org category (forces kind=org)
//   ?max=5                       → limit total tuples processed (skips rotation)

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/db/client";
import { channels, discoveryRuns } from "@/db/schema";
import {
  searchStandupIndividuals,
  searchStandupOrgs,
  STANDUP_ORG_CATEGORIES,
  type StandupOrgCategory,
} from "@/lib/standup-search";
import { fetchAgencyEmails } from "@/lib/agency-extract";
import { isPlaceholderEmail, type AgencyResult } from "@/lib/agency-search";
import { verifyEmailsBatch, isSafeToSend } from "@/lib/bouncer";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

// 11 standup-core + 10 emerging. Keep mid-tier markets where the scene exists
// or is growing. Skip everything else — Sonar quality drops on fringe markets.
const DEFAULT_COUNTRIES = [
  // Core
  "US", "GB", "AR", "ES", "MX", "BR", "CO", "CL", "UY", "AU", "CA",
  // Emerging
  "PE", "IE", "NZ", "IN", "FR", "DE", "IT", "NL", "ZA", "PH",
];

// 105 total tuples (21 countries × 5 = 1 individual + 4 org categories).
// Spread across 8 ticks/day → ~13 tuples per tick. Each tuple worst case ~60s
// (Sonar ~5s + 5 scrapes × ~10s) → ~13 min per tick, just under the 800s cap.
const TICKS_PER_DAY = 8;

// Cap how many sites we scrape per tuple when Sonar didn't return an email.
// Without this, US individual searches scraped up to 12 sites sequentially
// (35s timeout each path × 7 paths) blowing past the function cap.
const MAX_SCRAPES_PER_TUPLE = 5;

type Kind = "individual" | "org";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

function standupChannelId(kind: Kind, domain: string): string {
  const h = createHash("sha1").update(domain.toLowerCase()).digest("hex").slice(0, 16);
  return `standup-${kind === "individual" ? "ind" : "org"}:${h}`;
}

interface TupleResult {
  country: string;
  kind: Kind;
  category: string; // "comedian" for individuals, otherwise the StandupOrgCategory
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
  const onlyKind = url.searchParams.get("kind") as Kind | null;
  const onlyCategory = url.searchParams.get("category");
  const maxTuples = Number(url.searchParams.get("max")) || undefined;
  const log = (msg: string) =>
    console.log(`[standup-discovery ${new Date().toISOString()}]`, msg);

  if (!process.env.AI_GATEWAY_API_KEY && !dryRun) {
    return NextResponse.json(
      { ok: false, error: "AI_GATEWAY_API_KEY not set in env" },
      { status: 500 },
    );
  }

  const countries = onlyCountry ? [onlyCountry] : DEFAULT_COUNTRIES;

  // Build the (country × kind × category) tuple list.
  type Tuple = { country: string; kind: Kind; category: string };
  const allTuples: Tuple[] = [];
  for (const c of countries) {
    if (onlyKind === "individual" || (!onlyKind && !onlyCategory)) {
      allTuples.push({ country: c, kind: "individual", category: "comedian" });
    }
    const orgCategories: StandupOrgCategory[] = onlyCategory
      ? [onlyCategory as StandupOrgCategory]
      : STANDUP_ORG_CATEGORIES;
    if (onlyKind === "org" || (!onlyKind && !onlyCategory) || onlyCategory) {
      for (const cat of orgCategories) {
        allTuples.push({ country: c, kind: "org", category: cat });
      }
    }
  }

  // Slice rotation across TICKS_PER_DAY based on UTC hour bucket. Skipped when
  // any manual filter is present — those are explicit override modes.
  const useRotation =
    !onlyCountry && !onlyKind && !onlyCategory && !maxTuples;
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
    `starting — dry=${dryRun} ${sliceInfo} countries=${countries.length}${onlyKind ? ` kind=${onlyKind}` : ""}${onlyCategory ? ` category=${onlyCategory}` : ""}`,
  );

  const startedAt = new Date();

  let runId: number | null = null;
  if (!dryRun) {
    const [row] = await db
      .insert(discoveryRuns)
      .values({
        source: "sonar:standup",
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

  try {
    for (const t of sliced) {
      const r = await runOneTuple({ ...t, dryRun, log });
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
  kind,
  category,
  dryRun,
  log,
}: {
  country: string;
  kind: Kind;
  category: string;
  dryRun: boolean;
  log: (s: string) => void;
}): Promise<TupleResult> {
  const result: TupleResult = {
    country,
    kind,
    category,
    fromSonar: 0,
    domainsTried: 0,
    emailsFound: 0,
    bouncerSkipped: 0,
    insertedNew: 0,
    alreadyKnown: 0,
    errors: [],
  };

  log(`tuple: ${country} × ${kind} × ${category}`);

  let sonar;
  try {
    sonar =
      kind === "individual"
        ? await searchStandupIndividuals(country, { maxResults: 12 })
        : await searchStandupOrgs(country, category as StandupOrgCategory, {
            maxResults: 10,
          });
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
  // Pass 2: scrape the site for entries without one, but cap the number of
  // scrape attempts so a tuple's runtime stays bounded (each scrape can take
  // up to ~35s if all 7 paths timeout).
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

  const discoveredVia =
    kind === "individual"
      ? `sonar:standup-individual:${country}:${category}`
      : `sonar:standup-org:${country}:${category}`;

  const rows = enriched.map((a) => {
    const safe = dryRun ? true : (bouncerVerdicts.get(a.email!.toLowerCase()) ?? false);
    if (!safe) result.bouncerSkipped++;
    return {
      id: standupChannelId(kind, a.website),
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
