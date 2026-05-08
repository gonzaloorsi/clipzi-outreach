// Bouncer email-verification wrapper. Call before insert to skip undeliverable
// addresses entirely (status='low_quality' so they never enter the send queue).
//
// Strategy:
//   - Conservative threshold: only `deliverable` is treated as safe.
//     Everything else (risky / undeliverable / unknown) is treated as unsafe.
//   - Cache results in `email_validations` table for 90 days. Same email used
//     by multiple channels validates once.
//   - On API failure (network / rate-limit / timeout): return `unknown` and
//     DO NOT cache, so it can be retried on the next discovery run.
//
// Docs: https://docs.usebouncer.com/

import { sql } from "drizzle-orm";
import { db } from "../db/client";

const API_URL = "https://api.usebouncer.com/v1.1/email/verify";
const CACHE_TTL_DAYS = 90;
const REQUEST_TIMEOUT_MS = 15_000;

export type BouncerStatus = "deliverable" | "risky" | "undeliverable" | "unknown";

export interface BouncerResult {
  email: string;
  status: BouncerStatus;
  reason?: string;
  score?: number;
  // Surface key flags so the gate can be granular without re-parsing raw.
  disposable?: boolean; // disposable / temporary email domain
  fullMailbox?: boolean; // mailbox is full
  roleBased?: boolean; // info@, support@, admin@, etc.
  freeProvider?: boolean; // gmail.com, yahoo.com, etc. (most creators)
  fromCache: boolean;
  raw?: unknown;
}

/**
 * Verify a single email. Hits the local cache first; falls back to Bouncer API
 * on cache miss. Returns `unknown` (uncached) on any error so the caller can
 * apply the conservative-skip policy.
 */
export async function verifyEmail(email: string): Promise<BouncerResult> {
  const normalized = email.trim().toLowerCase();

  // Cache lookup
  const cached = await db.execute<{
    email: string;
    status: BouncerStatus;
    reason: string | null;
    score: number | null;
    raw: { domain?: { disposable?: string; free?: string }; account?: { role?: string; fullMailbox?: string } } | null;
  }>(sql`
    SELECT email, status, reason, score, raw
    FROM email_validations
    WHERE email = ${normalized}
      AND verified_at > NOW() - INTERVAL '${sql.raw(String(CACHE_TTL_DAYS))} days'
    LIMIT 1
  `);
  const cachedRow = (cached.rows ?? cached)[0];
  if (cachedRow) {
    const raw = cachedRow.raw ?? null;
    return {
      email: normalized,
      status: cachedRow.status,
      reason: cachedRow.reason ?? undefined,
      score: cachedRow.score ?? undefined,
      disposable: raw?.domain?.disposable === "yes",
      fullMailbox: raw?.account?.fullMailbox === "yes",
      roleBased: raw?.account?.role === "yes",
      freeProvider: raw?.domain?.free === "yes",
      fromCache: true,
    };
  }

  // No key → can't validate, treat as unknown without caching (so we retry later)
  if (!process.env.BOUNCER_API_KEY) {
    return { email: normalized, status: "unknown", reason: "no_api_key", fromCache: false };
  }

  // API call (Bouncer single-verify is GET with query param)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${API_URL}?email=${encodeURIComponent(normalized)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": process.env.BOUNCER_API_KEY,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // Quota / rate limit / server error → uncached unknown, retry next time
      return {
        email: normalized,
        status: "unknown",
        reason: `api_${res.status}`,
        fromCache: false,
      };
    }

    const json = (await res.json()) as {
      email?: string;
      status?: BouncerStatus;
      reason?: string;
      score?: number;
      domain?: { acceptAll?: string; disposable?: string; free?: string };
      account?: { role?: string; disabled?: string; fullMailbox?: string };
    };

    const status: BouncerStatus = json.status ?? "unknown";
    const reason = json.reason ?? undefined;
    const score = typeof json.score === "number" ? json.score : undefined;
    const disposable = json.domain?.disposable === "yes";
    const fullMailbox = json.account?.fullMailbox === "yes";
    const roleBased = json.account?.role === "yes";
    const freeProvider = json.domain?.free === "yes";

    // Cache the result. Use upsert so re-validation overwrites.
    await db.execute(sql`
      INSERT INTO email_validations (email, status, reason, score, raw, verified_at)
      VALUES (${normalized}, ${status}, ${reason ?? null}, ${score ?? null}, ${JSON.stringify(json)}::jsonb, NOW())
      ON CONFLICT (email) DO UPDATE SET
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        score = EXCLUDED.score,
        raw = EXCLUDED.raw,
        verified_at = NOW()
    `);

    return {
      email: normalized,
      status,
      reason,
      score,
      disposable,
      fullMailbox,
      roleBased,
      freeProvider,
      fromCache: false,
      raw: json,
    };
  } catch (e: unknown) {
    clearTimeout(timer);
    const reason = e instanceof Error && e.name === "AbortError" ? "timeout" : "api_error";
    return { email: normalized, status: "unknown", reason, fromCache: false };
  }
}

/**
 * Decision gate for "should we send to this email?".
 *
 * Threshold philosophy:
 *   - `deliverable` → ✓ always
 *   - `risky` → mostly ✓, but skip the truly risky sub-cases:
 *       - disposable (mailinator, etc.) → skip
 *       - full mailbox → skip (will bounce)
 *     Other risky reasons (low_quality on free provider — Gmail/Yahoo) are
 *     accepted because most creators use free providers.
 *   - `undeliverable` → ✗ (invalid syntax / dead domain / mailbox doesn't exist)
 *   - `unknown` → ✗ (couldn't verify; safer to skip and retry later)
 *
 * EXCEPTION — fail-open when Bouncer isn't actually consulted:
 *   If the API key isn't configured (BOUNCER_API_KEY missing), we want the
 *   pipeline to behave AS IF Bouncer didn't exist (preserve pre-integration
 *   behavior). Otherwise deploying the code without the env var would silently
 *   demote every new email to low_quality and freeze the discovery → send flow.
 */
export function isSafeToSend(result: BouncerResult): boolean {
  if (result.reason === "no_api_key") return true; // fail-open
  if (result.status === "deliverable") return true;
  if (result.status === "risky") {
    if (result.disposable) return false;
    if (result.fullMailbox) return false;
    return true;
  }
  return false; // undeliverable | unknown (timeouts, dns errors, etc. stay conservative)
}

/**
 * Verify multiple emails in parallel (capped concurrency to avoid blasting the
 * API or the local DB). Returns one result per input. Order preserved.
 */
export async function verifyEmailsBatch(
  emails: string[],
  concurrency = 8,
): Promise<BouncerResult[]> {
  const results: BouncerResult[] = new Array(emails.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= emails.length) return;
      results[idx] = await verifyEmail(emails[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, emails.length) }, worker),
  );
  return results;
}
