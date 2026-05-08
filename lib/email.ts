// Email sending — routes to the right per-language template based on channel
// country/language AND whether it's a creator or an agency (decided by
// discoveredVia prefix). Then sends via Resend.
//
// Style rule reminder: NO em-dashes (—) or en-dashes (–) in any template.
// See lib/templates/types.ts for the full contract.

import { Resend } from "resend";
import { pickTemplateFromDb } from "./templates";
import type { SupportedLanguage, TemplateKind } from "./templates";

let _client: Resend | null = null;
function client(): Resend {
  if (!_client) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set");
    }
    _client = new Resend(process.env.RESEND_API_KEY);
  }
  return _client;
}

export interface SendEmailParams {
  to: string;
  channelName: string;
  fromEmail: string;
  fromName: string;
  // Channel metadata for language detection + kind routing
  country: string | null;
  language: string | null;
  discoveredVia?: string | null;
  // Diagnostic flags (used by /api/debug/send-test only). Production cron
  // never sets these — they exist to test deliverability theories.
  textOnly?: boolean;       // strip HTML, send plain-text only
  lowercaseSubject?: boolean; // lowercase the subject before sending
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  language: SupportedLanguage; // which template was used (for sends.language col)
  kind: TemplateKind; // creator | agency | standup-individual | standup-org
  isAgency: boolean; // legacy convenience: kind === "agency"
}

export async function buildEmail(params: SendEmailParams): Promise<{
  subject: string;
  html: string;
  language: SupportedLanguage;
  kind: TemplateKind;
  isAgency: boolean;
}> {
  const { builder, language, kind, isAgency } = await pickTemplateFromDb({
    country: params.country,
    language: params.language,
    discoveredVia: params.discoveredVia ?? null,
  });
  const { subject, html } = builder({
    channelName: params.channelName,
    fromName: params.fromName,
  });
  return { subject, html, language, kind, isAgency };
}

// Strip HTML to a reasonable plain-text version. Used only for the textOnly
// diagnostic flag — preserves paragraph breaks, drops tags, decodes common
// HTML entities. Not a full-featured HTML-to-text converter.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { subject: rawSubject, html, language, kind, isAgency } = await buildEmail(params);
  const subject = params.lowercaseSubject ? rawSubject.toLowerCase() : rawSubject;
  const from = `${params.fromName} <${params.fromEmail}>`;
  const to = [params.to];
  // Resend's CreateEmailOptions is a discriminated union — branch on which
  // body field we want. textOnly path skips HTML multipart entirely; common
  // spam-test recommendation for isolating content vs format-related triggers.
  try {
    const { data, error } = params.textOnly
      ? await client().emails.send({
          from,
          to,
          subject,
          text: htmlToPlainText(html),
        })
      : await client().emails.send({
          from,
          to,
          subject,
          html,
        });
    if (error) {
      return {
        ok: false,
        error: error.message ?? JSON.stringify(error),
        language,
        kind,
        isAgency,
      };
    }
    return { ok: true, messageId: data?.id, language, kind, isAgency };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      language,
      kind,
      isAgency,
    };
  }
}
