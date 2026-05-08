// Channel enrichment: channelIds → DB rows with email, subs, score, status.
// 1 quota unit per batch of 50 channels.

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { channels } from "../db/schema";
import type { YouTubeClient, YtChannelsResult } from "./youtube";
import { scoreChannel, meetsThreshold } from "./score";
import { verifyEmailsBatch, isSafeToSend } from "./bouncer";

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

export function extractEmails(text: string | undefined | null): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_RE) ?? [];
  return [...new Set(matches.map((e) => e.toLowerCase()))];
}

export function cleanName(name: string): string {
  let clean = name
    .replace(
      /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[\u{2700}-\u{27BF}]|[\u{200D}]|[\u{FE0F}]/gu,
      "",
    )
    .trim();

  const separators = [" | ", " · ", " - ", " : ", " (", " [", " / ", " — "];
  for (const sep of separators) {
    const idx = clean.indexOf(sep);
    if (idx > 3) {
      const first = clean.substring(0, idx).trim();
      if (first.length > 3) clean = first;
    }
  }

  clean = clean.replace(/[_\-·|:—]+$/g, "").trim();

  // Common multilingual prefixes
  clean = clean.replace(/^(El Canal De |EL CANAL DE |The )/i, "");

  return clean || name;
}

export interface EnrichResult {
  processed: number;
  enriched: number; // got snippet+stats back
  queued: number; // had email + meets threshold + Bouncer says safe
  noEmail: number;
  lowQuality: number;
  invalidEmail: number; // had email but Bouncer flagged as undeliverable / risky-disposable / unknown
  quotaUsed: number;
  errors: string[];
}

export interface EnrichOptions {
  source?: string; // for discoveredVia attribution
  defaultLanguage?: string; // hint from upstream source
}

/**
 * Fetch metadata for given channelIds and upsert to DB with classified status.
 *
 * - "queued": has email + subs >= MIN_SUBSCRIBERS → ready to send
 * - "no_email": passed subs threshold but no email in description
 * - "low_quality": below subs threshold or other red flag
 *
 * Idempotent via channels.id PRIMARY KEY conflict.
 * Skips channels already in 'sent', 'bounced', 'complained', 'opted_out' status
 * (handled at the SQL layer with ON CONFLICT DO UPDATE WHERE).
 */
export async function enrichChannels(
  yt: YouTubeClient,
  channelIds: string[],
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const result: EnrichResult = {
    processed: 0,
    enriched: 0,
    queued: 0,
    noEmail: 0,
    lowQuality: 0,
    invalidEmail: 0,
    quotaUsed: 0,
    errors: [],
  };

  if (channelIds.length === 0) return result;

  const quotaStart = yt.quotaUsed;
  const BATCH = 50;

  for (let i = 0; i < channelIds.length; i += BATCH) {
    const batch = channelIds.slice(i, i + BATCH);
    let data: YtChannelsResult;
    try {
      data = await yt.call<YtChannelsResult>("channels", {
        part: "snippet,statistics,topicDetails,brandingSettings",
        id: batch.join(","),
        maxResults: 50,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`batch starting ${batch[0]}: ${msg.slice(0, 200)}`);
      if (msg.includes("All YouTube API keys")) break;
      continue;
    }

    result.processed += batch.length;
    const items = data.items ?? [];
    result.enriched += items.length;

    if (items.length === 0) continue;

    // Pass 1: build draft rows + initial status (pre-Bouncer)
    type DraftRow = {
      id: string;
      title: string;
      cleanName: string;
      country: string | null;
      language: string | null;
      subscribers: number;
      videoCount: number;
      primaryEmail: string | null;
      allEmails: string[] | null;
      topicCategories: string[] | null;
      score: number;
      status: "queued" | "no_email" | "low_quality";
      discoveredVia: string | null;
      lastRefreshedAt: Date;
    };
    const drafts: DraftRow[] = items.map((it) => {
      const subs = parseInt(it.statistics?.subscriberCount ?? "0", 10) || 0;
      const videoCount = parseInt(it.statistics?.videoCount ?? "0", 10) || 0;
      const desc = it.snippet?.description ?? "";
      const emails = extractEmails(desc);
      const primaryEmail = emails[0] ?? null;
      const country =
        it.snippet?.country ??
        it.brandingSettings?.channel?.country ??
        null;
      const language =
        it.snippet?.defaultLanguage ??
        it.brandingSettings?.channel?.defaultLanguage ??
        opts.defaultLanguage ??
        null;
      const topicCategories = it.topicDetails?.topicCategories ?? [];

      const score = scoreChannel({
        subscribers: subs,
        videoCount,
        topicCategories,
        primaryEmail,
        country,
      });

      const passesThreshold = meetsThreshold({
        subscribers: subs,
        videoCount,
        topicCategories,
        primaryEmail,
        country,
      });

      let status: "queued" | "no_email" | "low_quality";
      if (!passesThreshold) status = "low_quality";
      else if (!primaryEmail) status = "no_email";
      else status = "queued";

      const title = it.snippet?.title ?? it.id;
      return {
        id: it.id,
        title,
        cleanName: cleanName(title),
        country,
        language,
        subscribers: subs,
        videoCount,
        primaryEmail,
        allEmails: emails.length > 0 ? emails : null,
        topicCategories: topicCategories.length > 0 ? topicCategories : null,
        score,
        status,
        discoveredVia: opts.source ?? null,
        lastRefreshedAt: new Date(),
      };
    });

    // Tally PRE-Bouncer state (so we know what would have been queued).
    for (const d of drafts) {
      if (d.status === "queued") result.queued++;
      else if (d.status === "no_email") result.noEmail++;
      else if (d.status === "low_quality") result.lowQuality++;
    }

    // Pass 2: validate emails for rows that would otherwise be 'queued'.
    // Demote to 'low_quality' when Bouncer says undeliverable / risky-disposable /
    // unknown. The conservative gate lives in lib/bouncer.ts:isSafeToSend.
    const toValidate = drafts.filter((d) => d.status === "queued" && d.primaryEmail);
    const emailsToValidate = toValidate.map((d) => d.primaryEmail!);
    if (emailsToValidate.length > 0) {
      const verdicts = await verifyEmailsBatch(emailsToValidate, 8);
      const verdictByEmail = new Map(verdicts.map((v) => [v.email, v]));
      for (const draft of toValidate) {
        const v = verdictByEmail.get(draft.primaryEmail!.toLowerCase());
        if (v && !isSafeToSend(v)) {
          draft.status = "low_quality";
          result.queued--;
          result.invalidEmail++;
        }
      }
    }

    const rows = drafts;

    // Upsert: only update if current status is one we WANT to refresh.
    // Never override 'sent'/'bounced'/'complained'/'opted_out'.
    await db
      .insert(channels)
      .values(rows)
      .onConflictDoUpdate({
        target: channels.id,
        set: {
          title: sql`EXCLUDED.title`,
          cleanName: sql`EXCLUDED.clean_name`,
          country: sql`EXCLUDED.country`,
          language: sql`EXCLUDED.language`,
          subscribers: sql`EXCLUDED.subscribers`,
          videoCount: sql`EXCLUDED.video_count`,
          primaryEmail: sql`EXCLUDED.primary_email`,
          allEmails: sql`EXCLUDED.all_emails`,
          topicCategories: sql`EXCLUDED.topic_categories`,
          score: sql`EXCLUDED.score`,
          status: sql`EXCLUDED.status`,
          lastRefreshedAt: sql`EXCLUDED.last_refreshed_at`,
          updatedAt: sql`NOW()`,
        },
        setWhere: sql`channels.status NOT IN ('sent', 'bounced', 'complained', 'opted_out')`,
      });
  }

  result.quotaUsed = yt.quotaUsed - quotaStart;
  return result;
}

/**
 * Insert never-seen channelIds as 'pending' rows so they appear in the channels
 * table with a stable record. Returns the IDs that were truly new (not already
 * in DB). The "newness" signal is what the bandit allocator uses for freshness.
 */
export async function recordPendingChannels(
  channelIds: string[],
  source: string,
): Promise<{ newIds: string[]; alreadyKnown: number }> {
  if (channelIds.length === 0) return { newIds: [], alreadyKnown: 0 };

  // Insert pending stubs; ON CONFLICT means already-known.
  // We want to know which were new. Use RETURNING.
  const rows = channelIds.map((id) => ({
    id,
    title: id, // placeholder — overwritten when enriched
    status: "pending" as const,
    discoveredVia: source,
  }));

  // Chunk to stay under neon-http body limits. A single INSERT with thousands
  // of rows hits "value too large to transmit" at full discovery quota. 500
  // rows × 4 cols = 2000 params per batch — well within Postgres + HTTP.
  const BATCH = 500;
  const inserted: Array<{ id: string }> = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const result = await db
      .insert(channels)
      .values(chunk)
      .onConflictDoNothing({ target: channels.id })
      .returning({ id: channels.id });
    inserted.push(...result);
  }

  const newIds = inserted.map((r) => r.id);
  return { newIds, alreadyKnown: channelIds.length - newIds.length };
}
