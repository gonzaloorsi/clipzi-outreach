// Sonar wrapper for the photographer vertical. Two flavors:
//   - searchPhotographerIndividuals(country, {angle})  → photographers/videographers who film events (B2C)
//   - searchPhotographerOrgs(country, cat)             → photo/video studios and photographer associations (B2B)
//
// Clipzi fit: these people/orgs shoot HOURS of event video (weddings, corporate,
// sports) and need highlight clips to deliver to clients and to promote
// themselves on social. Individuals take an "angle" (specialty) rotated daily by
// the route — same pattern as MEDIA_ORG_ANGLES in lib/media-org-search.ts.
//
// Reuses the Sonar transport pattern from lib/agency-search.ts and the helpers
// normalizeDomain + isPlaceholderEmail from there. Same AI Gateway endpoint and
// model. Same JSON-mode contract.

import { normalizeDomain, isPlaceholderEmail, type AgencyResult } from "./agency-search";

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "perplexity/sonar-pro";

export type PhotographerOrgCategory = "studio" | "association";

export const PHOTOGRAPHER_ORG_CATEGORIES: PhotographerOrgCategory[] = [
  "studio",
  "association",
];

// Specialties for individual photographers/videographers, rotated by day so the
// same country query surfaces a different cluster each day. After 6 days every
// country has been queried with all angles.
export const PHOTOGRAPHER_ANGLES: string[] = [
  "wedding",
  "events and corporate",
  "sports and action",
  "documentary",
  "portrait and fashion",
  "travel and outdoor",
];

export interface PhotographerSearchResult {
  results: AgencyResult[]; // shape works for individuals too: name + website + email + city
  citations: string[];
  rawContent: string;
  inputTokens?: number;
  outputTokens?: number;
}

// Country code → full name. Sonar misreads "AR" as Arkansas etc., so we always
// pass the full country name. Mirrors the table in standup-search.ts so we
// don't import a private const.
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

const ORG_CATEGORY_LABEL: Record<PhotographerOrgCategory, string> = {
  studio:
    "photography and videography studios that shoot weddings, corporate events or commercial video (multi-photographer operations with a real business site)",
  association:
    "photographer associations, professional photography guilds and photography member clubs",
};

function buildIndividualsPrompt(countryCode: string, n: number, angle: string): string {
  const countryName = COUNTRY_FULL_NAMES[countryCode] ?? countryCode;
  return `List up to ${n} professional photographers or videographers based in ${countryName} (the country, not a US state) who also shoot VIDEO (weddings, events, corporate, documentary work) and have their own real website. Focus specifically on **${angle}** photographers/videographers. We will scrape the email from the site if you don't surface one directly.

Return ONLY a JSON object with this exact shape:
{
  "agencies": [
    {"name": "Photographer Full Name or Brand", "website": "real-domain.com", "email": "real@real-domain.com or null", "city": "city or null"}
  ]
}

Rules:
1. "website" is a fully-qualified web domain with a real TLD (e.g. photographer-name.com, studio-name.com.ar). It is NEVER:
   - an Instagram, TikTok, Twitter/X, Facebook, YouTube, Behance, 500px, Flickr, Linktree, Wikipedia, or IMDb URL
   - a handle, a slug, a string without a dot-TLD
   - a placeholder ("example.com", "your-domain", etc.)
2. "email" is a real visible-on-the-website email if you know one. Otherwise, set "email" to null and we will scrape.
3. The photographer is genuinely based in ${countryName} and works there.
4. Prefer portfolios that show VIDEO work (films, highlight reels, event coverage), not stills only.
5. "website" must be the apex domain only (no https://, no www., no path).
6. Avoid duplicates of name OR website.

The outer "agencies" key name is required by the schema even though these are individuals.

Bias toward HIGH RECALL: if a photographer plausibly fits, include them with email=null and a real website — we'll handle the rest. Only exclude entries where the website itself is fake or the person is clearly not in ${countryName}.`;
}

function buildOrgsPrompt(
  countryCode: string,
  category: PhotographerOrgCategory,
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

async function callSonar(prompt: string): Promise<PhotographerSearchResult> {
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

export async function searchPhotographerIndividuals(
  country: string,
  options: { maxResults?: number; angle: string },
): Promise<PhotographerSearchResult> {
  const prompt = buildIndividualsPrompt(country, options.maxResults ?? 15, options.angle);
  return callSonar(prompt);
}

export async function searchPhotographerOrgs(
  country: string,
  category: PhotographerOrgCategory,
  options: { maxResults?: number } = {},
): Promise<PhotographerSearchResult> {
  const prompt = buildOrgsPrompt(country, category, options.maxResults ?? 15);
  return callSonar(prompt);
}
