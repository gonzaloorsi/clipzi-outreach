// Welcome-reply orchestrator.
//
// Answers replies to the 5-minutes-after-signup welcome email (subject "Clipzi",
// so replies are "Re: Clipzi"). These are PRODUCT USERS, not cold leads, so the
// job is onboarding + support + feedback, NOT selling. Mirrors lib/lead-reply.ts
// (Gmail read -> LLM decision in Gonza's voice -> Resend send / draft / escalate,
// idempotent via processed_threads) but with the welcome playbook and:
//   - NO trial/discount code minting (any discount request -> escalate).
//   - Híbrido: auto-send the easy categories, escalate the sensitive ones.
//   - Only acts on threads that actually contain the welcome email (safety guard),
//     so it never collides with the cold-outreach agent's "x Clipzi" threads.

import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { processedThreads } from "@/db/schema";
import {
  addThreadLabels,
  createDraftReply,
  ensureLabel,
  getThread,
  header,
  insertToSent,
  plainTextBody,
  removeThreadLabels,
  searchThreadIds,
  searchThreadIdsByLabel,
  stripQuotedReply,
  type GmailMessage,
  type GmailThread,
} from "@/lib/gmail";
import { buildRfc822, sendReply, type SendReplyParams } from "@/lib/reply-email";
import {
  WELCOME_SYSTEM_PROMPT,
  buildWelcomeUserPrompt,
  type WelcomeThreadContext,
} from "@/lib/welcome-reply-playbook";

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL =
  process.env.WELCOME_REPLY_MODEL ||
  process.env.LEAD_REPLY_MODEL ||
  "anthropic/claude-sonnet-4.6";
const FROM_NAME = process.env.SENDER_NAME || "Gonzalo Orsi";

// The welcome email subject is exactly "Clipzi"; exclude the cold-outreach
// "x Clipzi" subjects so the two agents never touch the same threads.
const WELCOME_QUERY = 'subject:Clipzi -subject:"x Clipzi"';
// Fallback From address if we can't detect which alias the user replied to.
// Recent welcome replies are handled from g@clipzi.app.
const WELCOME_FROM = process.env.WELCOME_FROM_EMAIL || "g@clipzi.app";

// Only auto-send in languages we can quality-check. Anything else is held for
// manual review via Clipzi/Revisar.
const AUTO_SEND_LANGS = new Set(["es", "en", "pt", "fr", "de", "it"]);

// Reuse the same Gmail label palette as the outreach agent (same semantics:
// Respondido = answered, Revisar = needs human, etc.). Threads are disjoint by
// subject, so sharing labels keeps the inbox tidy without cross-talk.
const LABEL_COLORS: Record<string, { backgroundColor: string; textColor: string }> = {
  "Clipzi/Respondido": { backgroundColor: "#16a766", textColor: "#ffffff" }, // green
  "Clipzi/Revisar": { backgroundColor: "#fb4c2f", textColor: "#ffffff" }, // red
  "Clipzi/Sin-respuesta": { backgroundColor: "#999999", textColor: "#ffffff" }, // gray
  "Clipzi/Automatico": { backgroundColor: "#a4c2f4", textColor: "#000000" }, // light blue
  "Clipzi/Borrador": { backgroundColor: "#ffad47", textColor: "#ffffff" }, // amber
  "Clipzi/No-responder": { backgroundColor: "#000000", textColor: "#ffffff" }, // black (hands-off)
};

// Match any of our own sender domains so we can tell outbound from inbound. The
// welcome email goes out from team@clipzi.dev; replies are handled from clipzi
// aliases. A user whose own domain contains "clipzi" is effectively impossible.
const ALIAS_RE = /[a-z0-9._%+-]+@[a-z0-9-]*clipzi[a-z0-9-]*\.[a-z.]+/gi;
const OWN_FROM_RE = /@[a-z0-9-]*clipzi[a-z0-9-]*\.[a-z.]+|g@sausito\.com|g@babadesk\.com/i;

// Phrases unique to the welcome email — used to confirm a thread really is a
// welcome thread before we act on it.
const WELCOME_MARKER_RE = /fundador de Clipzi|founder of Clipzi|funcion[oó] todo o te trabaste|did everything work or did you get stuck/i;

export type Action = "send" | "escalate" | "skip";

interface Decision {
  action: Action;
  language: string;
  category: string;
  reply_body: string;
  reason: string;
}

export interface ThreadOutcome {
  threadId: string;
  userName: string | null;
  userEmail: string;
  alias: string | null;
  action: Action | "automated" | "error" | "draft" | "not-welcome";
  category?: string;
  reason: string;
  replyPreview?: string;
  error?: string;
}

export interface RunSummary {
  scanned: number;
  candidates: number;
  outcomes: ThreadOutcome[];
  dryRun: boolean;
  model: string;
}

// ─── Helpers (mirrors of lib/lead-reply.ts internals) ────────────────────────

function isOutbound(msg: GmailMessage): boolean {
  if (msg.labelIds?.includes("SENT")) return true;
  const from = header(msg, "From") ?? "";
  return OWN_FROM_RE.test(from);
}

function parseFrom(value: string | null): { name: string | null; email: string } {
  if (!value) return { name: null, email: "" };
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: value.trim().toLowerCase() };
}

/**
 * Confirm the thread is a welcome thread before acting on it. The welcome email
 * is sent by the Clipzi product from team@clipzi.dev and is NOT stored in this
 * mailbox as its own message: it only appears QUOTED inside the user's reply.
 * So we look for the welcome marker anywhere in any message's full body (quotes
 * included), or a team@clipzi.dev sender if it ever is present. The marker copy
 * is unique to the welcome email, and "x Clipzi" outreach is already excluded by
 * the search query, so this won't false-positive on cold-outreach threads.
 */
function isWelcomeThread(thread: GmailThread): boolean {
  for (const msg of thread.messages ?? []) {
    const from = header(msg, "From") ?? "";
    if (/team@clipzi\.dev/i.test(from)) return true;
    if (WELCOME_MARKER_RE.test(plainTextBody(msg).slice(0, 4000))) return true;
  }
  return false;
}

/** Find the clipzi alias the user replied to (so we answer from the same one). */
function findAlias(thread: GmailThread, lastInbound: GmailMessage): string | null {
  for (const h of ["To", "Delivered-To", "X-Original-To", "Cc"]) {
    const v = header(lastInbound, h);
    const m = v?.match(ALIAS_RE);
    if (m) return m[0].toLowerCase();
  }
  for (const msg of thread.messages) {
    for (const h of ["From", "To", "Delivered-To", "Cc"]) {
      const m = header(msg, h)?.match(ALIAS_RE);
      if (m) return m[0].toLowerCase();
    }
    const bodyMatch = plainTextBody(msg).match(ALIAS_RE);
    if (bodyMatch) return bodyMatch[0].toLowerCase();
  }
  return null;
}

const AUTOMATED_FROM = /no-?reply|donotreply|postmaster|mailer-daemon|redaktion@|@.*(zendesk|freshdesk|helpscout)/i;
const AUTOMATED_SUBJECT = /automatic reply|auto:|out of office|deine email|\[support|\[ticket|\[rt\.|automated response/i;
const AUTOMATED_BODY = /this is an automated|automated response|out of office|no longer active|do not reply to this|message queue/i;

function isAutomated(msg: GmailMessage): boolean {
  const from = header(msg, "From") ?? "";
  const subject = header(msg, "Subject") ?? "";
  if (AUTOMATED_FROM.test(from)) return true;
  if (AUTOMATED_SUBJECT.test(subject)) return true;
  if (AUTOMATED_BODY.test(plainTextBody(msg).slice(0, 600))) return true;
  return false;
}

const SHARED_INBOX = (process.env.LEAD_REPLY_INBOX || "gonzaloorsi@gmail.com").toLowerCase();
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function ccRecipients(msg: GmailMessage, userEmail: string): string[] {
  const raw = `${header(msg, "To") ?? ""},${header(msg, "Cc") ?? ""}`;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of raw.match(EMAIL_RE) ?? []) {
    const a = m.toLowerCase();
    if (a === userEmail.toLowerCase() || a === SHARED_INBOX) continue;
    if (OWN_FROM_RE.test(a) || AUTOMATED_FROM.test(a)) continue;
    if (seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

function condenseThread(thread: GmailThread): string {
  const parts: string[] = [];
  for (const msg of thread.messages) {
    const who = isOutbound(msg) ? "GONZA" : "USER";
    const date = header(msg, "Date") ?? "";
    const body = stripQuotedReply(plainTextBody(msg)).slice(0, 1200);
    parts.push(`[${who}] ${date}\n${body}`);
  }
  return parts.join("\n\n---\n\n").slice(0, 6000);
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function callLLM(ctx: WelcomeThreadContext): Promise<Decision> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY not set");
  const content = await retry(async () => {
    const res = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        messages: [
          { role: "system", content: WELCOME_SYSTEM_PROMPT },
          { role: "user", content: buildWelcomeUserPrompt(ctx) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? "";
  });
  const raw = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: Partial<Decision>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`LLM did not return JSON: ${raw.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }
  return {
    action: (parsed.action as Action) ?? "escalate",
    language: parsed.language ?? "en",
    category: parsed.category ?? "other",
    reply_body: parsed.reply_body ?? "",
    reason: parsed.reason ?? "",
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────

export interface RunOptions {
  dryRun?: boolean;
  max?: number;
  sinceDays?: number;
  after?: string;
  scanCap?: number;
  onlyThreadId?: string;
}

export async function runWelcomeReplies(opts: RunOptions = {}): Promise<RunSummary> {
  const dryRun = opts.dryRun ?? false;
  const max = opts.max ?? 25;
  const sinceDays = opts.sinceDays ?? 14;
  const scanCap = opts.scanCap ?? 120;

  const window = opts.after ? `after:${opts.after.replace(/-/g, "/")}` : `newer_than:${sinceDays}d`;
  const query = `${WELCOME_QUERY} ${window}`;
  const threadIds = opts.onlyThreadId
    ? [opts.onlyThreadId]
    : await retry(() => searchThreadIds(query, scanCap));

  // Idempotency: load already-handled (thread -> last message id) once.
  const handled = new Map<string, string>();
  const handledRows = await retry(() =>
    db
      .select({ threadId: processedThreads.threadId, lastMessageId: processedThreads.lastMessageId })
      .from(processedThreads),
  );
  for (const row of handledRows) handled.set(row.threadId, row.lastMessageId ?? "");

  const outcomes: ThreadOutcome[] = [];
  let acted = 0;

  const ts = () => new Date().toISOString();
  const log = (m: string) => console.log(`[welcome-replies ${ts()}] ${m}`);
  log(`start dry=${dryRun} max=${max} query="${query}" scanned=${threadIds.length}`);

  const labelCache: Record<string, string> = {};
  const label = async (name: string) =>
    (labelCache[name] ??= await ensureLabel(name, LABEL_COLORS[name]));

  // Hands-off: threads Gonza tagged "Clipzi/No-responder" are left entirely to
  // him (shared with the outreach agent). Never read/answer/draft/escalate them.
  const manualSkip = new Set<string>();
  if (!opts.onlyThreadId) {
    const noResponderId = await label("Clipzi/No-responder");
    try {
      const skipIds = await retry(() => searchThreadIdsByLabel(noResponderId, 200));
      for (const id of skipIds) manualSkip.add(id);
      log(`hands-off (No-responder): ${skipIds.length}`);
    } catch (e) {
      log(`hands-off scan failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const threadId of threadIds) {
    if (acted >= max) break;
    if (manualSkip.has(threadId)) continue;

    let thread: GmailThread;
    try {
      thread = await getThread(threadId);
    } catch (e) {
      outcomes.push({
        threadId,
        userName: null,
        userEmail: "",
        alias: null,
        action: "error",
        reason: "getThread failed",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const messages = (thread.messages ?? []).filter(
      (m) => !(m.labelIds ?? []).includes("TRASH") && !(m.labelIds ?? []).includes("DRAFT"),
    );
    if (messages.length === 0) continue;

    // Safety guard: only touch real welcome threads. Anything else (e.g. an
    // unrelated thread that merely has "Clipzi" in the subject) is left alone.
    if (!isWelcomeThread(thread)) {
      outcomes.push({
        threadId,
        userName: null,
        userEmail: "",
        alias: null,
        action: "not-welcome",
        reason: "no welcome-email marker in thread",
      });
      continue;
    }

    const last = messages[messages.length - 1];
    const { name: userName, email: userEmail } = parseFrom(header(last, "From"));

    if (isOutbound(last)) continue; // already answered
    if (handled.get(threadId) === last.id) continue; // already handled this message

    const base = { threadId, userName, userEmail };

    if (isAutomated(last)) {
      outcomes.push({ ...base, alias: null, action: "automated", reason: "automated/system reply" });
      if (!dryRun) {
        await addThreadLabels(threadId, [await label("Clipzi/Automatico")]);
        await removeThreadLabels(threadId, ["INBOX"]);
        await recordProcessed(threadId, userEmail, userName, null, "automated", last.id, "automated");
      }
      continue;
    }

    const alias = findAlias(thread, last) ?? WELCOME_FROM;
    const ctx: WelcomeThreadContext = {
      userName,
      userEmail,
      fromAlias: alias,
      latestMessage: stripQuotedReply(plainTextBody(last)),
      fullThread: condenseThread(thread),
    };

    let decision: Decision;
    try {
      decision = await callLLM(ctx);
    } catch (e) {
      outcomes.push({
        ...base,
        alias,
        action: "error",
        reason: "LLM call failed",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    acted += 1;

    // Hold for manual review if the reply is in a language we don't auto-send.
    const langHold =
      decision.action === "send" &&
      !AUTO_SEND_LANGS.has((decision.language || "").toLowerCase().slice(0, 2));
    const action: Action = langHold ? "escalate" : decision.action;
    const reason = langHold ? `language '${decision.language}' held for manual review` : decision.reason;

    if (action === "skip") {
      outcomes.push({ ...base, alias, action: "skip", category: decision.category, reason: decision.reason });
      if (!dryRun) {
        await addThreadLabels(threadId, [await label("Clipzi/Sin-respuesta")]);
        await removeThreadLabels(threadId, ["INBOX"]);
        await recordProcessed(threadId, userEmail, userName, alias, "skip", last.id, decision.reason);
      }
      continue;
    }

    // Never send an empty/near-empty reply: hold for review instead.
    const body = (decision.reply_body || "").trim();
    if (action === "escalate" || body.length < 5) {
      const escReason = body.length < 5 && action !== "escalate" ? "empty reply body" : reason;
      outcomes.push({
        ...base,
        alias,
        action: "escalate",
        category: decision.category,
        reason: escReason,
        replyPreview: body.slice(0, 400),
      });
      if (!dryRun) {
        // Draft the best-guess reply into the thread so Gonza can edit + send,
        // and tag it for review.
        try {
          if (body.length >= 5) {
            const draftParams: SendReplyParams = {
              fromAlias: alias,
              fromName: FROM_NAME,
              to: userEmail,
              subject: header(messages[0], "Subject") ?? "Clipzi",
              bodyText: body,
              inReplyToMessageId: header(last, "Message-ID") ?? header(last, "Message-Id"),
              references: header(last, "References"),
            };
            await createDraftReply(buildRfc822(draftParams, `<draft-${threadId}@clipzi.app>`), threadId);
            await addThreadLabels(threadId, [await label("Clipzi/Borrador")]);
          }
        } catch (e) {
          log(`draft for escalate failed "${userEmail}": ${e instanceof Error ? e.message : String(e)}`);
        }
        await addThreadLabels(threadId, [await label("Clipzi/Revisar")]);
        await recordProcessed(threadId, userEmail, userName, alias, "escalate", last.id, escReason, body || null);
      }
      continue;
    }

    // action === "send"
    if (dryRun) {
      outcomes.push({ ...base, alias, action: "send", category: decision.category, reason: decision.reason, replyPreview: body });
      continue;
    }

    // Atomic claim to prevent double-sends from overlapping runs.
    if (!(await claimSend(threadId, last.id))) {
      log(`SKIP (race) <${userEmail}> already claimed`);
      continue;
    }

    const cc = ccRecipients(last, userEmail);
    const replyParams: SendReplyParams = {
      fromAlias: alias,
      fromName: FROM_NAME,
      to: userEmail,
      cc,
      subject: header(messages[0], "Subject") ?? "Clipzi",
      bodyText: body,
      inReplyToMessageId: header(last, "Message-ID") ?? header(last, "Message-Id"),
      references: header(last, "References"),
    };
    const sent = await sendReply(replyParams);

    if (!sent.ok) {
      await releaseThread(threadId);
      log(`SEND-FAILED <${userEmail}>: ${sent.error}`);
      outcomes.push({ ...base, alias, action: "error", reason: "send failed", error: sent.error, replyPreview: body.slice(0, 200) });
      continue;
    }

    try {
      await insertToSent(buildRfc822(replyParams, sent.rfc822MessageId!), threadId);
    } catch (e) {
      console.error("[welcome-replies] Sent mirror failed for", threadId, e);
    }

    log(`SENT <${userEmail}>${cc.length ? ` cc=[${cc.join(",")}]` : ""} from ${alias} cat=${decision.category}`);
    await addThreadLabels(threadId, [await label("Clipzi/Respondido")]);
    await removeThreadLabels(threadId, ["INBOX"]);
    await recordProcessed(threadId, userEmail, userName, alias, "sent", last.id, decision.reason, body);
    outcomes.push({ ...base, alias, action: "send", category: decision.category, reason: decision.reason, replyPreview: body });
  }

  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o.action] = (counts[o.action] ?? 0) + 1;
  log(`done: ${JSON.stringify(counts)}`);

  return { scanned: threadIds.length, candidates: outcomes.length, outcomes, dryRun, model: MODEL };
}

// ─── Idempotency (shares the processed_threads table with the outreach agent) ──

async function claimSend(threadId: string, lastMessageId: string): Promise<boolean> {
  const res = await db.execute(sql`
    INSERT INTO processed_threads (thread_id, last_message_id, action, created_at, updated_at)
    VALUES (${threadId}, ${lastMessageId}, 'sending', now(), now())
    ON CONFLICT (thread_id) DO UPDATE
      SET last_message_id = excluded.last_message_id, action = 'sending', updated_at = now()
      WHERE processed_threads.last_message_id IS DISTINCT FROM excluded.last_message_id
         OR (processed_threads.action = 'sending' AND processed_threads.updated_at < now() - interval '10 minutes')
    RETURNING thread_id
  `);
  return res.rows.length > 0;
}

async function releaseThread(threadId: string): Promise<void> {
  await db.delete(processedThreads).where(eq(processedThreads.threadId, threadId));
}

async function recordProcessed(
  threadId: string,
  userEmail: string,
  userName: string | null,
  alias: string | null,
  action: string,
  lastMessageId: string,
  reason: string,
  replyBody: string | null = null,
): Promise<void> {
  await db
    .insert(processedThreads)
    .values({ threadId, leadEmail: userEmail, channelName: userName, alias, action, lastMessageId, reason, replyBody })
    .onConflictDoUpdate({
      target: processedThreads.threadId,
      set: { action, lastMessageId, reason, alias, replyBody, updatedAt: new Date() },
    });
}
