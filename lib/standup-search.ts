// Sonar wrapper for the standup vertical. Two flavors:
//   - searchStandupIndividuals(country)  → individual stand-up comedians (B2C)
//   - searchStandupOrgs(country, cat)    → schools, clubs, festivals, production companies (B2B)
//
// Reuses the Sonar transport pattern from lib/agency-search.ts and the helpers
// normalizeDomain + isPlaceholderEmail from there. Same AI Gateway endpoint and
// model. Same JSON-mode contract.

import { normalizeDomain, isPlaceholderEmail, type AgencyResult } from "./agency-search";

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "perplexity/sonar-pro";

export type StandupOrgCategory =
  | "school"
  | "club"
  | "festival"
  | "production-company";

export const STANDUP_ORG_CATEGORIES: StandupOrgCategory[] = [
  "school",
  "club",
  "festival",
  "production-company",
];

export interface StandupSearchResult {
  results: AgencyResult[]; // shape works for individuals too: name + website + email + city
  citations: string[];
  rawContent: string;
  inputTokens?: number;
  outputTokens?: number;
}

// Country code → full name. Sonar misreads "AR" as Arkansas etc., so we always
// pass the full country name. Mirrors the table in agency-search.ts so we don't
// import a private const.
const COUNTRY_FULL_NAMES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  AR: "Argentina",
  ES: "Spain",
  MX: "Mexico",
  BR: "Brazil",
  CO: "Colombia",
  CL: "Chile",
  UY: "Uruguay",
  AU: "Australia",
  CA: "Canada",
  PE: "Peru",
  IE: "Ireland",
  NZ: "New Zealand",
  IN: "India",
  FR: "France",
  DE: "Germany",
  IT: "Italy",
  NL: "Netherlands",
  ZA: "South Africa",
  PH: "Philippines",
};

const ORG_CATEGORY_LABEL: Record<StandupOrgCategory, string> = {
  school:
    "stand-up comedy schools and improv schools that train comedians",
  club:
    "comedy clubs and stand-up venues that host live shows and record performances",
  festival:
    "stand-up comedy festivals and recurring comedy events",
  "production-company":
    "comedy production companies and labels that produce stand-up specials, podcasts or tours",
};

function buildIndividualsPrompt(countryCode: string, n: number): string {
  const countryName = COUNTRY_FULL_NAMES[countryCode] ?? countryCode;
  return `List up to ${n} stand-up comedians based in ${countryName} (the country, not a US state) whose primary public contact is reachable through a real website with a real email address.

Return ONLY a JSON object with this exact shape:
{
  "agencies": [
    {"name": "Comedian Full Name", "website": "real-domain.com", "email": "real@real-domain.com", "city": "city or null"}
  ]
}

CRITICAL — each entry MUST satisfy ALL of these or be omitted entirely:
1. "website" is a fully-qualified web domain with a real TLD (e.g. comedian-name.com, comedian-name.es, manager-domain.co.uk). It is NEVER:
   - an Instagram, TikTok, Twitter/X, Facebook, YouTube, Spotify, Linktree, Wikipedia, or IMDb URL
   - a handle, a slug, a string without a dot-TLD (like "standupcomedy_spain")
   - a placeholder ("example.com", "your-domain", etc.)
2. "email" is a real visible-on-the-website email address with a domain that matches OR plausibly relates to the website (e.g. bookings@manager-domain.com). It is NEVER null, never an Instagram handle, never a contact form URL, never a placeholder ("info@example.com").
3. The comedian is genuinely from ${countryName} or has a primary career base there.
4. The website is reachable today (no defunct sites).

If you cannot find a comedian that satisfies ALL four rules with confidence, do NOT include them. It is far better to return 2 high-confidence entries than 20 low-confidence ones. Returning an empty list is acceptable.

Other rules:
- "website" must be the apex domain only (no https://, no www., no path).
- Avoid duplicates of name OR website.
- The outer "agencies" key name is required by the schema even though these are individuals.`;
}

function buildOrgsPrompt(
  countryCode: string,
  category: StandupOrgCategory,
  n: number,
): string {
  const countryName = COUNTRY_FULL_NAMES[countryCode] ?? countryCode;
  const label = ORG_CATEGORY_LABEL[category];
  return `List ${n} ${label} headquartered in ${countryName} (the country, not a US state or region) that publicly list a contact email on their own website.

Return ONLY a JSON object with this exact shape:
{
  "agencies": [
    {"name": "string", "website": "apex-domain.com", "email": "contact@apex-domain.com or null", "city": "city or null"}
  ]
}

Strict rules:
- The organization MUST be headquartered or have a primary office in ${countryName}.
- "website" must be the apex domain only (no https://, no www., no path).
- "email" must be a real email visible on the site, or null.
- Skip organizations whose only contact is a form.
- Avoid duplicates.`;
}

async function callSonar(prompt: string): Promise<StandupSearchResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY not set");
  }

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a research assistant. Return only valid JSON matching the schema requested. Never include explanation, markdown fences, or commentary outside the JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = json.choices?.[0]?.message?.content ?? "";
  const citations = json.citations ?? [];

  let parsed: { agencies?: unknown[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error(`Sonar response not valid JSON: ${content.slice(0, 200)}`);
      }
    } else {
      throw new Error(`Sonar response not valid JSON: ${content.slice(0, 200)}`);
    }
  }

  const raw = Array.isArray(parsed.agencies) ? parsed.agencies : [];
  const results: AgencyResult[] = [];
  for (const a of raw) {
    if (typeof a !== "object" || a === null) continue;
    const obj = a as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : null;
    const website =
      typeof obj.website === "string" ? normalizeDomain(obj.website) : null;
    if (!name || !website) continue;
    const emailRaw =
      typeof obj.email === "string" && obj.email.includes("@")
        ? obj.email.trim().toLowerCase()
        : null;
    const email = emailRaw && !isPlaceholderEmail(emailRaw) ? emailRaw : null;
    const city = typeof obj.city === "string" ? obj.city.trim() : null;
    results.push({ name, website, email, city });
  }

  return {
    results,
    citations,
    rawContent: content,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}

export async function searchStandupIndividuals(
  country: string,
  options: { maxResults?: number } = {},
): Promise<StandupSearchResult> {
  const prompt = buildIndividualsPrompt(country, options.maxResults ?? 20);
  return callSonar(prompt);
}

export async function searchStandupOrgs(
  country: string,
  category: StandupOrgCategory,
  options: { maxResults?: number } = {},
): Promise<StandupSearchResult> {
  const prompt = buildOrgsPrompt(country, category, options.maxResults ?? 15);
  return callSonar(prompt);
}
