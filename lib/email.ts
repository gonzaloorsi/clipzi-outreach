// Email sending — routes to the right per-language template based on channel
// country/language, then sends via Resend.
//
// Style rule reminder: NO em-dashes (—) or en-dashes (–) in any template.
// See lib/templates/types.ts for the full contract.

import { Resend } from "resend";
import { detectLanguage, getTemplate } from "./templates";
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
  // Channel metadata for language detection
  country: string | null;
  language: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  language: SupportedLanguage; // which template was used (for sends.language col)
}

export function buildEmail(params: SendEmailParams): {
  subject: string;
  html: string;
  language: SupportedLanguage;
} {
  const language = detectLanguage(params.country, params.language);
  const tpl = getTemplate(language);
  const { subject, html } = tpl({
    channelName: params.channelName,
    fromName: params.fromName,
  });
  return { subject, html, language };
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { subject, html, language } = buildEmail(params);
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
      };
    }
    return { ok: true, messageId: data?.id, language };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      language,
    };
  }
}
