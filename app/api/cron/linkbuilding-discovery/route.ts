// Linkbuilding discovery cron — runs every 3h. Iterates (country × category)
// tuples, asks Sonar via AI Gateway for marketing/SEO blogs, listicle authors
// and SaaS directories relevant to AI video/clipping tools. Falls back to
// website scraping when Sonar didn't surface an email. Upserts to channels with
// discoveredVia="sonar:linkbuilding-site:{country}:{category}".
//
// The relevant article/listing URL (when Sonar surfaces one) is stored in
// topicCategories — null for every other non-YouTube vertical — so a future
// iteration can personalize the email per article without a schema change.
//
// Listicle/blog searches rotate through LINKBUILDING_ANGLES by day-of-year,
// same pattern as media-org/photographer discovery.
//
// Triggered by Vercel Cron (`25 */3 * * *`, 8 ticks/day) or manually via
// Bearer/x-cron-secret. With 14 countries × 3 categories = 42 tuples, slice
// rotation processes ~6 tuples/tick keeping each run inside the 800s cap.
//
// Query params for testing:
//   ?dry=1                       → no DB writes
//   ?country=US                  → restrict to one country (skips slice rotation)
//   ?category=listicle           → restrict to one category
//   ?max=5                       → limit total tuples processed (skips rotation)

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/db/client";
import { channels, discoveryRuns } from "@/db/schema";
import {
  searchLinkbuildingSites,
  LINKBUILDING_CATEGORIES,
  LINKBUILDING_ANGLES,
  type LinkbuildingCategory,
  type LinkbuildingResult,
} from "@/lib/linkbuilding-search";
import { fetchAgencyEmails } from "@/lib/agency-extract";
import { isPlaceholderEmail } from "@/lib/agency-search";
import { verifyEmailsBatch, isSafeToSend } from "@/lib/bouncer";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

// Markets limited to the languages our templates support (en/es/pt/de/fr).
// Marketing blogs concentrate in big markets; fringe markets add noise.
const DEFAULT_COUNTRIES = [
  // English
  "US", "GB", "CA", "AU",
  // Spanish
  "ES", "MX", "AR", "CO", "CL",
  // Portuguese
  "BR", "PT",
  // German
  "DE", "AT",
  // French
  "FR",
];

// 42 total tuples (14 countries × 3 categories) spread across 8 ticks/day →
// ~6 tuples per tick, well inside the 800s cap.
const TICKS_PER_DAY = 8;

// Cap how many sites we scrape per tuple when Sonar didn't return an email.
// Blogs hide emails more than photographers do, so allow a bit more than the
// other verticals while staying inside the function cap (~35s worst case per
// scrape).
const MAX_SCRAPES_PER_TUPLE = 6;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

function linkbuildingChannelId(domain: string): string {
  const h = createHash("sha1").update(domain.toLowerCase()).digest("hex").slice(0, 16);
  return `lb:${h}`;
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
  const onlyCategory = url.searchParams.get("category") as LinkbuildingCategory | null;
  const maxTuples = Number(url.searchParams.get("max")) || undefined;
  const log = (msg: string) =>
    console.log(`[linkbuilding-discovery ${new Date().toISOString()}]`, msg);

  if (!process.env.AI_GATEWAY_API_KEY && !dryRun) {
    return NextResponse.json(
      { ok: false, error: "AI_GATEWAY_API_KEY not set in env" },
      { status: 500 },
    );
  }

  const countries = onlyCountry ? [onlyCountry] : DEFAULT_COUNTRIES;
  const categories: LinkbuildingCategory[] = onlyCategory
    ? [onlyCategory]
    : LINKBUILDING_CATEGORIES;

  type Tuple = { country: string; category: LinkbuildingCategory };
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
        source: "sonar:linkbuilding",
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
  // country×category cycles through all topics in 6 days.
  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000,
  );

  try {
    for (let idx = 0; idx < sliced.length; idx++) {
      const t = sliced[idx];
      const angle = LINKBUILDING_ANGLES[(dayOfYear + idx) % LINKBUILDING_ANGLES.length];
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
  category: LinkbuildingCategory;
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
    sonar = await searchLinkbuildingSites(country, category, {
      maxResults: 15,
      angle,
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
  const byDomain = new Map<string, LinkbuildingResult>();
  for (const a of sonar.results) {
    if (!byDomain.has(a.website)) byDomain.set(a.website, a);
  }

  // Pass 1: keep entries that already have a usable email from Sonar.
  // Pass 2: scrape the site for entries without one, capped so a tuple's
  // runtime stays bounded (each scrape can take up to ~35s if all paths
  // time out).
  const enriched: Array<LinkbuildingResult & { extractedEmails?: string[] }> = [];
  const needScrape: LinkbuildingResult[] = [];
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

  const discoveredVia = `sonar:linkbuilding-site:${country}:${category}`;

  const rows = enriched.map((a) => {
    const safe = dryRun ? true : (bouncerVerdicts.get(a.email!.toLowerCase()) ?? false);
    if (!safe) result.bouncerSkipped++;
    return {
      id: linkbuildingChannelId(a.website),
      title: a.name,
      // The send path greets with cleanName || title. A byline author beats
      // the site name ("Hi Sarah" over "Hi TechBlog") when Sonar surfaced one.
      cleanName: a.author ?? a.name,
      country,
      language: null,
      subscribers: null,
      videoCount: null,
      primaryEmail: a.email!,
      allEmails:
        a.extractedEmails && a.extractedEmails.length > 0
          ? a.extractedEmails
          : [a.email!],
      // Repurposed for this vertical: the relevant article/listing URL, so a
      // future template iteration can reference the exact post.
      topicCategories: a.articleUrl ? [a.articleUrl] : null,
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
