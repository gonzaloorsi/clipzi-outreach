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

export type TemplateKind =
  | "creator"
  | "agency"
  | "standup-individual"
  | "standup-org";

export function detectKind(discoveredVia: string | null | undefined): TemplateKind {
  if (isStandupIndividual(discoveredVia)) return "standup-individual";
  if (isStandupOrg(discoveredVia)) return "standup-org";
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
    case "agency":
      return (
        AGENCY_TEMPLATES[language] ??
        AGENCY_TEMPLATES.en ??
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
  country?: string | null;
  language?: string | null;
  discoveredVia?: string | null;
}): {
  builder: TemplateBuilder;
  language: SupportedLanguage;
  kind: TemplateKind;
  isAgency: boolean;
} {
  const language = detectLanguage(channel.country, channel.language);
  const kind = detectKind(channel.discoveredVia);
  const builder = builderForKind(kind, language);
  return { builder, language, kind, isAgency: kind === "agency" };
}

/**
 * ASYNC version: tries the DB-stored override first, falls back to code.
 * The send pipeline uses this so the founder can edit copy from /dashboard
 * without redeploying.
 */
export async function pickTemplateFromDb(channel: {
  country?: string | null;
  language?: string | null;
  discoveredVia?: string | null;
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
  const kind = detectKind(channel.discoveredVia);
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

export type { SupportedLanguage, TemplateInput, TemplateOutput, TemplateBuilder } from "./types";
