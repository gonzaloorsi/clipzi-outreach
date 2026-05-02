// Sender pool — reads configured inboxes from env, syncs to `senders` DB table,
// and picks the next available inbox for a send (round-robin by least-recent
// usage, capped per-inbox daily_limit).
//
// "Pilar 2 lite" version: every configured inbox starts in state='active'.
// No warm-up state machine, no automatic pausing on bounce/complaint.
// Pilar 2 proper adds those.

import { sql, eq } from "drizzle-orm";
import { db } from "../db/client";
import { senders } from "../db/schema";

export interface ConfiguredSender {
  email: string;
  dailyLimit: number;
}

export interface PickedSender {
  id: number;
  email: string;
  sent24h: number;
  dailyLimit: number;
}

/**
 * Read SENDER_EMAIL (legacy, no suffix) and SENDER_EMAIL_1..10 from env.
 * Numbered form is preferred (consistent with YOUTUBE_API_KEY_1..10).
 */
export function loadSenderEmails(): string[] {
  const candidates = [process.env.SENDER_EMAIL];
  for (let i = 1; i <= 10; i++) {
    candidates.push(process.env[`SENDER_EMAIL_${i}`]);
  }
  const present = candidates.filter((e): e is string => Boolean(e?.trim())).map((e) => e.trim().toLowerCase());
  return [...new Set(present)];
}

/**
 * Ensure each configured inbox has a row in the senders table.
 * Idempotent: ON CONFLICT DO NOTHING. New inboxes get state='active'
 * with the configured daily_limit.
 */
export async function syncSendersFromEnv(dailyLimit: number): Promise<{
  configured: number;
  inserted: number;
}> {
  const emails = loadSenderEmails();
  if (emails.length === 0) {
    return { configured: 0, inserted: 0 };
  }

  const rows = emails.map((email) => ({
    email,
    esp: "resend" as const,
    state: "active" as const, // lite version — no warm-up state machine yet
    dailyLimit,
  }));

  const inserted = await db
    .insert(senders)
    .values(rows)
    .onConflictDoNothing({ target: senders.email })
    .returning({ id: senders.id });

  return { configured: emails.length, inserted: inserted.length };
}

/**
 * Pick the best sender for the next email:
 *   - state = 'active'
 *   - email IS in the currently-configured set (in case env was changed)
 *   - sent in last 24h < daily_limit
 *   - tiebreak: least sent_24h, then least-recently-used
 *
 * Returns null if no sender has capacity.
 */
export async function pickSender(): Promise<PickedSender | null> {
  const configuredEmails = loadSenderEmails();
  if (configuredEmails.length === 0) return null;

  // Use sql.join to bind each email as its own parameter (works around
  // drizzle's serialization of JS arrays not casting to text[]).
  const emailList = sql.join(
    configuredEmails.map((e) => sql`${e}`),
    sql`, `,
  );

  const result = await db.execute<{
    id: number;
    email: string;
    sent_24h: number;
    daily_limit: number;
  }>(sql`
    WITH counts AS (
      SELECT s.id, s.email, s.daily_limit, s.last_used_at,
             COALESCE((
               SELECT COUNT(*)::int
               FROM sends
               WHERE sender_id = s.id
                 AND status = 'sent'
                 AND sent_at > NOW() - INTERVAL '24 hours'
             ), 0) AS sent_24h
      FROM senders s
      WHERE s.state = 'active'
        AND s.email IN (${emailList})
    )
    SELECT id, email, sent_24h, daily_limit
    FROM counts
    WHERE sent_24h < daily_limit
    ORDER BY sent_24h ASC, last_used_at ASC NULLS FIRST
    LIMIT 1
  `);

  const row = (result.rows ?? result)[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    sent24h: row.sent_24h,
    dailyLimit: row.daily_limit,
  };
}

/**
 * Mark a sender as just-used. Updates last_used_at and increments sent_total.
 * The "sent in 24h" check derives from sends table directly — this is just
 * for tiebreaking + audit.
 */
export async function recordSenderUsed(senderId: number): Promise<void> {
  await db
    .update(senders)
    .set({
      lastUsedAt: new Date(),
      sentTotal: sql`${senders.sentTotal} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(senders.id, senderId));
}

/**
 * Get total daily capacity across all active+configured senders.
 * Used to compute "max per cron tick" given an hourly cadence.
 */
export async function getTotalDailyCapacity(): Promise<number> {
  const configuredEmails = loadSenderEmails();
  if (configuredEmails.length === 0) return 0;

  const emailList = sql.join(
    configuredEmails.map((e) => sql`${e}`),
    sql`, `,
  );

  const result = await db.execute<{ total: number }>(sql`
    SELECT COALESCE(SUM(daily_limit), 0)::int AS total
    FROM senders
    WHERE state = 'active' AND email IN (${emailList})
  `);
  return (result.rows ?? result)[0]?.total ?? 0;
}
