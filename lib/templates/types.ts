// Email template contract: every per-language template exports build(...) that
// returns the same shape, so the router can pick a language and call uniformly.
//
// Style rules across ALL languages (do not break these):
// - No em-dashes (—) or en-dashes (–) anywhere. Use periods, commas, colons,
//   or rephrase. Hyphens inside compound words like "Co-founder" are OK.
// - Keep it short. Cold-outreach scale: long emails get filtered as spam.
// - One CTA per email.

export interface TemplateInput {
  channelName: string;
  fromName: string;
}

export interface TemplateOutput {
  subject: string;
  html: string;
}

export type TemplateBuilder = (input: TemplateInput) => TemplateOutput;

export type SupportedLanguage = "en" | "es" | "pt" | "de" | "fr";

// HTML escape for any user-controlled string (channel name, founder name).
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
