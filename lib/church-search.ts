// Sonar wrapper for the church vertical: evangelical churches and Christian
// ministries with ACTIVE YouTube channels (they stream services), reachable
// by email.
//
// Clipzi fit: a church produces more long-form video than any creator (a full
// service every week, minimum). One 1-hour sermon holds 5-6 moments that can
// reach far more people on Reels/TikTok/Shorts, and for a church that is not
// marketing, it is mission. Competition is zero in es/pt. Targeting matters:
// churches that ALREADY stream have the raw material, a media volunteer, and
// a growth mindset; the average parish that publishes nothing won't answer.
//
// Reuses the Sonar transport pattern from lib/agency-search.ts and helpers
// normalizeDomain + isPlaceholderEmail from there. Same AI Gateway endpoint
// and model. Same JSON-mode contract.

import { normalizeDomain, isPlaceholderEmail, type AgencyResult } from "./agency-search";

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "perplexity/sonar-pro";

export type ChurchCategory = "church" | "ministry";

export const CHURCH_CATEGORIES: ChurchCategory[] = ["church", "ministry"];

// Style/denomination angles rotated by day-of-year so the same country query
// surfaces a different cluster daily. Same pattern as PHOTOGRAPHER_ANGLES.
export const CHURCH_ANGLES: string[] = [
  "pentecostal and charismatic churches",
  "baptist and traditional evangelical churches",
  "contemporary Christian churches with young congregations and worship bands",
  "megachurches and multi-campus churches",
  "churches known for their strong social media and YouTube presence",
  "growing neighborhood churches that recently started streaming services",
];

export interface ChurchSearchResult {
  results: AgencyResult[];
  citations: string[];
  rawContent: string;
  inputTokens?: number;
  outputTokens?: number;
}

// Country code → full name. Sonar misreads "AR" as Arkansas etc., so we always
// pass the full country name. Mirrors the table in standup-search.ts so we
// don't import a private const.
const COUNTRY_FULL_NAMES: Record<string, string> = {
  AR: "Argentina",
  MX: "Mexico",
  CO: "Colombia",
  BR: "Brazil",
  CL: "Chile",
  PE: "Peru",
  US: "United States",
  ES: "Spain",
  UY: "Uruguay",
  PY: "Paraguay",
  EC: "Ecuador",
  GT: "Guatemala",
};

const CATEGORY_LABEL: Record<ChurchCategory, string> = {
  church:
    "evangelical churches that stream or upload their services to an active YouTube channel",
  ministry:
    "Christian ministries, evangelistic organizations, church networks or Christian media ministries that publish video content regularly",
};

function buildPrompt(
  countryCode: string,
  category: ChurchCategory,
  n: number,
  angle: string,
): string {
  const countryName = COUNTRY_FULL_NAMES[countryCode] ?? countryCode;
  const label = CATEGORY_LABEL[category];
  const focus =
    category === "church" ? `Focus specifically on **${angle}**.` : "";
  return `List up to ${n} ${label} based in ${countryName} (the country, not a US state) that have their own website. ${focus} We want to reach their media/communications team by email; we will scrape the email from the site if you don't surface one directly.

Return ONLY a JSON object with this exact shape:
{
  "agencies": [
    {"name": "Church or Ministry Name", "website": "real-domain.com", "email": "contacto@real-domain.com or null", "city": "city or null"}
  ]
}

Rules:
1. The church/ministry MUST have an ACTIVE YouTube channel where they stream or upload services, sermons or Christian content. This is the most important filter: skip organizations with no video presence.
2. "website" is a fully-qualified web domain with a real TLD. It is NEVER:
   - a YouTube, Instagram, Facebook, TikTok, Linktree or Wikipedia URL
   - a handle, a slug, a string without a dot-TLD
   - a placeholder ("example.com", "your-domain", etc.)
3. "email" is a real visible-on-the-website email if you know one. Otherwise null and we will scrape.
4. The organization is genuinely based in ${countryName}.
5. "website" must be the apex domain only (no https://, no www., no path).
6. Avoid duplicates of name OR website.

The outer "agencies" key name is required by the schema even though these are churches/ministries.

Bias toward HIGH RECALL: if an organization plausibly fits and clearly has video content, include it with email=null and a real website. Only exclude entries where the website is fake, the org has no video presence, or it is clearly not in ${countryName}.`;
}

async function callSonar(prompt: string): Promise<ChurchSearchResult> {
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

export async function searchChurches(
  country: string,
  category: ChurchCategory,
  options: { maxResults?: number; angle: string },
): Promise<ChurchSearchResult> {
  const prompt = buildPrompt(country, category, options.maxResults ?? 15, options.angle);
  return callSonar(prompt);
}
