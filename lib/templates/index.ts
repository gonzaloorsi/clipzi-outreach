// Template router. Detects language from channel.country / channel.language,
// picks the right template, and falls back to en for anything unsupported.
//
// To add a new language:
//   1. Create lib/templates/<lang>.ts exporting build()
//   2. Import + register in TEMPLATES below
//   3. Add country mappings to COUNTRY_TO_LANG (optional — language field
//      detection works without it)

import type { TemplateBuilder, SupportedLanguage } from "./types";
import { build as buildEn } from "./en";
import { build as buildEs } from "./es";
import { build as buildPt } from "./pt";
import { build as buildDe } from "./de";
import { build as buildFr } from "./fr";
// B2B agency variants — only en/es/pt for now. Other languages fall back
// to agency-en (still better than the creator template for an agency).
import { build as buildAgencyEn } from "./agency-en";
import { build as buildAgencyEs } from "./agency-es";
import { build as buildAgencyPt } from "./agency-pt";
// Standup variants — split into individual (B2C) vs org (B2B). Same lang coverage
// as agency: en/es/pt with en fallback for the rest.
import { build as buildStandupIndividualEn } from "./standup-individual-en";
import { build as buildStandupIndividualEs } from "./standup-individual-es";
import { build as buildStandupIndividualPt } from "./standup-individual-pt";
import { build as buildStandupOrgEn } from "./standup-org-en";
import { build as buildStandupOrgEs } from "./standup-org-es";
import { build as buildStandupOrgPt } from "./standup-org-pt";
// Media-org variant — radios, podcast networks, streaming-TV channels (B2B).
// No individual sibling — the individuals (Rogan, hosts, streamers) come in via
// creator-discovery on YouTube.
import { build as buildMediaOrgEn } from "./media-org-en";
import { build as buildMediaOrgEs } from "./media-org-es";
import { build as buildMediaOrgPt } from "./media-org-pt";
// Journalist variants — split into individual (B2C: independent journalists
// with video shows) vs org (B2B: press unions, associations, clubs, schools).
import { build as buildJournalistIndividualEn } from "./journalist-individual-en";
import { build as buildJournalistIndividualEs } from "./journalist-individual-es";
import { build as buildJournalistIndividualPt } from "./journalist-individual-pt";
import { build as buildJournalistOrgEn } from "./journalist-org-en";
import { build as buildJournalistOrgEs } from "./journalist-org-es";
import { build as buildJournalistOrgPt } from "./journalist-org-pt";
// Photographer variants — split into individual (B2C: photographers/videographers
// shooting event video) vs org (B2B: studios and photographer associations).
import { build as buildPhotographerIndividualEn } from "./photographer-individual-en";
import { build as buildPhotographerIndividualEs } from "./photographer-individual-es";
import { build as buildPhotographerIndividualPt } from "./photographer-individual-pt";
import { build as buildPhotographerOrgEn } from "./photographer-org-en";
import { build as buildPhotographerOrgEs } from "./photographer-org-es";
import { build as buildPhotographerOrgPt } from "./photographer-org-pt";
// Linkbuilding variant — marketing/SEO blogs, listicle authors and tool
// directories we want a Clipzi backlink from. Single kind (no individual/org
// split), full 5-language coverage since blogs write in their market's language.
import { build as buildLinkbuildingEn } from "./linkbuilding-en";
import { build as buildLinkbuildingEs } from "./linkbuilding-es";
import { build as buildLinkbuildingPt } from "./linkbuilding-pt";
import { build as buildLinkbuildingDe } from "./linkbuilding-de";
import { build as buildLinkbuildingFr } from "./linkbuilding-fr";
// Church variant — evangelical churches and Christian ministries with active
// YouTube channels (B2B-ish). Pilot markets es/pt with en fallback.
import { build as buildChurchEs } from "./church-es";
import { build as buildChurchPt } from "./church-pt";
import { build as buildChurchEn } from "./church-en";
// YouTube v2 — the "most replayed" hook (lib/heatmap.ts) and its no-data
// fallback, a one-word question. Creators only; A/B against creator-* (v1) by
// channel id hash (see resolveCreatorVariant).
import { build as buildYoutubeHotEs } from "./youtube-hot-es";
import { build as buildYoutubeHotEn } from "./youtube-hot-en";
import { build as buildYoutubeHotPt } from "./youtube-hot-pt";
import { build as buildYoutubeQuestionEs } from "./youtube-question-es";
import { build as buildYoutubeQuestionEn } from "./youtube-question-en";
import { build as buildYoutubeQuestionPt } from "./youtube-question-pt";
import { createHash } from "crypto";

const CREATOR_TEMPLATES: Record<SupportedLanguage, TemplateBuilder> = {
  en: buildEn,
  es: buildEs,
  pt: buildPt,
  de: buildDe,
  fr: buildFr,
};

const AGENCY_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildAgencyEn,
  es: buildAgencyEs,
  pt: buildAgencyPt,
};

const STANDUP_INDIVIDUAL_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildStandupIndividualEn,
  es: buildStandupIndividualEs,
  pt: buildStandupIndividualPt,
};

const STANDUP_ORG_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildStandupOrgEn,
  es: buildStandupOrgEs,
  pt: buildStandupOrgPt,
};

const MEDIA_ORG_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildMediaOrgEn,
  es: buildMediaOrgEs,
  pt: buildMediaOrgPt,
};

const JOURNALIST_INDIVIDUAL_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildJournalistIndividualEn,
  es: buildJournalistIndividualEs,
  pt: buildJournalistIndividualPt,
};

const JOURNALIST_ORG_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildJournalistOrgEn,
  es: buildJournalistOrgEs,
  pt: buildJournalistOrgPt,
};

const PHOTOGRAPHER_INDIVIDUAL_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildPhotographerIndividualEn,
  es: buildPhotographerIndividualEs,
  pt: buildPhotographerIndividualPt,
};

const PHOTOGRAPHER_ORG_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildPhotographerOrgEn,
  es: buildPhotographerOrgEs,
  pt: buildPhotographerOrgPt,
};

const LINKBUILDING_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  en: buildLinkbuildingEn,
  es: buildLinkbuildingEs,
  pt: buildLinkbuildingPt,
  de: buildLinkbuildingDe,
  fr: buildLinkbuildingFr,
};

const CHURCH_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  es: buildChurchEs,
  pt: buildChurchPt,
  en: buildChurchEn,
};

const YOUTUBE_HOT_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  es: buildYoutubeHotEs,
  en: buildYoutubeHotEn,
  pt: buildYoutubeHotPt,
};

const YOUTUBE_QUESTION_TEMPLATES: Partial<Record<SupportedLanguage, TemplateBuilder>> = {
  es: buildYoutubeQuestionEs,
  en: buildYoutubeQuestionEn,
  pt: buildYoutubeQuestionPt,
};

// ISO 3166-1 alpha-2 country code → primary language for our outreach purposes.
// Where a country is multilingual, picks the language we'd most likely succeed
// with given typical YouTube creator demographics.
const COUNTRY_TO_LANG: Record<string, SupportedLanguage> = {
  // Spanish
  AR: "es", MX: "es", CO: "es", CL: "es", PE: "es", EC: "es", VE: "es",
  UY: "es", PY: "es", BO: "es", CR: "es", PA: "es", DO: "es", GT: "es",
  ES: "es", NI: "es", SV: "es", HN: "es", CU: "es", PR: "es",
  // Portuguese
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt",
  // German
  DE: "de", AT: "de",
  // French
  FR: "fr", BE: "fr", LU: "fr", MC: "fr", SN: "fr", CI: "fr",
  // Multilingual countries — pick the dominant lang for our YT creator dataset
  CH: "de", // Switzerland: German is largest in CH
  // English (most others fall to 'en' default; explicit list helps clarity)
  US: "en", GB: "en", CA: "en", AU: "en", NZ: "en", IE: "en",
  IN: "en", ZA: "en", NG: "en", KE: "en", GH: "en", PH: "en", SG: "en",
  MY: "en", PK: "en",
};

const SUPPORTED: SupportedLanguage[] = ["en", "es", "pt", "de", "fr"];

/**
 * Detect target language from channel metadata.
 *
 * Priority:
 *   1. channel.language (defaultLanguage from YT API) if it maps to a
 *      supported language. Strips locale suffix (en-GB → en, es-419 → es).
 *   2. channel.country mapped via COUNTRY_TO_LANG.
 *   3. Fallback: en.
 */
export function detectLanguage(
  country: string | null | undefined,
  language: string | null | undefined,
): SupportedLanguage {
  if (language) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if ((SUPPORTED as string[]).includes(base)) {
      return base as SupportedLanguage;
    }
  }
  if (country) {
    const mapped = COUNTRY_TO_LANG[country.toUpperCase()];
    if (mapped) return mapped;
  }
  return "en";
}

/**
 * Get the creator-facing template builder for a language.
 * Always returns something (en if the requested lang is unsupported).
 */
export function getTemplate(lang: SupportedLanguage): TemplateBuilder {
  return CREATOR_TEMPLATES[lang] ?? CREATOR_TEMPLATES.en;
}

/**
 * Decide whether a channel row should be treated as an AGENCY (B2B template)
 * or a CREATOR (default template), based on how it was discovered.
 */
export function isAgency(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return (
    discoveredVia.startsWith("sonar:agency:") ||
    discoveredVia.startsWith("agency:") ||
    discoveredVia.startsWith("legacy:agencies")
  );
}

export function isStandupIndividual(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:standup-individual:");
}

export function isStandupOrg(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:standup-org:");
}

export function isMediaOrg(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:media-org:");
}

export function isJournalistIndividual(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:journalist-individual:");
}

export function isJournalistOrg(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:journalist-org:");
}

export function isPhotographerIndividual(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:photographer-individual:");
}

export function isPhotographerOrg(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:photographer-org:");
}

export function isLinkbuilding(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:linkbuilding-site:");
}

export function isChurch(discoveredVia: string | null | undefined): boolean {
  if (!discoveredVia) return false;
  return discoveredVia.startsWith("sonar:church-org:");
}

export type TemplateKind =
  | "creator"
  | "agency"
  | "standup-individual"
  | "standup-org"
  | "media-org"
  | "journalist-individual"
  | "journalist-org"
  | "photographer-individual"
  | "photographer-org"
  | "linkbuilding"
  | "church"
  | "youtube-hot"
  | "youtube-question";

// Share of YouTube creators that get the v2 templates instead of creator-*
// (v1). 50 = A/B 50/50; 100 = v2 for everyone; 0 = v1 only. Assignment is a
// stable hash of the channel id so a channel never flips between arms.
export function youtubeV2RatioPct(): number {
  const raw = Number(process.env.YOUTUBE_V2_RATIO ?? "100");
  if (!Number.isFinite(raw)) return 100;
  return Math.max(0, Math.min(100, raw));
}

export function inYoutubeV2Arm(channelId: string, ratioPct = youtubeV2RatioPct()): boolean {
  if (ratioPct <= 0) return false;
  if (ratioPct >= 100) return true;
  const h = parseInt(createHash("sha256").update(`ytv2:${channelId}`).digest("hex").slice(0, 8), 16);
  return h % 100 < ratioPct;
}

// The v2 templates exist in these languages only. A German or French channel
// must keep its v1 creator template (which exists in de/fr) rather than get an
// English v2, so the arm is gated on language as well as on the id hash.
const YOUTUBE_V2_LANGS: ReadonlySet<SupportedLanguage> = new Set(["es", "en", "pt"]);

/**
 * Creators split three ways: v1 (control), youtube-hot (hot_source present)
 * or youtube-question (v2 arm, no personalization data). Only real YouTube
 * channels (UC ids) in a v2 language enter the arm; legacy/sonar creator rows
 * and de/fr channels stay on v1.
 */
export function resolveCreatorVariant(
  channel: {
    id?: string | null;
    discoveredVia?: string | null;
    hotSource?: string | null;
  },
  language: SupportedLanguage,
): TemplateKind {
  const base = detectKind(channel.discoveredVia);
  if (base !== "creator") return base;
  if (!channel.id || !channel.id.startsWith("UC")) return "creator";
  if (!YOUTUBE_V2_LANGS.has(language)) return "creator";
  if (!inYoutubeV2Arm(channel.id)) return "creator";
  return channel.hotSource ? "youtube-hot" : "youtube-question";
}

export function detectKind(discoveredVia: string | null | undefined): TemplateKind {
  if (isLinkbuilding(discoveredVia)) return "linkbuilding";
  if (isChurch(discoveredVia)) return "church";
  if (isStandupIndividual(discoveredVia)) return "standup-individual";
  if (isStandupOrg(discoveredVia)) return "standup-org";
  if (isMediaOrg(discoveredVia)) return "media-org";
  if (isJournalistIndividual(discoveredVia)) return "journalist-individual";
  if (isJournalistOrg(discoveredVia)) return "journalist-org";
  if (isPhotographerIndividual(discoveredVia)) return "photographer-individual";
  if (isPhotographerOrg(discoveredVia)) return "photographer-org";
  if (isAgency(discoveredVia)) return "agency";
  return "creator";
}

function builderForKind(
  kind: TemplateKind,
  language: SupportedLanguage,
): TemplateBuilder {
  switch (kind) {
    case "standup-individual":
      return (
        STANDUP_INDIVIDUAL_TEMPLATES[language] ??
        STANDUP_INDIVIDUAL_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "standup-org":
      return (
        STANDUP_ORG_TEMPLATES[language] ??
        STANDUP_ORG_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "media-org":
      return (
        MEDIA_ORG_TEMPLATES[language] ??
        MEDIA_ORG_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "journalist-individual":
      return (
        JOURNALIST_INDIVIDUAL_TEMPLATES[language] ??
        JOURNALIST_INDIVIDUAL_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "journalist-org":
      return (
        JOURNALIST_ORG_TEMPLATES[language] ??
        JOURNALIST_ORG_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "photographer-individual":
      return (
        PHOTOGRAPHER_INDIVIDUAL_TEMPLATES[language] ??
        PHOTOGRAPHER_INDIVIDUAL_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "photographer-org":
      return (
        PHOTOGRAPHER_ORG_TEMPLATES[language] ??
        PHOTOGRAPHER_ORG_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "linkbuilding":
      return (
        LINKBUILDING_TEMPLATES[language] ??
        LINKBUILDING_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "church":
      return (
        CHURCH_TEMPLATES[language] ??
        CHURCH_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "agency":
      return (
        AGENCY_TEMPLATES[language] ??
        AGENCY_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "youtube-hot":
      return (
        YOUTUBE_HOT_TEMPLATES[language] ??
        YOUTUBE_HOT_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "youtube-question":
      return (
        YOUTUBE_QUESTION_TEMPLATES[language] ??
        YOUTUBE_QUESTION_TEMPLATES.en ??
        CREATOR_TEMPLATES.en
      );
    case "creator":
    default:
      return CREATOR_TEMPLATES[language] ?? CREATOR_TEMPLATES.en;
  }
}

/**
 * Pick the right template (creator / agency / standup-individual / standup-org)
 * for this row's (country, language, discoveredVia). Single entry point — send
 * route uses this so it doesn't need to know about the variant split.
 *
 * SYNC version: uses code-based templates only. Used as a fallback when
 * the DB lookup is too expensive (e.g. tight loops, tests).
 */
export function pickTemplate(channel: {
  id?: string | null;
  country?: string | null;
  language?: string | null;
  discoveredVia?: string | null;
  hotSource?: string | null;
}): {
  builder: TemplateBuilder;
  language: SupportedLanguage;
  kind: TemplateKind;
  isAgency: boolean;
} {
  const language = detectLanguage(channel.country, channel.language);
  const kind = resolveCreatorVariant(channel, language);
  const builder = builderForKind(kind, language);
  return { builder, language, kind, isAgency: kind === "agency" };
}

/**
 * ASYNC version: tries the DB-stored override first, falls back to code.
 * The send pipeline uses this so the founder can edit copy from /dashboard
 * without redeploying.
 */
export async function pickTemplateFromDb(channel: {
  id?: string | null;
  country?: string | null;
  language?: string | null;
  discoveredVia?: string | null;
  hotSource?: string | null;
}): Promise<{
  builder: TemplateBuilder;
  language: SupportedLanguage;
  kind: TemplateKind;
  isAgency: boolean;
  source: "db" | "code";
  resolvedKey: string;
}> {
  // Lazy import to avoid loading drizzle/db in code paths that don't need it
  const { loadTemplateBuilder } = await import("./db-loader");

  const language = detectLanguage(channel.country, channel.language);
  const kind = resolveCreatorVariant(channel, language);
  const desiredKey = `${kind}-${language}`;
  const fallbackKey = `${kind}-en`;

  const { builder, source, resolvedKey } = await loadTemplateBuilder(
    desiredKey,
    fallbackKey,
  );
  return {
    builder,
    language,
    kind,
    isAgency: kind === "agency",
    source,
    resolvedKey,
  };
}

export type { SupportedLanguage, TemplateInput, TemplateOutput, TemplateBuilder, HotInput } from "./types";
