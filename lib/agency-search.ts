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

/**
 * Build a JSON-mode prompt asking Sonar for agencies in a country/category.
 * Output schema: array of {name, website, email, city}. Email is optional —
 * we'll fall back to scraping the website when Sonar didn't surface one.
 */
function buildPrompt(country: string, category: string, n = 20): string {
  const categoryLabel: Record<string, string> = {
    marketing: "marketing and digital marketing",
    communication: "communication, PR, and press relations",
    "creator-management": "creator and influencer management (talent / MCN)",
    "community-management": "social media and community management",
  };
  const label = categoryLabel[category] ?? category;
  return `List ${n} ${label} agencies based in ${country} that publicly list a contact email on their own website.

Return ONLY a JSON object with this exact shape:
{
  "agencies": [
    {"name": "string", "website": "apex-domain.com", "email": "contact@apex-domain.com or null", "city": "city or null"}
  ]
}

Strict rules:
- "website" must be the apex domain only (no https://, no www., no path).
- "email" must be a real email visible on the agency's site, or null.
- Skip global holding networks unless they have a dedicated ${country} office with a local email.
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
      response_format: { type: "json_object" },
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
 * Common placeholder / role-based emails we want to skip when filtering.
 * Keep a separate hard-block list (Apollo-style 'noreply' addresses).
 */
const PLACEHOLDER_PATTERNS = [
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^postmaster@/i,
  /^admin@example\./i,
  /@example\.(com|org|net)$/i,
];

export function isPlaceholderEmail(email: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(email));
}
