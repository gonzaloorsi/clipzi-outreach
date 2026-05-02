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

const TEMPLATES: Record<SupportedLanguage, TemplateBuilder> = {
  en: buildEn,
  es: buildEs,
  pt: buildPt,
  de: buildDe,
  fr: buildFr,
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
 * Get the template builder for a language.
 * Always returns something (en if the requested lang is unsupported).
 */
export function getTemplate(lang: SupportedLanguage): TemplateBuilder {
  return TEMPLATES[lang] ?? TEMPLATES.en;
}

export type { SupportedLanguage, TemplateInput, TemplateOutput, TemplateBuilder } from "./types";
