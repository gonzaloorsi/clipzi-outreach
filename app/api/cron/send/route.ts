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
import {
  loadSenderEmails,
  syncSendersFromEnv,
  pickSender,
  recordSenderUsed,
  getTotalDailyCapacity,
} from "@/lib/sender-pool";
import { activeCountries, parseSendWindow } from "@/lib/timezone";
import { sendOutreachReport, type ReportSendResult } from "@/lib/report";

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

    const candidates = await db
      .select({
        id: channels.id,
        title: channels.title,
        cleanName: channels.cleanName,
        primaryEmail: channels.primaryEmail,
        score: channels.score,
        country: channels.country,
        language: channels.language,
        subscribers: channels.subscribers,
      })
      .from(channels)
      .where(and(...whereClauses))
      .orderBy(desc(channels.score))
      .limit(max);

    log(`candidates picked: ${candidates.length}`);

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

      if (dryRun) {
        pushResult(c, sender.email, "dry_run");
        continue;
      }

      const res = await sendEmail({
        to: email,
        channelName,
        fromEmail: sender.email,
        fromName: senderName!,
        country: c.country ?? null,
        language: c.language ?? null,
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
              sentAt: new Date(),
              language: res.language,
              templateId: `v1_${res.language}`,
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
              templateId: `v1_${res.language}`,
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

    // ─── 4. Send report email (only if there were attempts and not dry) ──
    let reportStatus: { ok: boolean; error?: string; messageId?: string } | null = null;
    if (!dryRun && (sent > 0 || failed > 0)) {
      try {
        const [queuedRemainingRow, totalSentRow, senderStatsRows] =
          await Promise.all([
            db.execute<{ cnt: number }>(sql`
              SELECT COUNT(*)::int AS cnt FROM channels
              WHERE status = 'queued' AND primary_email IS NOT NULL
                AND primary_email NOT IN (SELECT email FROM sends)
                AND primary_email NOT IN (SELECT email FROM unsubscribes)
            `),
            db.execute<{ cnt: number }>(sql`
              SELECT COUNT(*)::int AS cnt FROM sends WHERE status = 'sent'
            `),
            db.execute<{ email: string; sent_24h: number; daily_limit: number }>(sql`
              SELECT s.email, s.daily_limit,
                COALESCE((
                  SELECT COUNT(*)::int FROM sends
                  WHERE sender_id = s.id AND status = 'sent'
                    AND sent_at > NOW() - INTERVAL '24 hours'
                ), 0) AS sent_24h
              FROM senders s
              WHERE s.state = 'active'
              ORDER BY s.email
            `),
          ]);

        const queuedRemaining =
          (queuedRemainingRow.rows ?? queuedRemainingRow)[0]?.cnt ?? 0;
        const totalSentAllTime =
          (totalSentRow.rows ?? totalSentRow)[0]?.cnt ?? 0;
        const senderStats = (senderStatsRows.rows ?? senderStatsRows).map(
          (r) => ({
            email: r.email,
            sent24h: r.sent_24h,
            dailyLimit: r.daily_limit,
          }),
        );

        // Strip the internal-only fields before passing to report
        const reportResults = results
          .filter((r) => !r.dry)
          .map(({ dry: _dry, sender: _s, ...rest }) => rest);

        reportStatus = await sendOutreachReport({
          runStartedAt: new Date(startedAt),
          runDurationMs: Date.now() - startedAt,
          sent,
          failed,
          results: reportResults,
          totalDailyCapacity,
          queuedRemaining,
          totalSentAllTime,
          window: {
            bypassed: ignoreWindow,
            hours: `${sendWindow.start}-${sendWindow.end}`,
            activeCountries: activeCountryList?.length ?? null,
          },
          senderStats,
          version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
        });
        if (reportStatus.ok) {
          log(`report email sent (id=${reportStatus.messageId})`);
        } else {
          log(`⚠️  report email failed: ${reportStatus.error}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`⚠️  report build failed (cron itself OK): ${msg}`);
        reportStatus = { ok: false, error: msg };
      }
    }

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
      durationMs: Date.now() - startedAt,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      report: reportStatus,
      results: dryRun ? results : results.slice(0, 10),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log(`ERROR: ${msg}`);
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
