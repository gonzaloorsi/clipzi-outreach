// Email sending — routes to the right per-language template based on channel
// country/language AND whether it's a creator or an agency (decided by
// discoveredVia prefix). Then sends via Resend.
//
// Style rule reminder: NO em-dashes (—) or en-dashes (–) in any template.
// See lib/templates/types.ts for the full contract.

import { Resend } from "resend";
import { pickTemplate } from "./templates";
import type { SupportedLanguage } from "./templates";

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
  // Channel metadata for language detection + creator-vs-agency routing
  country: string | null;
  language: string | null;
  discoveredVia?: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  language: SupportedLanguage; // which template was used (for sends.language col)
  isAgency: boolean; // true if B2B template was used
}

export function buildEmail(params: SendEmailParams): {
  subject: string;
  html: string;
  language: SupportedLanguage;
  isAgency: boolean;
} {
  const { builder, language, isAgency } = pickTemplate({
    country: params.country,
    language: params.language,
    discoveredVia: params.discoveredVia ?? null,
  });
  const { subject, html } = builder({
    channelName: params.channelName,
    fromName: params.fromName,
  });
  return { subject, html, language, isAgency };
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { subject, html, language, isAgency } = buildEmail(params);
  try {
    const { data, error } = await client().emails.send({
      from: `${params.fromName} <${params.fromEmail}>`,
      to: [params.to],
      subject,
      html,
    });
    if (error) {
      return {
        ok: false,
        error: error.message ?? JSON.stringify(error),
        language,
        isAgency,
      };
    }
    return { ok: true, messageId: data?.id, language, isAgency };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      language,
      isAgency,
    };
  }
}
