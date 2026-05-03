// Sonar wrapper via Vercel AI Gateway. OpenAI-compatible API.
//
// Setup needed (one-time on the project):
//   1. Vercel → Project Settings → AI → Enable AI Gateway
//   2. Add Perplexity as a provider in AI Gateway
//   3. Set AI_GATEWAY_API_KEY env var (Vercel auto-generates)
//
// Cost per call (sonar-pro): ~$0.025 (~500 input tokens + ~1500 output)
// Failure modes: Sonar can hallucinate URLs/emails. Caller must validate.

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "perplexity/sonar-pro";

export interface AgencyResult {
  name: string;
  website: string; // apex domain (no scheme); cleaned/normalized
  email?: string | null;
  city?: string | null;
}

export interface SonarSearchResult {
  agencies: AgencyResult[];
  citations: string[];
  rawContent: string;
  inputTokens?: number;
  outputTokens?: number;
}

// ISO 3166-1 alpha-2 → full country name. Sonar misinterprets "AR" as Arkansas
// when used standalone, so we always pass the full country name in prompts.
const COUNTRY_FULL_NAMES: Record<string, string> = {
  // LATAM
  AR: "Argentina",
  MX: "Mexico",
  CO: "Colombia",
  CL: "Chile",
  PE: "Peru",
  ES: "Spain",
  BR: "Brazil",
  UY: "Uruguay",
  PY: "Paraguay",
  EC: "Ecuador",
  VE: "Venezuela",
  BO: "Bolivia",
  CR: "Costa Rica",
  PA: "Panama",
  DO: "Dominican Republic",
  GT: "Guatemala",
  PR: "Puerto Rico",
  // North America + UK
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  // Europe
  PT: "Portugal",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  NL: "Netherlands",
  SE: "Sweden",
  DK: "Denmark",
  NO: "Norway",
  FI: "Finland",
  IE: "Ireland",
  // Asia-Pacific
  IN: "India",
  AU: "Australia",
  NZ: "New Zealand",
  JP: "Japan",
  KR: "South Korea",
};

/**
 * Build a JSON-mode prompt asking Sonar for agencies in a country/category.
 * Output schema: array of {name, website, email, city}. Email is optional —
 * we'll fall back to scraping the website when Sonar didn't surface one.
 */
function buildPrompt(countryCode: string, category: string, n = 20): string {
  const categoryLabel: Record<string, string> = {
    marketing: "marketing and digital marketing",
    communication: "communication, PR, and press relations",
    "creator-management": "creator and influencer management (talent / MCN)",
    "community-management": "social media and community management",
    "pr-boutique":
      "boutique PR and public relations firms (small to mid-size, specialized)",
    "performance-marketing":
      "performance marketing and paid advertising (Google Ads, Meta Ads, growth)",
    "branding-studio":
      "branding studios and brand identity / design agencies",
    "content-production":
      "video and audio content production studios",
    "events-experiential":
      "events and experiential marketing agencies",
    "digital-transformation":
      "digital transformation and consulting agencies",
  };
  const label = categoryLabel[category] ?? category;
  const countryName = COUNTRY_FULL_NAMES[countryCode] ?? countryCode;
  return `List ${n} ${label} agencies headquartered in ${countryName} (the country, not a US state or region) that publicly list a contact email on their own website.

Return ONLY a JSON object with this exact shape:
{
  "agencies": [
    {"name": "string", "website": "apex-domain.com", "email": "contact@apex-domain.com or null", "city": "city or null"}
  ]
}

Strict rules:
- The agency MUST be headquartered or have a primary office in ${countryName}.
- "website" must be the apex domain only (no https://, no www., no path).
- "email" must be a real email visible on the agency's site, or null.
- Skip global holding networks unless they have a dedicated ${countryName} office with a local email on a country-specific subdomain.
- Skip agencies whose only contact is a form (no public email).
- Avoid duplicates.`;
}

/**
 * Call Sonar via Vercel AI Gateway. Returns parsed JSON or throws.
 */
export async function searchAgencies(
  country: string,
  category: string,
  options: { maxResults?: number } = {},
): Promise<SonarSearchResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY not set");
  }
  const prompt = buildPrompt(country, category, options.maxResults ?? 20);

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
      // Note: Sonar via AI Gateway doesn't accept response_format:json_object.
      // We rely on the prompt + fallback regex extraction from content.
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `AI Gateway ${res.status}: ${body.slice(0, 300)}`,
    );
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
    // Sonar sometimes wraps JSON in markdown despite our prompt — try to extract
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error(
          `Sonar response not valid JSON: ${content.slice(0, 200)}`,
        );
      }
    } else {
      throw new Error(
        `Sonar response not valid JSON: ${content.slice(0, 200)}`,
      );
    }
  }

  const rawAgencies = Array.isArray(parsed.agencies) ? parsed.agencies : [];
  const agencies: AgencyResult[] = [];
  for (const a of rawAgencies) {
    if (typeof a !== "object" || a === null) continue;
    const obj = a as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : null;
    const website =
      typeof obj.website === "string" ? normalizeDomain(obj.website) : null;
    if (!name || !website) continue;
    const email =
      typeof obj.email === "string" && obj.email.includes("@")
        ? obj.email.trim().toLowerCase()
        : null;
    const city = typeof obj.city === "string" ? obj.city.trim() : null;
    agencies.push({ name, website, email, city });
  }

  return {
    agencies,
    citations,
    rawContent: content,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}

/**
 * Strip protocol, www, trailing slash, and path from a URL/domain.
 * "https://www.foo.com/contact?x=1" → "foo.com"
 */
export function normalizeDomain(input: string): string | null {
  try {
    const trimmed = input.trim();
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withScheme);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || !host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Common placeholder / sample emails we want to skip when filtering.
 * Caught two false positives early:
 *   - sample emails on agency websites (user@domain.com, name@yourdomain.com)
 *   - generic placeholders in templates (you@example.com)
 */
const PLACEHOLDER_PATTERNS = [
  // No-reply / system addresses
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^postmaster@/i,
  /^mailer-daemon@/i,
  // Local part placeholders
  /^(user|name|nombre|email|correo|tu|you|your|sample|test|demo|hello|info|texto)@(domain|example|yourdomain|yourcompany|tudominio|tu-?empresa|empresa|nombredominio|company|texto)\./i,
  // Domain placeholders (catches *@domain.com, *@example.com, *@yourdomain.com etc.)
  /@(domain|example|yourdomain|yourcompany|tudominio|tu-?empresa|nombredominio|texto|dominio)\.(com|org|net|es|io|dominio)$/i,
  // Bare ".dominio" TLD (Spanish placeholder convention)
  /\.dominio$/i,
  // Lorem ipsum-style
  /^lorem@/i,
  /@lorem\./i,
];

export function isPlaceholderEmail(email: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(email));
}
