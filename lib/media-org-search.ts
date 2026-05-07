// Sonar wrapper for the media-org vertical: radios, podcast networks, and
// streaming-TV channels. Single search type per (country × category) — no
// individual/org split (individuals come in via creator-discovery on YouTube).
//
// Categories cover the four flavors of "org that produces recorded long-form
// content and needs to clip it":
//   - streaming-tv     (Olga, Luzu, Vorterix, Twitch-style live broadcasters)
//   - radio-station    (FM/AM stations that publish their programs online)
//   - podcast-network  (multi-show production companies)
//   - internet-radio   (online-only stations with archives)
//
// Reuses the Sonar transport pattern from lib/agency-search.ts. Reuses
// normalizeDomain + isPlaceholderEmail from there.

import { normalizeDomain, isPlaceholderEmail, type AgencyResult } from "./agency-search";

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "perplexity/sonar-pro";

export type MediaOrgCategory =
  | "streaming-tv"
  | "radio-station"
  | "podcast-network"
  | "internet-radio";

export const MEDIA_ORG_CATEGORIES: MediaOrgCategory[] = [
  "streaming-tv",
  "radio-station",
  "podcast-network",
  "internet-radio",
];

export interface MediaOrgSearchResult {
  results: AgencyResult[];
  citations: string[];
  rawContent: string;
  inputTokens?: number;
  outputTokens?: number;
}

// Country code → full name (Sonar misreads "AR" as Arkansas etc.). 9 LATAM-pesados.
const COUNTRY_FULL_NAMES: Record<string, string> = {
  AR: "Argentina",
  MX: "Mexico",
  ES: "Spain",
  CO: "Colombia",
  CL: "Chile",
  UY: "Uruguay",
  BR: "Brazil",
  US: "United States",
  GB: "United Kingdom",
};

const CATEGORY_LABEL: Record<MediaOrgCategory, string> = {
  "streaming-tv":
    "online-only streaming media networks (NOT traditional broadcast TV channels). The exact pattern: companies like Olga (olga.fm), Luzu TV, Vorterix, Bondi Live, Gelatina, Carajo, Blender in Argentina, or similar online media networks elsewhere. These broadcast multi-hour daily shows on YouTube and/or their own apps, with multiple in-house hosts, a studio operation, and a digital-first business model. Do NOT include traditional TV networks like Telefe, El Trece, Televisa, RTVE, BBC, NBC, etc.",
  "radio-station":
    "FM or AM radio stations that publicly host or stream their recorded programs online (with downloadable archives, podcast feeds, or YouTube uploads of their shows)",
  "podcast-network":
    "podcast networks and podcast production companies that operate multiple shows under one brand (NOT solo podcasters with their own show)",
  "internet-radio":
    "internet-only radio stations and webcasters (no FM/AM signal) that publicly stream live and archive their programs",
};

function buildPrompt(
  countryCode: string,
  category: MediaOrgCategory,
  n: number,
): string {
  const countryName = COUNTRY_FULL_NAMES[countryCode] ?? countryCode;
  const label = CATEGORY_LABEL[category];
  return `List up to ${n} ${label} headquartered or primarily operating in ${countryName} (the country, not a US state). Each entry must have a real website with a real TLD — we will scrape the email from the site if you don't surface one directly.

Return ONLY a JSON object with this exact shape:
{
  "agencies": [
    {"name": "Org Name", "website": "real-domain.com", "email": "real@domain.com or null", "city": "city or null"}
  ]
}

Rules:
1. "website" is a fully-qualified web domain with a real TLD (e.g. olga.fm, luzutv.com.ar, cadenaser.com). It is NEVER an Instagram/TikTok/Twitter/X/Facebook/YouTube/Spotify/Linktree/Wikipedia URL, a handle, a slug, or a placeholder.
2. "email" is a real visible-on-the-website email if you know one. Otherwise, set "email" to null and we will scrape.
3. The org is genuinely headquartered in ${countryName} or has its primary studio there. Skip global networks unless they have a dedicated ${countryName} office.
4. Skip individual hosts/podcasters/streamers — return only ORGANIZATIONS (companies, stations, networks).
5. "website" must be the apex domain only (no https://, no www., no path).
6. Avoid duplicates of name OR website.

The outer "agencies" key name is required by the schema even though these are media organizations.

Bias toward HIGH RECALL: if an org plausibly fits, include it with email=null and a real website — we'll handle the rest. Only exclude entries where the website itself is fake or the org is clearly not in ${countryName}.`;
}

async function callSonar(prompt: string): Promise<MediaOrgSearchResult> {
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

export async function searchMediaOrgs(
  country: string,
  category: MediaOrgCategory,
  options: { maxResults?: number } = {},
): Promise<MediaOrgSearchResult> {
  const prompt = buildPrompt(country, category, options.maxResults ?? 10);
  return callSonar(prompt);
}
