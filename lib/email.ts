// Email sending — routes to the right per-language template based on channel
// country/language AND whether it's a creator or an agency (decided by
// discoveredVia prefix). Then sends via Resend.
//
// Style rule reminder: NO em-dashes (—) or en-dashes (–) in any template.
// See lib/templates/types.ts for the full contract.

import { Resend } from "resend";
import { pickTemplateFromDb } from "./templates";
import type { SupportedLanguage, TemplateKind, HotInput } from "./templates";
import type { EmailAttachment } from "./frames";

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
  // Human-readable article reference for linkbuilding personalization
  article?: string | null;
  // Channel id: drives the v1/v2 A/B arm for YouTube creators.
  channelId?: string | null;
  // "Most replayed" hook for the youtube-hot templates (lib/heatmap.ts).
  hot?: HotInput | null;
  // Plain attachments (the v2 frame). The email stays text/plain + attachment,
  // never HTML: that combination landed in Updates on GMass, HTML landed in
  // Promotions.
  attachments?: EmailAttachment[];
  // RFC 5322 Message-ID to set on the outgoing mail ("<uuid@sender-domain>").
  // Stored on the sends row so follow-ups can thread via In-Reply-To.
  rfcMessageId?: string;
  // Diagnostic flags (used by /api/debug/send-test only). Production cron
  // never sets these — they exist to test deliverability theories.
  textOnly?: boolean;       // strip HTML, send plain-text only
  lowercaseSubject?: boolean; // lowercase the subject before sending
  noLink?: boolean;         // remove "(clipzi.app)" or bare URLs from the body
  linkDomain?: string;      // replace "clipzi.app" in body with this domain (e.g. "clipzi.net")
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
    id: params.channelId ?? null,
    country: params.country,
    language: params.language,
    discoveredVia: params.discoveredVia ?? null,
    hotSource: params.hot?.source ?? null,
  });
  const { subject, html } = builder({
    channelName: params.channelName,
    fromName: params.fromName,
    toEmail: params.to,
    country: params.country,
    ...(params.article ? { article: params.article } : {}),
    ...(params.hot ? { hot: params.hot } : {}),
  });
  return { subject, html, language, kind, isAgency };
}

// Strip HTML to a reasonable plain-text version. Used only for the textOnly
// diagnostic flag — preserves paragraph breaks, drops tags, decodes common
// HTML entities. Not a full-featured HTML-to-text converter.
export function htmlToPlainText(html: string): string {
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

// Remove parenthetical domain references and bare URLs. Used by noLink
// diagnostic to strip "(clipzi.app)" and any "https://..." patterns the
// templates emit, so we can test deliverability without any clickable target.
function stripLinks(text: string): string {
  return text
    // Remove " (clipzi.app)" or "(any-domain.tld)" patterns including the
    // leading whitespace so we don't leave dangling spaces.
    .replace(/\s*\(\s*[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\s*\/?\S*)?\s*\)/gi, "")
    // Remove any bare http(s) URLs.
    .replace(/https?:\/\/\S+/g, "")
    // Collapse stray double-spaces that could result from removal.
    .replace(/[ \t]{2,}/g, " ");
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { subject: rawSubject, html, language, kind, isAgency } = await buildEmail(params);
  const subject = params.lowercaseSubject ? rawSubject.toLowerCase() : rawSubject;
  const from = `${params.fromName} <${params.fromEmail}>`;
  const to = [params.to];
  // Outreach goes out as plain text (not HTML): reads as a personal 1:1 mail
  // and tends to land in Primary instead of Promotions. The copy is unchanged
  // (htmlToPlainText preserves the words + paragraph breaks; "clipzi.app" stays
  // as text and Gmail auto-links it).
  let bodyText = htmlToPlainText(html);
  if (params.noLink) bodyText = stripLinks(bodyText);
  // linkDomain: swap "clipzi.app" for the given domain (e.g. "clipzi.net") so
  // we can A/B test if the specific domain reference is what trips spam filters.
  if (params.linkDomain && params.linkDomain.trim()) {
    const domain = params.linkDomain.trim();
    bodyText = bodyText.replace(/clipzi\.app/g, domain);
  }
  try {
    const { data, error } = await client().emails.send({
      from,
      to,
      subject,
      text: bodyText,
      ...(params.rfcMessageId ? { headers: { "Message-ID": params.rfcMessageId } } : {}),
      ...(params.attachments?.length ? { attachments: params.attachments } : {}),
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
