// Sender cron — pulls top-scoring queued channels, sends via Resend, marks sent.
//
// "Pilar 2 lite": multiple sender inboxes via SENDER_EMAIL_1..10, round-robin
// by least-recent usage, per-inbox daily_limit (default 100). No warm-up state
// machine, no automatic pause on bounce/complaint, no ESP rotation. Pilar 2
// proper adds those.
//
// The "no repeats" guarantee lives entirely in the DB:
//   - sends.channel_id UNIQUE → can't send to same channel twice
//   - sends.email UNIQUE → can't send to same email twice (different channels
//     sharing a manager email get one shot)
//   - candidate query excludes anything already in sends or unsubscribes
//
// Idempotent under concurrent runs: if two crons fire and pick the same row,
// one INSERT wins, the other gets ON CONFLICT DO NOTHING.

import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { channels, sends, unsubscribes } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { isGovernmentEmail } from "@/lib/agency-search";
import {
  loadSenderEmails,
  syncSendersFromEnv,
  pickSender,
  recordSenderUsed,
  getTotalDailyCapacity,
} from "@/lib/sender-pool";
import { activeCountries, parseSendWindow } from "@/lib/timezone";
import { sendCronFailureAlert, type ReportSendResult } from "@/lib/report";
import { formatMmss } from "@/lib/heatmap";
import { fetchFrameAttachment } from "@/lib/frames";
import { pickTemplate, type HotInput, type TemplateKind } from "@/lib/templates";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

const SEND_DELAY_MS = 200; // pacing between sends; Resend rate-limits at ~10/s

// sends.template_id: v1_<kind>_<lang> for the legacy templates, v2_hot_<lang> /
// v2_question_<lang> for the YouTube v2 arm. The A/B readout groups on this.
function templateIdFor(kind: TemplateKind, language: string): string {
  if (kind === "youtube-hot") return `v2_hot_${language}`;
  if (kind === "youtube-question") return `v2_question_${language}`;
  return `v1_${kind.replace(/-/g, "_")}_${language}`;
}

// channels.hot_* → template input. Null when the enrich found nothing (the
// template router then serves youtube-question in the v2 arm).
function hotInputFor(c: {
  hotSource: string | null;
  hotVideoTitle: string | null;
  hotStartS: number | null;
  hotStart2S: number | null;
  hotLabel: string | null;
  hotPerMonth: number | null;
  hotAvgMinutes: number | null;
}): HotInput | null {
  if (!c.hotSource || !c.hotVideoTitle) return null;
  if (c.hotSource !== "heatmap" && c.hotSource !== "top_comment" && c.hotSource !== "cadence") return null;
  return {
    source: c.hotSource,
    videoTitle: c.hotVideoTitle,
    mmss: c.hotStartS != null ? formatMmss(c.hotStartS) : null,
    mmss2: c.hotStart2S != null ? formatMmss(c.hotStart2S) : null,
    label: c.hotLabel,
    perMonth: c.hotPerMonth,
    avgMinutes: c.hotAvgMinutes,
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const explicitMax = Number(url.searchParams.get("max"));
  const dailyLimitPerSender = Number(process.env.DAILY_SEND_CAP) || 100;
  const senderName = process.env.SENDER_NAME;
  // Optional country filter: ?country=AU or ?country=AU,NZ,GB
  // Useful for testing a specific country segment without firing the full bucket.
  const countryFilter = url.searchParams
    .get("country")
    ?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  // Timezone gating: only send to recipients whose local hour is in window.
  // ?ignoreWindow=1 bypasses for testing.
  const ignoreWindow = url.searchParams.get("ignoreWindow") === "1";
  const sendWindow = parseSendWindow(process.env.SEND_WINDOW_HOURS);
  const activeCountryList = ignoreWindow ? null : activeCountries(sendWindow);
  const log = (msg: string) =>
    console.log(`[send ${new Date().toISOString()}]`, msg);

  // ─── Config validation ─────────────────────────────────────────────────
  const senderEmails = loadSenderEmails();
  const configErrors: string[] = [];
  if (senderEmails.length === 0)
    configErrors.push("no SENDER_EMAIL_1..10 (or SENDER_EMAIL) set");
  if (!senderName) configErrors.push("SENDER_NAME not set");
  if (!process.env.RESEND_API_KEY) configErrors.push("RESEND_API_KEY not set");

  if (configErrors.length > 0 && !dryRun) {
    log(`config errors: ${configErrors.join("; ")}`);
    return NextResponse.json(
      { ok: false, error: "missing config", details: configErrors },
      { status: 500 },
    );
  }

  const windowDesc = ignoreWindow
    ? "BYPASSED (ignoreWindow=1)"
    : `${sendWindow.start}:00-${sendWindow.end}:00 local, active countries=${activeCountryList?.length ?? 0}`;
  log(
    `starting dry=${dryRun} configuredSenders=${senderEmails.length} dailyLimitPerSender=${dailyLimitPerSender} window=${windowDesc}`,
  );

  const startedAt = Date.now();

  try {
    // ─── 1. Sync senders table from env ─────────────────────────────────
    const syncResult = await syncSendersFromEnv(dailyLimitPerSender);
    log(
      `senders sync: ${syncResult.configured} configured, ${syncResult.inserted} new rows`,
    );

    const totalDailyCapacity = await getTotalDailyCapacity();
    // Bucket per cron tick: 1/24 of daily capacity (we run hourly).
    const max =
      explicitMax || Math.max(1, Math.ceil(totalDailyCapacity / 24));
    log(`daily capacity: ${totalDailyCapacity}, picking up to ${max} this run`);

    // ─── 2. Pick candidates ─────────────────────────────────────────────
    const whereClauses = [
      eq(channels.status, "queued"),
      sql`${channels.primaryEmail} IS NOT NULL`,
      sql`${channels.primaryEmail} NOT IN (SELECT email FROM ${sends})`,
      sql`${channels.primaryEmail} NOT IN (SELECT email FROM ${unsubscribes})`,
    ];

    // Build the country filter. Two independent constraints can apply:
    //   - timezone gate (the active countries given current UTC), unless
    //     ?ignoreWindow=1
    //   - manual ?country= filter (testing a specific segment)
    // If both are present, we INTERSECT them: the candidate's country must be
    // in BOTH the manual list AND the active set. To force a country that's
    // currently outside its window, you must pass ignoreWindow=1.
    let effectiveCountrySet: string[] | null = null;
    if (countryFilter && countryFilter.length > 0 && activeCountryList !== null) {
      effectiveCountrySet = countryFilter.filter((c) =>
        activeCountryList.includes(c),
      );
      if (effectiveCountrySet.length === 0) {
        log(
          `country filter [${countryFilter.join(", ")}] has zero overlap with active countries (all are outside their TZ window)`,
        );
      }
    } else if (countryFilter && countryFilter.length > 0) {
      // ignoreWindow=1 — manual filter alone, no gate
      effectiveCountrySet = countryFilter;
    } else if (activeCountryList !== null) {
      effectiveCountrySet = activeCountryList;
    }

    if (effectiveCountrySet !== null) {
      if (effectiveCountrySet.length === 0) {
        // Nothing matches. Only null-country candidates (no TZ info) get through
        // when the gate is active. If a user explicitly filtered by country
        // and got zero overlap, exclude even those.
        if (countryFilter && countryFilter.length > 0) {
          whereClauses.push(sql`FALSE`);
        } else {
          whereClauses.push(sql`${channels.country} IS NULL`);
          log(`no countries in window — only null-country candidates eligible`);
        }
      } else {
        const list = sql.join(
          effectiveCountrySet.map((c) => sql`${c}`),
          sql`, `,
        );
        // Null-country candidates only get included when there's NO manual
        // country filter (otherwise the user is asking for a specific set).
        if (countryFilter && countryFilter.length > 0) {
          whereClauses.push(sql`${channels.country} IN (${list})`);
        } else {
          whereClauses.push(
            sql`(${channels.country} IN (${list}) OR ${channels.country} IS NULL)`,
          );
        }
      }
    }

    // Seven-way split: creators / agencies / standup / media-org / journalist /
    // photographer / linkbuilding. AGENCY_SEND_RATIO default 20,
    // LINKBUILDING_SEND_RATIO default 20, the other verticals default 10,
    // creators = remainder.
    // Ratios clamped 0-100 each. If their sum exceeds 100 we proportionally
    // scale the slot ratios so creators get at least 0.
    // Agencies default to 0 since 2026-09: 108k sends, 1.2 replies/1000, 5
    // trial codes. Re-enable via AGENCY_SEND_RATIO once the copy is reworked.
    const agencyPctRaw = Math.max(
      0,
      Math.min(100, Number(process.env.AGENCY_SEND_RATIO ?? "0")),
    );
    const standupPctRaw = Math.max(
      0,
      Math.min(100, Number(process.env.STANDUP_SEND_RATIO ?? "10")),
    );
    const mediaOrgPctRaw = Math.max(
      0,
      Math.min(100, Number(process.env.MEDIA_ORG_SEND_RATIO ?? "10")),
    );
    const journalistPctRaw = Math.max(
      0,
      Math.min(100, Number(process.env.JOURNALIST_SEND_RATIO ?? "10")),
    );
    const photographerPctRaw = Math.max(
      0,
      Math.min(100, Number(process.env.PHOTOGRAPHER_SEND_RATIO ?? "10")),
    );
    const linkbuildingPctRaw = Math.max(
      0,
      Math.min(100, Number(process.env.LINKBUILDING_SEND_RATIO ?? "20")),
    );
    const churchPctRaw = Math.max(
      0,
      Math.min(100, Number(process.env.CHURCH_SEND_RATIO ?? "10")),
    );
    let agencyPct = agencyPctRaw;
    let standupPct = standupPctRaw;
    let mediaOrgPct = mediaOrgPctRaw;
    let journalistPct = journalistPctRaw;
    let photographerPct = photographerPctRaw;
    let linkbuildingPct = linkbuildingPctRaw;
    let churchPct = churchPctRaw;
    const sumPct =
      agencyPct + standupPct + mediaOrgPct + journalistPct + photographerPct + linkbuildingPct + churchPct;
    if (sumPct > 100) {
      const scale = 100 / sumPct;
      agencyPct *= scale;
      standupPct *= scale;
      mediaOrgPct *= scale;
      journalistPct *= scale;
      photographerPct *= scale;
      linkbuildingPct *= scale;
      churchPct *= scale;
    }
    const agencyRatio = agencyPct / 100;
    const standupRatio = standupPct / 100;
    const mediaOrgRatio = mediaOrgPct / 100;
    const journalistRatio = journalistPct / 100;
    const photographerRatio = photographerPct / 100;
    const linkbuildingRatio = linkbuildingPct / 100;
    const churchRatio = churchPct / 100;
    const agencyTarget = Math.round(max * agencyRatio);
    const standupTarget = Math.round(max * standupRatio);
    const mediaOrgTarget = Math.round(max * mediaOrgRatio);
    const journalistTarget = Math.round(max * journalistRatio);
    const photographerTarget = Math.round(max * photographerRatio);
    const linkbuildingTarget = Math.round(max * linkbuildingRatio);
    const churchTarget = Math.round(max * churchRatio);
    const creatorTarget = Math.max(
      0,
      max -
        agencyTarget -
        standupTarget -
        mediaOrgTarget -
        journalistTarget -
        photographerTarget -
        linkbuildingTarget -
        churchTarget,
    );

    const isAgencyExpr = sql`(
      COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:agency:%'
      OR COALESCE(${channels.discoveredVia}, '') LIKE 'agency:%'
      OR COALESCE(${channels.discoveredVia}, '') LIKE 'legacy:agencies%'
    )`;
    const isStandupExpr = sql`(
      COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:standup-individual:%'
      OR COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:standup-org:%'
    )`;
    const isMediaOrgExpr = sql`(
      COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:media-org:%'
    )`;
    const isJournalistExpr = sql`(
      COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:journalist-individual:%'
      OR COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:journalist-org:%'
    )`;
    const isPhotographerExpr = sql`(
      COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:photographer-individual:%'
      OR COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:photographer-org:%'
    )`;
    const isLinkbuildingExpr = sql`(
      COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:linkbuilding-site:%'
    )`;
    const isChurchExpr = sql`(
      COALESCE(${channels.discoveredVia}, '') LIKE 'sonar:church-org:%'
    )`;
    // Creator = none of the named verticals. Required because "NOT agency"
    // alone would sweep the other vertical rows into the creator pool.
    const isCreatorExpr = sql`(NOT ${isAgencyExpr} AND NOT ${isStandupExpr} AND NOT ${isMediaOrgExpr} AND NOT ${isJournalistExpr} AND NOT ${isPhotographerExpr} AND NOT ${isLinkbuildingExpr} AND NOT ${isChurchExpr})`;

    const selectFields = {
      id: channels.id,
      title: channels.title,
      cleanName: channels.cleanName,
      primaryEmail: channels.primaryEmail,
      score: channels.score,
      country: channels.country,
      language: channels.language,
      subscribers: channels.subscribers,
      discoveredVia: channels.discoveredVia,
      // Linkbuilding repurposes topicCategories as [articleUrl] for
      // per-article personalization. null/YT topic URIs are ignored below.
      topicCategories: channels.topicCategories,
      // "Most replayed" enrich for the YouTube v2 templates.
      hotSource: channels.hotSource,
      hotVideoId: channels.hotVideoId,
      hotVideoTitle: channels.hotVideoTitle,
      hotStartS: channels.hotStartS,
      hotStart2S: channels.hotStart2S,
      hotLabel: channels.hotLabel,
      hotPerMonth: channels.hotPerMonth,
      hotAvgMinutes: channels.hotAvgMinutes,
      hotPublishedAt: channels.hotPublishedAt,
    };

    // Human-readable article reference for linkbuilding rows: strip protocol,
    // www and query so the email reads "your article at site.com/best-ai-tools"
    // instead of pasting a raw URL. Only linkbuilding rows carry an http URL in
    // topicCategories; every other vertical stores null or YT topic URIs there.
    const articleRef = (c: { discoveredVia: string | null; topicCategories: unknown }): string | null => {
      if (!(c.discoveredVia ?? "").startsWith("sonar:linkbuilding-")) return null;
      const first = Array.isArray(c.topicCategories) ? c.topicCategories[0] : null;
      if (typeof first !== "string" || !first.startsWith("http")) return null;
      const readable = first
        .replace(/^https?:\/\/(www\.)?/, "")
        .split(/[?#]/)[0]
        .replace(/\/$/, "");
      return readable.length > 4 && readable.length <= 90 ? readable : null;
    };

    const [
      creatorPool,
      agencyPool,
      standupPool,
      mediaOrgPool,
      journalistPool,
      photographerPool,
      linkbuildingPool,
      churchPool,
    ] = await Promise.all([
      // Creators: rows with a hot moment go first, freshest upload first (the
      // email lands within 48h of the video when possible), then score.
      creatorTarget > 0
        ? db
            .select(selectFields)
            .from(channels)
            .where(and(...whereClauses, isCreatorExpr))
            .orderBy(
              sql`(${channels.hotSource} IS NOT NULL) DESC`,
              sql`${channels.hotPublishedAt} DESC NULLS LAST`,
              desc(channels.score),
            )
            .limit(creatorTarget)
        : Promise.resolve([]),
      agencyTarget > 0
        ? db
            .select(selectFields)
            .from(channels)
            .where(and(...whereClauses, isAgencyExpr))
            .orderBy(desc(channels.score))
            .limit(agencyTarget)
        : Promise.resolve([]),
      standupTarget > 0
        ? db
            .select(selectFields)
            .from(channels)
            .where(and(...whereClauses, isStandupExpr))
            .orderBy(desc(channels.score))
            .limit(standupTarget)
        : Promise.resolve([]),
      mediaOrgTarget > 0
        ? db
            .select(selectFields)
            .from(channels)
            .where(and(...whereClauses, isMediaOrgExpr))
            .orderBy(desc(channels.score))
            .limit(mediaOrgTarget)
        : Promise.resolve([]),
      journalistTarget > 0
        ? db
            .select(selectFields)
            .from(channels)
            .where(and(...whereClauses, isJournalistExpr))
            .orderBy(desc(channels.score))
            .limit(journalistTarget)
        : Promise.resolve([]),
      photographerTarget > 0
        ? db
            .select(selectFields)
            .from(channels)
            .where(and(...whereClauses, isPhotographerExpr))
            .orderBy(desc(channels.score))
            .limit(photographerTarget)
        : Promise.resolve([]),
      linkbuildingTarget > 0
        ? db
            .select(selectFields)
            .from(channels)
            .where(and(...whereClauses, isLinkbuildingExpr))
            .orderBy(desc(channels.score))
            .limit(linkbuildingTarget)
        : Promise.resolve([]),
      churchTarget > 0
        ? db
            .select(selectFields)
            .from(channels)
            .where(and(...whereClauses, isChurchExpr))
            .orderBy(desc(channels.score))
            .limit(churchTarget)
        : Promise.resolve([]),
    ]);

    // Concat order: B2B verticals first (agency, standup, media-org, journalist,
    // photographer, linkbuilding, church), creators last.
    let candidates = [
      ...agencyPool,
      ...standupPool,
      ...mediaOrgPool,
      ...journalistPool,
      ...photographerPool,
      ...linkbuildingPool,
      ...churchPool,
      ...creatorPool,
    ];

    // Backfill: any deficit is filled from the broader pool (any kind not yet
    // picked). Linkbuilding is EXCLUDED from backfill on purpose: its daily
    // volume must stay capped at its ratio (finite pool of quality sites, and
    // we don't want backlink asks eating all idle capacity when creator
    // discovery runs dry).
    const shortage = max - candidates.length;
    if (shortage > 0) {
      const usedIds = new Set(candidates.map((c) => c.id));
      // A vertical whose ratio is 0 is switched off on purpose (agencies since
      // 2026-09): it must not sneak back in through the backfill either.
      const backfillExclusions = [sql`NOT ${isLinkbuildingExpr}`];
      if (agencyTarget === 0) backfillExclusions.push(sql`NOT ${isAgencyExpr}`);
      const overfetch = await db
        .select(selectFields)
        .from(channels)
        .where(and(...whereClauses, ...backfillExclusions))
        .orderBy(desc(channels.score))
        .limit((shortage + candidates.length) * 2);
      const backfill = overfetch
        .filter((r) => !usedIds.has(r.id))
        .slice(0, shortage);
      candidates = [...candidates, ...backfill];
    }

    log(
      `candidates picked: ${candidates.length} (target split: ${creatorTarget} creators + ${agencyTarget} agencies + ${standupTarget} standup + ${mediaOrgTarget} media-org + ${journalistTarget} journalist + ${photographerTarget} photographer + ${linkbuildingTarget} linkbuilding + ${churchTarget} church; actual: ${creatorPool.length}/${agencyPool.length}/${standupPool.length}/${mediaOrgPool.length}/${journalistPool.length}/${photographerPool.length}/${linkbuildingPool.length}/${churchPool.length}, +${Math.max(0, candidates.length - creatorPool.length - agencyPool.length - standupPool.length - mediaOrgPool.length - journalistPool.length - photographerPool.length - linkbuildingPool.length - churchPool.length)} backfill)`,
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        failed: 0,
        skipped: true,
        reason: "no_candidates",
        senders: senderEmails,
        totalDailyCapacity,
      });
    }

    // ─── 3. Send each ────────────────────────────────────────────────────
    let sent = 0;
    let failed = 0;
    let stoppedReason: string | null = null;
    const results: Array<
      ReportSendResult & { dry?: boolean; sender?: string }
    > = [];

    function pushResult(
      c: (typeof candidates)[number],
      senderEmail: string,
      status: ReportSendResult["status"] | "dry_run",
      extras: Partial<ReportSendResult> = {},
    ) {
      const detected = extras.language ?? c.language ?? "en";
      results.push({
        channelId: c.id,
        channelTitle: c.title,
        cleanName: c.cleanName,
        email: c.primaryEmail!,
        senderEmail,
        language: detected,
        country: c.country,
        subscribers: c.subscribers,
        score: c.score,
        status: status === "dry_run" ? "sent" : status, // report cares about sent/failed/sent_db_failed
        dry: status === "dry_run",
        sender: senderEmail,
        ...extras,
      });
    }

    for (const c of candidates) {
      // Pick sender for THIS send (round-robin by least 24h usage).
      const sender = await pickSender();
      if (!sender) {
        stoppedReason = "all_senders_capped";
        log(`stopped: all senders at daily limit`);
        break;
      }

      const channelName = c.cleanName || c.title;
      const email = c.primaryEmail!;

      // Defense in depth: pre-filter channels may still carry government
      // addresses in the DB. Never cold-mail the state, whatever the source.
      if (isGovernmentEmail(email)) {
        log(`skipping gov email ${email} (channel ${c.id}), marking low_quality`);
        try {
          await db
            .update(channels)
            .set({ status: "low_quality", updatedAt: new Date() })
            .where(eq(channels.id, c.id));
        } catch {
          // If the update fails the guard still skips it on every pass.
        }
        continue;
      }

      if (dryRun) {
        pushResult(c, sender.email, "dry_run");
        continue;
      }

      // Our own Message-ID so follow-up bumps can thread under this email.
      const rfcMessageId = `<${crypto.randomUUID()}@${sender.email.split("@")[1]}>`;

      // youtube-hot emails carry the still of the peak (rendered by Modal into
      // R2 when hot-moments ran). Missing frame = the email goes out without it.
      const hot = hotInputFor(c);
      const kindPreview = pickTemplate({ id: c.id, country: c.country, language: c.language, discoveredVia: c.discoveredVia, hotSource: c.hotSource }).kind;
      const frame = kindPreview === "youtube-hot" && c.hotSource === "heatmap" && c.hotVideoId && c.hotStartS != null
        ? await fetchFrameAttachment(c.hotVideoId, c.hotStartS)
        : null;

      const res = await sendEmail({
        to: email,
        channelName,
        fromEmail: sender.email,
        fromName: senderName!,
        country: c.country ?? null,
        language: c.language ?? null,
        discoveredVia: c.discoveredVia ?? null,
        article: articleRef(c),
        channelId: c.id,
        hot,
        ...(frame ? { attachments: [frame] } : {}),
        rfcMessageId,
        // Deliverability defaults — discovered via GMass + GlockApps testing.
        // Plain text + lowercase subject lands in Inbox where HTML + Title Case
        // landed in Spam/Promotions across all sender domains. Templates stay
        // HTML-formatted (used by debug endpoint + dashboard preview); only the
        // outreach send applies these transforms.
        textOnly: true,
        lowercaseSubject: true,
      });

      if (res.ok) {
        // Sequential writes — neon-http doesn't support transactions.
        // sends INSERT is the source of truth for "we sent". The candidate
        // query filters by `email NOT IN sends`, so even if the channels
        // UPDATE fails afterwards, no duplicate send can occur.
        let insertOk = false;
        let insertErr: string | null = null;
        try {
          const inserted = await db
            .insert(sends)
            .values({
              channelId: c.id,
              email,
              senderId: sender.id,
              status: "sent",
              espMessageId: res.messageId,
              rfcMessageId,
              sentAt: new Date(),
              language: res.language,
              templateId: templateIdFor(res.kind, res.language),
            })
            .onConflictDoNothing()
            .returning({ id: sends.id });
          insertOk = inserted.length > 0;
          if (!insertOk) {
            // ON CONFLICT skipped — race or pre-existing row. Still safe.
            insertOk = true;
          }
        } catch (e: unknown) {
          insertErr = e instanceof Error ? e.message : String(e);
        }

        if (insertOk) {
          // Best-effort status update. If this fails, channel stays
          // status='queued' but is filtered from future picks because its
          // email is now in sends.
          try {
            await db
              .update(channels)
              .set({ status: "sent", updatedAt: new Date() })
              .where(eq(channels.id, c.id));
          } catch (e: unknown) {
            log(
              `⚠️  channels status update failed for ${c.id} (send already recorded): ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          await recordSenderUsed(sender.id);
          sent++;
          pushResult(c, sender.email, "sent", {
            language: res.language,
            messageId: res.messageId,
          });
        } else {
          // Email went out via Resend but we couldn't record it. Critical:
          // include the messageId so manual recovery is possible.
          failed++;
          log(
            `⚠️  email sent (resend id=${res.messageId}) via ${sender.email} but sends INSERT failed for ${email}: ${insertErr}`,
          );
          pushResult(c, sender.email, "sent_db_failed", {
            language: res.language,
            messageId: res.messageId,
            error: insertErr ?? "unknown insert failure",
          });
        }
      } else {
        failed++;
        try {
          await db
            .insert(sends)
            .values({
              channelId: c.id,
              email,
              senderId: sender.id,
              status: "failed",
              errorMessage: res.error,
              language: res.language,
              templateId: templateIdFor(res.kind, res.language),
            })
            .onConflictDoNothing();
        } catch {
          // Best effort
        }
        pushResult(c, sender.email, "failed", {
          language: res.language,
          error: res.error,
        });
      }

      await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }

    log(
      `done — sent=${sent} failed=${failed} stopped=${stoppedReason ?? "none"}`,
    );

    // NOTE: this cron no longer emails a report per tick. The daily digest at
    // /api/cron/daily-report (00:00 UTC = 21:00 ART) summarizes the whole day
    // in a single email. The send cron stays send-only.

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      attempted: candidates.length,
      stoppedReason,
      senders: senderEmails,
      totalDailyCapacity,
      window: {
        bypassed: ignoreWindow,
        hours: `${sendWindow.start}-${sendWindow.end}`,
        activeCountries: activeCountryList?.length ?? null,
      },
      mix: {
        agencyRatioPct: agencyRatio * 100,
        standupRatioPct: standupRatio * 100,
        mediaOrgRatioPct: mediaOrgRatio * 100,
        journalistRatioPct: journalistRatio * 100,
        photographerRatioPct: photographerRatio * 100,
        linkbuildingRatioPct: linkbuildingRatio * 100,
        churchRatioPct: churchRatio * 100,
        target: {
          creators: creatorTarget,
          agencies: agencyTarget,
          standup: standupTarget,
          mediaOrg: mediaOrgTarget,
          journalist: journalistTarget,
          photographer: photographerTarget,
          linkbuilding: linkbuildingTarget,
          church: churchTarget,
        },
        actual: {
          creators: creatorPool.length,
          agencies: agencyPool.length,
          standup: standupPool.length,
          mediaOrg: mediaOrgPool.length,
          journalist: journalistPool.length,
          photographer: photographerPool.length,
          linkbuilding: linkbuildingPool.length,
          church: churchPool.length,
          backfill: Math.max(
            0,
            candidates.length -
              creatorPool.length -
              agencyPool.length -
              standupPool.length -
              mediaOrgPool.length -
              journalistPool.length -
              photographerPool.length -
              linkbuildingPool.length -
              churchPool.length,
          ),
        },
      },
      durationMs: Date.now() - startedAt,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      results: dryRun ? results : results.slice(0, 10),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log(`ERROR: ${msg}`);
    await sendCronFailureAlert("send", msg);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        stack: process.env.NODE_ENV === "development" ? stack : undefined,
      },
      { status: 500 },
    );
  }
}
