// Dashboard data layer — single source of truth for what /dashboard reads.
// Every function here returns plain typed shapes so the page stays a thin view.
//
// Validation: each query has a corresponding cross-check in
// scripts/validate-insights.ts. If you change a query, update the check.

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  COUNTRY_TO_TZ,
  getLocalHour,
  parseSendWindow,
  isInSendWindow,
  type SendWindow,
} from "./timezone";

// ─── KPIs ────────────────────────────────────────────────────────────────

export interface DashboardKPIs {
  totalSent: number; // SELECT COUNT(*) FROM sends WHERE status='sent'
  sent24h: number; // SELECT COUNT(*) FROM sends WHERE status='sent' AND sent_at > now()-24h
  sent7d: number; // SELECT COUNT(*) FROM sends WHERE status='sent' AND sent_at > now()-7d
  queuedSendable: number; // queued candidates filtered by NOT IN sends/unsubscribes
  totalDailyCapacity: number; // sum of senders.daily_limit where state='active'
  failedAllTime: number; // FAILED + sent_db_failed style — tracks issues to triage
}

export async function getKPIs(): Promise<DashboardKPIs> {
  type Row = {
    total_sent: number;
    sent_24h: number;
    sent_7d: number;
    queued_sendable: number;
    total_daily_capacity: number;
    failed: number;
  } & Record<string, unknown>;
  const result = await db.execute<Row>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM sends WHERE status = 'sent') AS total_sent,
      (SELECT COUNT(*)::int FROM sends WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '24 hours') AS sent_24h,
      (SELECT COUNT(*)::int FROM sends WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '7 days') AS sent_7d,
      (
        SELECT COUNT(*)::int FROM channels c
        WHERE c.status = 'queued'
          AND c.primary_email IS NOT NULL
          AND c.primary_email NOT IN (SELECT email FROM sends)
          AND c.primary_email NOT IN (SELECT email FROM unsubscribes)
      ) AS queued_sendable,
      (SELECT COALESCE(SUM(daily_limit), 0)::int FROM senders WHERE state = 'active') AS total_daily_capacity,
      (SELECT COUNT(*)::int FROM sends WHERE status = 'failed') AS failed
  `);
  const row = (result.rows ?? result)[0];
  return {
    totalSent: row.total_sent,
    sent24h: row.sent_24h,
    sent7d: row.sent_7d,
    queuedSendable: row.queued_sendable,
    totalDailyCapacity: row.total_daily_capacity,
    failedAllTime: row.failed,
  };
}

// ─── Pipeline funnel ─────────────────────────────────────────────────────

export interface PipelineStage {
  status: string;
  cnt: number;
}

export async function getPipeline(): Promise<PipelineStage[]> {
  const result = await db.execute<PipelineStage & Record<string, unknown>>(sql`
    SELECT status, COUNT(*)::int AS cnt
    FROM channels
    GROUP BY status
    ORDER BY
      CASE status
        WHEN 'pending' THEN 1
        WHEN 'enriched' THEN 2
        WHEN 'no_email' THEN 3
        WHEN 'low_quality' THEN 4
        WHEN 'queued' THEN 5
        WHEN 'sent' THEN 6
        WHEN 'bounced' THEN 7
        WHEN 'complained' THEN 8
        WHEN 'opted_out' THEN 9
        ELSE 10
      END
  `);
  return result.rows ?? result;
}

// ─── Recent sends ────────────────────────────────────────────────────────

export interface RecentSend {
  channel_id: string;
  channel_title: string;
  clean_name: string | null;
  email: string;
  status: string;
  language: string | null;
  template_id: string | null;
  country: string | null;
  subscribers: number | null;
  score: number | null;
  sender: string | null;
  sent_at: string | null;
  error_message: string | null;
}

export async function getRecentSends(limit = 20): Promise<RecentSend[]> {
  const result = await db.execute<RecentSend & Record<string, unknown>>(sql`
    SELECT
      s.channel_id,
      c.title AS channel_title,
      c.clean_name,
      s.email,
      s.status,
      s.language,
      s.template_id,
      c.country,
      c.subscribers,
      c.score,
      snd.email AS sender,
      s.sent_at,
      s.error_message
    FROM sends s
    JOIN channels c ON c.id = s.channel_id
    LEFT JOIN senders snd ON snd.id = s.sender_id
    ORDER BY COALESCE(s.sent_at, s.created_at) DESC
    LIMIT ${limit}
  `);
  return result.rows ?? result;
}

// ─── Senders pool ────────────────────────────────────────────────────────

export interface SenderRow {
  id: number;
  email: string;
  state: string;
  daily_limit: number;
  sent_total: number;
  sent_24h: number;
  last_used_at: string | null;
  reputation_score: number;
}

export async function getSenderPool(): Promise<SenderRow[]> {
  const result = await db.execute<SenderRow & Record<string, unknown>>(sql`
    SELECT
      s.id,
      s.email,
      s.state::text AS state,
      s.daily_limit,
      s.sent_total,
      COALESCE((
        SELECT COUNT(*)::int FROM sends
        WHERE sender_id = s.id AND status = 'sent'
          AND sent_at > NOW() - INTERVAL '24 hours'
      ), 0) AS sent_24h,
      s.last_used_at,
      s.reputation_score
    FROM senders s
    ORDER BY s.id
  `);
  return result.rows ?? result;
}

// ─── Send window state (timezone gate snapshot) ──────────────────────────

export interface SendWindowState {
  window: SendWindow;
  envOverride: string | null; // SEND_WINDOW_HOURS env value if set
  active: Array<{ country: string; tz: string; hour: number }>;
  outside: Array<{ country: string; tz: string; hour: number }>;
}

export function getSendWindowState(): SendWindowState {
  const envOverride = process.env.SEND_WINDOW_HOURS ?? null;
  const window = parseSendWindow(envOverride ?? undefined);
  const active: SendWindowState["active"] = [];
  const outside: SendWindowState["outside"] = [];
  for (const country of Object.keys(COUNTRY_TO_TZ)) {
    const hour = getLocalHour(country);
    const inside = isInSendWindow(country, window);
    const tz = COUNTRY_TO_TZ[country];
    if (hour === null) continue;
    if (inside === true) active.push({ country, tz, hour });
    else outside.push({ country, tz, hour });
  }
  // Sort by hour ascending so the dashboard reads naturally
  active.sort((a, b) => a.hour - b.hour);
  outside.sort((a, b) => a.hour - b.hour);
  return { window, envOverride, active, outside };
}

// ─── Discovery runs (recent) ─────────────────────────────────────────────

export interface DiscoveryRunRow {
  id: number;
  source: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  quota_used: number;
  channels_seen: number;
  channels_new: number;
  qualified_new: number;
  freshness_pct: number;
  qualified_pct: number;
  error: string | null;
}

export async function getDiscoveryRuns(limit = 10): Promise<DiscoveryRunRow[]> {
  const result = await db.execute<DiscoveryRunRow & Record<string, unknown>>(sql`
    SELECT
      id,
      source,
      started_at,
      ended_at,
      CASE
        WHEN ended_at IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (ended_at - started_at))::numeric, 1)::float
        ELSE NULL
      END AS duration_s,
      quota_used,
      channels_seen,
      channels_new,
      qualified_new,
      CASE WHEN channels_seen > 0
        THEN ROUND(100.0 * channels_new / channels_seen, 1)::float
        ELSE 0::float
      END AS freshness_pct,
      CASE WHEN channels_new > 0
        THEN ROUND(100.0 * qualified_new / channels_new, 1)::float
        ELSE 0::float
      END AS qualified_pct,
      error
    FROM discovery_runs
    ORDER BY id DESC
    LIMIT ${limit}
  `);
  return result.rows ?? result;
}

// ─── Sends breakdown by language and country (last 7 days) ───────────────

export interface SendsBreakdownRow {
  key: string;
  cnt: number;
}

export interface SendsBreakdown {
  byLanguage: SendsBreakdownRow[];
  byCountry: SendsBreakdownRow[];
}

export async function getSendsBreakdown(): Promise<SendsBreakdown> {
  const langResult = await db.execute<SendsBreakdownRow & Record<string, unknown>>(sql`
    SELECT COALESCE(language, '?') AS key, COUNT(*)::int AS cnt
    FROM sends
    WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '7 days'
    GROUP BY language
    ORDER BY cnt DESC
  `);
  const countryResult = await db.execute<SendsBreakdownRow & Record<string, unknown>>(sql`
    SELECT COALESCE(c.country, '(null)') AS key, COUNT(*)::int AS cnt
    FROM sends s
    JOIN channels c ON c.id = s.channel_id
    WHERE s.status = 'sent' AND s.sent_at > NOW() - INTERVAL '7 days'
    GROUP BY c.country
    ORDER BY cnt DESC
    LIMIT 15
  `);
  return {
    byLanguage: langResult.rows ?? langResult,
    byCountry: countryResult.rows ?? countryResult,
  };
}

// ─── Agency-specific stats (sonar:agency:* discoveredVia prefix) ────────

export interface AgencyStats {
  totalQueued: number;        // agencies in cartera ready to send
  totalSent: number;          // agencies already contacted
  totalEverDiscovered: number; // every agency row, regardless of status
  newLast7d: number;          // agencies added to channels in last 7 days
  sentLast7d: number;         // agency sends in last 7 days
  byCountry: Array<{ country: string; queued: number; sent: number }>;
  byCategory: Array<{ category: string; queued: number; sent: number }>;
}

export async function getAgencyStats(): Promise<AgencyStats> {
  const result = await db.execute<{
    total_queued: number;
    total_sent: number;
    total_ever: number;
    new_7d: number;
    sent_7d: number;
  } & Record<string, unknown>>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM channels
        WHERE discovered_via LIKE 'sonar:agency:%' OR discovered_via LIKE 'agency:%' OR discovered_via LIKE 'legacy:agencies%'
        AND status = 'queued') AS total_queued,
      (SELECT COUNT(*)::int FROM channels
        WHERE (discovered_via LIKE 'sonar:agency:%' OR discovered_via LIKE 'agency:%' OR discovered_via LIKE 'legacy:agencies%')
        AND status = 'sent') AS total_sent,
      (SELECT COUNT(*)::int FROM channels
        WHERE discovered_via LIKE 'sonar:agency:%' OR discovered_via LIKE 'agency:%' OR discovered_via LIKE 'legacy:agencies%') AS total_ever,
      (SELECT COUNT(*)::int FROM channels
        WHERE (discovered_via LIKE 'sonar:agency:%' OR discovered_via LIKE 'agency:%' OR discovered_via LIKE 'legacy:agencies%')
        AND created_at > NOW() - INTERVAL '7 days') AS new_7d,
      (SELECT COUNT(*)::int FROM sends s
        JOIN channels c ON c.id = s.channel_id
        WHERE (c.discovered_via LIKE 'sonar:agency:%' OR c.discovered_via LIKE 'agency:%' OR c.discovered_via LIKE 'legacy:agencies%')
        AND s.status = 'sent' AND s.sent_at > NOW() - INTERVAL '7 days') AS sent_7d
  `);
  const row = (result.rows ?? result)[0];

  const byCountryResult = await db.execute<{
    country: string;
    queued: number;
    sent: number;
  } & Record<string, unknown>>(sql`
    SELECT
      COALESCE(country, '?') AS country,
      COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent
    FROM channels
    WHERE discovered_via LIKE 'sonar:agency:%' OR discovered_via LIKE 'agency:%' OR discovered_via LIKE 'legacy:agencies%'
    GROUP BY country
    ORDER BY (COUNT(*) FILTER (WHERE status = 'queued')) DESC, sent DESC
    LIMIT 10
  `);

  // Extract category from the discoveredVia string: "sonar:agency:{country}:{category}"
  const byCategoryResult = await db.execute<{
    category: string;
    queued: number;
    sent: number;
  } & Record<string, unknown>>(sql`
    SELECT
      SPLIT_PART(discovered_via, ':', 4) AS category,
      COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent
    FROM channels
    WHERE discovered_via LIKE 'sonar:agency:%'
    GROUP BY category
    ORDER BY (COUNT(*) FILTER (WHERE status = 'queued')) DESC, sent DESC
  `);

  return {
    totalQueued: row.total_queued,
    totalSent: row.total_sent,
    totalEverDiscovered: row.total_ever,
    newLast7d: row.new_7d,
    sentLast7d: row.sent_7d,
    byCountry: (byCountryResult.rows ?? byCountryResult).map((r) => ({
      country: r.country,
      queued: r.queued,
      sent: r.sent,
    })),
    byCategory: (byCategoryResult.rows ?? byCategoryResult).map((r) => ({
      category: r.category || "?",
      queued: r.queued,
      sent: r.sent,
    })),
  };
}

// Get the most recent agency-discovery cron run from discovery_runs, with
// timing info. Used to render "Última corrida" in the dashboard.
export async function getLastAgencyRun(): Promise<DiscoveryRunRow | null> {
  const result = await db.execute<DiscoveryRunRow & Record<string, unknown>>(sql`
    SELECT
      id, source, started_at, ended_at,
      CASE
        WHEN ended_at IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (ended_at - started_at))::numeric, 1)::float
        ELSE NULL
      END AS duration_s,
      quota_used, channels_seen, channels_new, qualified_new,
      0::float AS freshness_pct,
      0::float AS qualified_pct,
      error
    FROM discovery_runs
    WHERE source LIKE '%agency%'
    ORDER BY id DESC
    LIMIT 1
  `);
  const rows = result.rows ?? result;
  return rows.length > 0 ? rows[0] : null;
}

// ─── Cron heartbeat ──────────────────────────────────────────────────────

export interface CronHeartbeat {
  lastSendAt: string | null;
  lastSendCount24h: number;
  lastDiscoveryAt: string | null;
  lastDiscoveryRunId: number | null;
  totalChannelsKnown: number;
}

export async function getCronHeartbeat(): Promise<CronHeartbeat> {
  type Row = {
    last_send_at: string | null;
    last_send_count_24h: number;
    last_discovery_at: string | null;
    last_discovery_run_id: number | null;
    total_channels_known: number;
  } & Record<string, unknown>;
  const result = await db.execute<Row>(sql`
    SELECT
      (SELECT MAX(sent_at) FROM sends WHERE status = 'sent') AS last_send_at,
      (SELECT COUNT(*)::int FROM sends WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '24 hours') AS last_send_count_24h,
      (SELECT MAX(started_at) FROM discovery_runs) AS last_discovery_at,
      (SELECT MAX(id) FROM discovery_runs) AS last_discovery_run_id,
      (SELECT COUNT(*)::int FROM channels) AS total_channels_known
  `);
  const row = (result.rows ?? result)[0];
  return {
    lastSendAt: row.last_send_at,
    lastSendCount24h: row.last_send_count_24h,
    lastDiscoveryAt: row.last_discovery_at,
    lastDiscoveryRunId: row.last_discovery_run_id,
    totalChannelsKnown: row.total_channels_known,
  };
}
