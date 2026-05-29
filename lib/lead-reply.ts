// Lead-reply orchestrator.
//
// Finds Clipzi outreach threads in gonzaloorsi@gmail.com whose newest message is
// an unanswered lead reply, decides how to respond with the LLM (Gonza's voice),
// and either sends via Resend (from the correct alias, minting a Stripe trial
// code when needed) or flags for human review. Idempotent via processed_threads.
//
// Detection (in order, cheapest first):
//   1. skip threads already handled (same last message id) -> DB
//   2. skip threads whose last message is outbound (already answered)
//   3. skip automated/system replies (no LLM call)
//   4. otherwise call the LLM and act on its decision

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { processedThreads } from "@/db/schema";
import {
  addThreadLabels,
  ensureLabel,
  getThread,
  header,
  insertToSent,
  plainTextBody,
  searchThreadIds,
  stripQuotedReply,
  type GmailMessage,
  type GmailThread,
} from "@/lib/gmail";
import { buildCode, createTrialPromotionCode } from "@/lib/stripe-codes";
import { buildRfc822, sendReply, type SendReplyParams } from "@/lib/reply-email";
import { SYSTEM_PROMPT, buildUserPrompt, type ThreadContext } from "@/lib/lead-reply-playbook";

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
// Exact slug can be confirmed in the Vercel AI Gateway model list; override via env.
const MODEL = process.env.LEAD_REPLY_MODEL || "anthropic/claude-sonnet-4.6";
const FROM_NAME = process.env.SENDER_NAME || "Gonzalo Orsi";
const OUTREACH_QUERY = 'subject:"x Clipzi"';
// Only auto-send in languages we can quality-check. Anything else (Arabic,
// Japanese, etc.) is held for manual review via Clipzi/Revisar.
const AUTO_SEND_LANGS = new Set(["es", "en", "pt", "fr", "de", "it"]);

const ALIAS_RE = /[a-z0-9._%+-]+@clipzi\.[a-z.]+/gi;
const OWN_FROM_RE = /@clipzi\.[a-z.]+|g@sausito\.com|g@babadesk\.com/i;

// ─── Decision shape returned by the LLM ──────────────────────────────────────

export type Action = "send" | "escalate" | "skip";

interface Decision {
  action: Action;
  language: string;
  needs_code: boolean;
  suggested_plan: string | null;
  reply_body: string;
  reason: string;
}

export interface ThreadOutcome {
  threadId: string;
  channelName: string;
  leadEmail: string;
  alias: string | null;
  action: Action | "answered" | "automated" | "already-done" | "error";
  reason: string;
  replyPreview?: string;
  code?: string;
  error?: string;
}

export interface RunSummary {
  scanned: number;
  candidates: number;
  outcomes: ThreadOutcome[];
  dryRun: boolean;
  model: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function channelFromSubject(subject: string | null): string {
  if (!subject) return "(unknown)";
  return subject
    .replace(/^(re|aw|fwd?|rv|sv|antw)\s*:\s*/gi, "")
    .replace(/\s*x\s*clipzi.*$/i, "")
    .trim() || "(unknown)";
}

/** Find the clipzi alias the outreach used for this thread. */
function findAlias(thread: GmailThread, lastInbound: GmailMessage): string | null {
  // Prefer the address the lead actually replied to.
  for (const h of ["To", "Delivered-To", "X-Original-To", "Cc"]) {
    const v = header(lastInbound, h);
    const m = v?.match(ALIAS_RE);
    if (m) return m[0].toLowerCase();
  }
  // Fall back to scanning every message's headers + body for a clipzi alias.
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

const AUTOMATED_FROM = /no-?reply|donotreply|postmaster|mailer-daemon|kundeservice|redaktion@|support@|@.*(zendesk|freshdesk|helpscout)/i;
const AUTOMATED_SUBJECT = /automatic reply|auto:|out of office|anfrage erhalten|deine email|\[support|\[ticket|\[rt\.|received:|automated response/i;
const AUTOMATED_BODY = /this is an automated|automated response|out of office|no longer active|do not reply to this|message queue|support team will/i;

function isAutomated(msg: GmailMessage): boolean {
  const from = header(msg, "From") ?? "";
  const subject = header(msg, "Subject") ?? "";
  if (AUTOMATED_FROM.test(from)) return true;
  if (AUTOMATED_SUBJECT.test(subject)) return true;
  if (AUTOMATED_BODY.test(plainTextBody(msg).slice(0, 600))) return true;
  return false;
}

function condenseThread(thread: GmailThread): string {
  const parts: string[] = [];
  for (const msg of thread.messages) {
    const who = isOutbound(msg) ? "GONZA" : "LEAD";
    const date = header(msg, "Date") ?? "";
    const body = stripQuotedReply(plainTextBody(msg)).slice(0, 1200);
    parts.push(`[${who}] ${date}\n${body}`);
  }
  return parts.join("\n\n---\n\n").slice(0, 6000);
}

async function callLLM(ctx: ThreadContext): Promise<Decision> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY not set");
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
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
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
    needs_code: Boolean(parsed.needs_code),
    suggested_plan: parsed.suggested_plan ?? null,
    reply_body: parsed.reply_body ?? "",
    reason: parsed.reason ?? "",
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────

export interface RunOptions {
  dryRun?: boolean;
  max?: number; // max threads to ACT on this run
  sinceDays?: number; // how far back to scan
  scanCap?: number; // max threads to fetch/inspect
  onlyThreadId?: string; // act on a single specific thread (manual one-off sends)
}

export async function runLeadReplies(opts: RunOptions = {}): Promise<RunSummary> {
  const dryRun = opts.dryRun ?? false;
  const max = opts.max ?? 25;
  const sinceDays = opts.sinceDays ?? 14;
  const scanCap = opts.scanCap ?? 120;

  const query = `${OUTREACH_QUERY} newer_than:${sinceDays}d`;
  const threadIds = opts.onlyThreadId
    ? [opts.onlyThreadId]
    : await searchThreadIds(query, scanCap);

  // Load handled state once.
  const handled = new Map<string, string>(); // threadId -> lastMessageId handled
  for (const row of await db
    .select({ threadId: processedThreads.threadId, lastMessageId: processedThreads.lastMessageId })
    .from(processedThreads)) {
    handled.set(row.threadId, row.lastMessageId ?? "");
  }

  const outcomes: ThreadOutcome[] = [];
  let acted = 0;

  // Labels are created lazily and only when we actually need them (not in dry-run).
  let respondidoId: string | null = null;
  let revisarId: string | null = null;
  const labelRespondido = async () =>
    (respondidoId ??= await ensureLabel("Clipzi/Respondido"));
  const labelRevisar = async () => (revisarId ??= await ensureLabel("Clipzi/Revisar"));

  for (const threadId of threadIds) {
    if (acted >= max) break;

    let thread: GmailThread;
    try {
      thread = await getThread(threadId);
    } catch (e) {
      outcomes.push({
        threadId,
        channelName: "(unknown)",
        leadEmail: "",
        alias: null,
        action: "error",
        reason: "getThread failed",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // Ignore trashed/draft messages: threads.get returns them, and a stray
    // trashed message would otherwise be read as the thread's "last" message.
    const messages = (thread.messages ?? []).filter(
      (m) => !(m.labelIds ?? []).includes("TRASH") && !(m.labelIds ?? []).includes("DRAFT"),
    );
    if (messages.length === 0) continue;
    const last = messages[messages.length - 1];
    const subject = header(messages[0], "Subject");
    const channelName = channelFromSubject(subject);
    const { name: leadName, email: leadEmail } = parseFrom(header(last, "From"));

    // 2. already answered (last message is from us)
    if (isOutbound(last)) {
      continue;
    }
    // 1. already handled this exact message
    if (handled.get(threadId) === last.id) {
      continue;
    }

    const baseOutcome = { threadId, channelName, leadEmail, alias: null as string | null };

    // 3. automated / system reply -> skip without spending an LLM call
    if (isAutomated(last)) {
      outcomes.push({ ...baseOutcome, action: "automated", reason: "automated/system reply" });
      if (!dryRun) {
        await recordProcessed(threadId, leadEmail, channelName, null, "automated", null, last.id, "automated");
      }
      continue;
    }

    const alias = findAlias(thread, last);
    const ctx: ThreadContext = {
      leadName,
      leadEmail,
      channelName,
      fromAlias: alias ?? "(unknown)",
      latestMessage: stripQuotedReply(plainTextBody(last)),
      fullThread: condenseThread(thread),
    };

    let decision: Decision;
    try {
      decision = await callLLM(ctx);
    } catch (e) {
      outcomes.push({
        ...baseOutcome,
        alias,
        action: "error",
        reason: "LLM call failed",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    acted += 1;

    // Hold for manual review if: no alias (can't choose From), or the reply is
    // in a language we don't auto-send (can't quality-check it).
    const forceReview = !alias && decision.action === "send";
    const langHold =
      decision.action === "send" &&
      !AUTO_SEND_LANGS.has((decision.language || "").toLowerCase().slice(0, 2));
    const action: Action = forceReview || langHold ? "escalate" : decision.action;
    const escalateReason = forceReview
      ? "could not determine reply alias"
      : langHold
        ? `language '${decision.language}' held for manual review`
        : decision.reason;

    if (action === "skip") {
      outcomes.push({ ...baseOutcome, alias, action: "skip", reason: decision.reason });
      if (!dryRun) {
        await recordProcessed(threadId, leadEmail, channelName, alias, "skip", null, last.id, decision.reason);
      }
      continue;
    }

    if (action === "escalate") {
      outcomes.push({
        ...baseOutcome,
        alias,
        action: "escalate",
        reason: escalateReason,
        replyPreview: decision.reply_body.slice(0, 400),
      });
      if (!dryRun) {
        await addThreadLabels(threadId, [await labelRevisar()]);
        await recordProcessed(threadId, leadEmail, channelName, alias, "escalate", null, last.id, escalateReason, decision.reply_body || null);
      }
      continue;
    }

    // action === "send"
    let body = decision.reply_body;
    let code: string | undefined;

    if (decision.needs_code) {
      if (dryRun) {
        code = "[DRY-RUN-CODE]";
        body = body.replace(/\[\[CODE\]\]/g, code);
      } else {
        const suffix = threadId.slice(-4).toUpperCase();
        const minted = await createTrialPromotionCode(buildCode(leadName, leadEmail, suffix));
        if (!minted.ok || !minted.code) {
          // Minting failed -> do not send half a reply; flag for review.
          outcomes.push({
            ...baseOutcome,
            alias,
            action: "escalate",
            reason: `code mint failed: ${minted.error}`,
            replyPreview: body.slice(0, 400),
          });
          await addThreadLabels(threadId, [await labelRevisar()]);
          await recordProcessed(threadId, leadEmail, channelName, alias, "escalate", null, last.id, `mint failed: ${minted.error}`, body || null);
          continue;
        }
        code = minted.code;
        body = body.replace(/\[\[CODE\]\]/g, code);
      }
    }

    // Safety: never send an empty/near-empty reply. Flag for review instead.
    if (!body || body.trim().length < 5) {
      outcomes.push({
        ...baseOutcome,
        alias,
        action: "escalate",
        reason: "empty reply body",
        replyPreview: body,
      });
      if (!dryRun) {
        await addThreadLabels(threadId, [await labelRevisar()]);
        await recordProcessed(threadId, leadEmail, channelName, alias, "escalate", null, last.id, "empty reply body", body || null);
      }
      continue;
    }

    if (dryRun) {
      outcomes.push({
        ...baseOutcome,
        alias,
        action: "send",
        reason: decision.reason,
        replyPreview: body,
        code,
      });
      continue;
    }

    const replyParams: SendReplyParams = {
      fromAlias: alias!,
      fromName: FROM_NAME,
      to: leadEmail,
      subject: subject ?? `${channelName} x Clipzi`,
      bodyText: body,
      inReplyToMessageId: header(last, "Message-ID") ?? header(last, "Message-Id"),
      references: header(last, "References"),
    };
    const sent = await sendReply(replyParams);

    if (!sent.ok) {
      outcomes.push({
        ...baseOutcome,
        alias,
        action: "error",
        reason: "send failed",
        error: sent.error,
        replyPreview: body.slice(0, 200),
      });
      continue;
    }

    // Mirror a copy into Gmail's Sent folder for review. Best-effort: the mail
    // already went out via Resend, so a mirror failure must not fail the run.
    try {
      await insertToSent(buildRfc822(replyParams, sent.rfc822MessageId!), threadId);
    } catch (e) {
      console.error("[lead-replies] Sent mirror failed for", threadId, e);
    }

    await addThreadLabels(threadId, [await labelRespondido()]);
    await recordProcessed(threadId, leadEmail, channelName, alias, "sent", code ?? null, last.id, decision.reason, body);
    outcomes.push({
      ...baseOutcome,
      alias,
      action: "send",
      reason: decision.reason,
      replyPreview: body,
      code,
    });
  }

  return {
    scanned: threadIds.length,
    candidates: outcomes.length,
    outcomes,
    dryRun,
    model: MODEL,
  };
}

async function recordProcessed(
  threadId: string,
  leadEmail: string,
  channelName: string,
  alias: string | null,
  action: string,
  code: string | null,
  lastMessageId: string,
  reason: string,
  replyBody: string | null = null,
): Promise<void> {
  await db
    .insert(processedThreads)
    .values({ threadId, leadEmail, channelName, alias, action, code, lastMessageId, reason, replyBody })
    .onConflictDoUpdate({
      target: processedThreads.threadId,
      set: { action, code, lastMessageId, reason, alias, replyBody, updatedAt: new Date() },
    });
}
