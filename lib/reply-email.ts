// Send a reply to a lead via Resend, FROM the correct clipzi alias.
//
// Why Resend and not Gmail send: the original outreach went out from per-lead
// aliases (g@clipzi.tech, g@clipzi.net, ...), all Resend-verified. Sending the
// reply from an EXPLICIT From=alias structurally avoids the bug where Gmail's
// default identity (g@sausito.com) leaked into manual replies. We set threading
// headers so it lands in the lead's existing thread, and Reply-To back to the
// single inbox so future replies keep arriving in gonzaloorsi@gmail.com.
//
// Style rule: NO em-dashes (—) or en-dashes (–) in any reply body.

import { Resend } from "resend";

let _client: Resend | null = null;
function client(): Resend {
  if (!_client) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
    _client = new Resend(process.env.RESEND_API_KEY);
  }
  return _client;
}

// Where future lead replies should land. The whole pipeline assumes one inbox.
const REPLY_TO = process.env.LEAD_REPLY_INBOX || "gonzaloorsi@gmail.com";

export interface SendReplyParams {
  fromAlias: string; // e.g. "g@clipzi.tech"
  fromName: string; // e.g. "Gonzalo Orsi"
  to: string; // the lead's email
  subject: string; // original subject; "Re: " is prefixed if missing
  bodyText: string; // plain-text reply (Gonza's voice)
  inReplyToMessageId: string | null; // RFC822 Message-ID of the lead's last msg
  references?: string | null; // existing References chain, if any
}

export interface SendReplyResult {
  ok: boolean;
  espMessageId?: string; // Resend's internal id
  rfc822MessageId?: string; // the RFC822 Message-ID we set (reused for the Sent mirror)
  error?: string;
}

/** Generate an RFC822 Message-ID anchored to the alias domain. */
function genMessageId(fromAlias: string): string {
  const domain = fromAlias.split("@")[1] || "clipzi.app";
  const rand = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `<${rand}@${domain}>`;
}

/** Subject (and other header) values with non-ASCII need MIME encoded-word. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function reSubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export async function sendReply(params: SendReplyParams): Promise<SendReplyResult> {
  const subject = reSubject(params.subject);
  const rfc822MessageId = genMessageId(params.fromAlias);
  const headers: Record<string, string> = { "Message-ID": rfc822MessageId };
  if (params.inReplyToMessageId) {
    headers["In-Reply-To"] = params.inReplyToMessageId;
    // Append to (or start) the References chain so all clients thread correctly.
    headers["References"] = [params.references, params.inReplyToMessageId]
      .filter(Boolean)
      .join(" ");
  }
  try {
    const { data, error } = await client().emails.send({
      from: `${params.fromName} <${params.fromAlias}>`,
      to: [params.to],
      replyTo: REPLY_TO,
      subject,
      text: params.bodyText,
      headers,
    });
    if (error) return { ok: false, error: error.message ?? JSON.stringify(error) };
    return { ok: true, espMessageId: data?.id, rfc822MessageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Build the plain-text RFC822 MIME of the reply, identical to what Resend sent,
 * so we can mirror a copy into Gmail's Sent folder (lib/gmail.ts insertToSent).
 * Reuses the same Message-ID so the Sent copy and the delivered mail match.
 */
export function buildRfc822(params: SendReplyParams, rfc822MessageId: string): string {
  const refs = [params.references, params.inReplyToMessageId].filter(Boolean).join(" ");
  const headers = [
    `From: ${params.fromName} <${params.fromAlias}>`,
    `To: ${params.to}`,
    `Reply-To: ${REPLY_TO}`,
    `Subject: ${encodeHeader(reSubject(params.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${rfc822MessageId}`,
    params.inReplyToMessageId ? `In-Reply-To: ${params.inReplyToMessageId}` : null,
    refs ? `References: ${refs}` : null,
    "MIME-Version: 1.0",
    `Content-Type: text/plain; charset="UTF-8"`,
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);
  // RFC822 wants CRLF line endings in the body.
  const body = params.bodyText.replace(/\r?\n/g, "\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + body + "\r\n";
}
