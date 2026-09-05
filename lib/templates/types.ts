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
  // Optional context: a human-readable reference to the prospect's relevant
  // article (host/path, no protocol). Only the linkbuilding templates use it;
  // naming the specific article measurably lifts reply rates.
  article?: string;
  // Recipient address. The YouTube v2 templates switch to plural ("ustedes")
  // for role addresses (info@, contacto@, prensa@...) and stay singular for
  // personal ones.
  toEmail?: string;
  // ISO country of the channel. Spanish v2 templates use "vos" for AR/UY and
  // "tú" everywhere else.
  country?: string | null;
  // "Most replayed" hook (lib/heatmap.ts). Only the youtube-hot templates
  // read it; the other kinds ignore it.
  hot?: HotInput;
}

export interface HotInput {
  source: "heatmap" | "top_comment" | "cadence";
  videoTitle: string;
  // Peak timestamps as "mm:ss" (heatmap only).
  mmss?: string | null;
  mmss2?: string | null;
  // Chapter title at the peak (heatmap) or the quoted comment (top_comment).
  label?: string | null;
  // Cadence: long uploads per month and their average length in minutes.
  perMonth?: number | null;
  avgMinutes?: number | null;
}

// Rules specific to the v2 YouTube templates, on top of the ones above:
// - Under 80 words. No links, no price, no "AI", no "team" salutation.
// - One question, answerable with one word. Sign with the first name only.
// - The first line must be about THEIR video, never about Clipzi.

// Social proof line. Registered accounts in Clipzi (Supabase auth), rounded
// down to the nearest thousand. Update from /stats once a month.
export const SOCIAL_PROOF_CREATORS = 59_000;

// Role addresses: the email is read by a team, not the creator.
const ROLE_LOCAL_RE =
  /^(info|contact|contacto|contato|hello|hola|hi|press|prensa|imprensa|business|negocios|booking|bookings|management|mgmt|team|equipo|admin|media|marketing|partnerships|partners|collab|collabs|colab|colabs|publicidad|comercial|ventas|sales|support|soporte|office|oficina|contact-us|contactus|inquiries|enquiries)([-._+].*)?$/i;

export function isRoleAddress(email: string | undefined | null): boolean {
  if (!email) return false;
  const local = email.split("@")[0] ?? "";
  return ROLE_LOCAL_RE.test(local);
}

export function usesVoseo(country: string | null | undefined): boolean {
  return country === "AR" || country === "UY";
}

export function formatThousands(n: number, locale: "es" | "en" | "pt"): string {
  const sep = locale === "en" ? "," : ".";
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Company signature for the v2 cold emails: full name on one line, company
 * on the next. Clipzi writes as a company, not as a solo founder. */
export const COMPANY_NAME = "Clipzi";
export function signatureFor(fromName: string): string {
  return fromName.trim() || "Clipzi";
}
export function signatureHtml(fromName: string): string {
  return `<p>${signatureFor(fromName)}<br/>${COMPANY_NAME}</p>`;
}

/** Trim a YouTube title for prose. YouTube titles stack segments
 * ("COLORAMA #19: Dolina y Rolón con Leiva | Entrevista completa | HISPA");
 * keep the first meaningful segment, drop a short label before a colon
 * ("COLORAMA #19:"), and only as a last resort cut at a word boundary. */
export function shortTitle(title: string, max = 60): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const first = clean.split(/\s\|\s|\s[-–—]\s/)[0].trim();
  const base = first.length >= 12 ? first : clean;
  if (base.length <= max) return base;
  const colon = base.split(/:\s+/);
  if (colon.length > 1) {
    const after = colon.slice(1).join(": ").trim();
    if (after.length >= 12 && after.length <= max) return after;
    const before = colon[0].trim();
    if (before.length >= 12 && before.length <= max) return before;
  }
  const cut = base.slice(0, max);
  const atWord = cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut;
  return atWord.replace(/[\s,;:.-]+$/, "") + "…";
}

/** Lowercase first four words of a title for the subject line. */
export function titleStub(title: string, words = 4): string {
  const clean = title.replace(/[|#"“”«»]/g, " ").replace(/\s+/g, " ").trim();
  const parts = clean.split(" ").filter(Boolean).slice(0, words);
  const stub = parts.join(" ").replace(/[.,;:!?]+$/, "");
  return stub.toLowerCase();
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
