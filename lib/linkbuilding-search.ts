// Sonar wrapper for the linkbuilding vertical: marketing/SEO blogs, listicle
// authors and SaaS tool directories we want a Clipzi backlink or mention from.
//
// SEO/AEO rationale: Clipzi's programmatic pages (/tools /alternatives /vs
// /for) are capped by domain authority, not content; and "best AI clip tools"
// listicles are the #1 citation source for ChatGPT/Perplexity answers. Getting
// added to those articles moves both rankings and AI answers at once.
//
// Reuses the Sonar transport pattern from lib/agency-search.ts and the helpers
// normalizeDomain + isPlaceholderEmail from there. Same AI Gateway endpoint and
// model. Same JSON-mode contract, with one extra optional field per row:
// "article" (the listicle/post URL) which discovery stores for future
// per-article personalization.

import { normalizeDomain, isPlaceholderEmail, type AgencyResult } from "./agency-search";

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "perplexity/sonar-pro";

export type LinkbuildingCategory = "listicle" | "blog" | "directory";

export const LINKBUILDING_CATEGORIES: LinkbuildingCategory[] = [
  "listicle",
  "blog",
  "directory",
];

// Topic angles for listicle/blog searches, rotated by day-of-year like
// MEDIA_ORG_ANGLES. Each angle targets a different cluster of articles so the
// same country query surfaces fresh sites daily.
export const LINKBUILDING_ANGLES: string[] = [
  "best OpusClip alternatives and AI clipping tool comparisons",
  "AI tools that turn long videos or podcasts into short viral clips",
  "YouTube Shorts, TikTok and Reels tools and growth guides",
  "podcast repurposing and video content repurposing workflows",
  "AI video editing and auto-captioning tools roundups",
  "content marketing tool stacks for creators and social media managers",
  "video tool roundups where every recommended tool is paid (no real free option listed)",
];

export interface LinkbuildingResult extends AgencyResult {
  articleUrl: string | null;
  author: string | null;
}

export interface LinkbuildingSearchResult {
  results: LinkbuildingResult[];
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
  CA: "Canada",
  AU: "Australia",
  ES: "Spain",
  MX: "Mexico",
  AR: "Argentina",
  CO: "Colombia",
  CL: "Chile",
  BR: "Brazil",
  PT: "Portugal",
  DE: "Germany",
  AT: "Austria",
  FR: "France",
};

// Domains we never pitch, verified against real Sonar output:
//   - direct competitors (their listicles will never add us)
//   - huge publishers (cold email to a generic inbox goes nowhere; the prompt
//     asks Sonar to avoid them but it includes them anyway)
//   - self-serve directories with paid/own submission flows
const EXCLUDED_DOMAINS = new Set([
  // Competitors / adjacent AI video tools with content marketing blogs
  "opus.pro", "opusclip.com", "invideo.io", "synthesia.io", "veed.io",
  "descript.com", "kapwing.com", "capcut.com", "vidyo.ai", "2short.ai",
  "submagic.co", "klap.app", "pictory.ai", "fliki.ai", "heygen.com",
  "runwayml.com", "lumen5.com", "vizard.ai", "getmunch.com", "riverside.fm",
  "podcastle.ai", "clipchamp.com", "animoto.com", "wave.video",
  "clip.fm", "simplified.com", "wondershare.com", "filmora.wondershare.com",
  "flexclip.com", "spikes.studio", "quso.ai", "zubtitle.com", "captions.ai",
  // Big publishers / megasites
  "techradar.com", "zapier.com", "hubspot.com", "digitalocean.com",
  "hostinger.com", "forbes.com", "pcmag.com", "cnet.com", "theverge.com",
  "wired.com", "businessinsider.com", "mashable.com", "techcrunch.com",
  "shopify.com", "semrush.com", "ahrefs.com", "canva.com", "adobe.com",
  "microsoft.com", "google.com", "atlassian.com", "wix.com", "squarespace.com",
  // Self-serve directories (listing goes through their own flow, not email)
  "g2.com", "capterra.com", "producthunt.com", "getapp.com",
  "softwareadvice.com", "trustradius.com", "sourceforge.net",
  "alternativeto.net", "futurepedia.io", "toolify.ai", "theresanaiforthat.com",
]);

// Free-offer targeting: we do NOT pay for placements and have no affiliate
// program, so affiliate content mills (every tool link monetized) are
// low-yield. The prompts bias toward sites that publish roundups for
// authority/lead-gen: agency blogs, consultant sites, niche/indie blogs.
const CATEGORY_LABEL: Record<LinkbuildingCategory, string> = {
  listicle:
    "independent blogs, marketing agency blogs or consultant websites that published listicle/roundup articles reviewing or comparing AI video tools (NOT affiliate content mills where every tool link is an affiliate link)",
  blog: "video marketing, social media marketing, SEO or creator-economy blogs run by agencies, consultants or practitioners that regularly publish tool recommendations",
  directory:
    "SaaS tool directories and software review sites that list AI or video tools and have an editorial/submission contact",
};

function buildPrompt(
  countryCode: string,
  category: LinkbuildingCategory,
  n: number,
  angle: string,
): string {
  const countryName = COUNTRY_FULL_NAMES[countryCode] ?? countryCode;
  const label = CATEGORY_LABEL[category];
  const focus =
    category === "directory"
      ? "Focus on directories where tools like OpusClip, Descript or CapCut are already listed."
      : `Focus specifically on articles about **${angle}**.`;
  return `List up to ${n} ${label}, written in the primary language of ${countryName} or run by teams based in ${countryName} (the country, not a US state). ${focus} We want to reach the author or editor by email; we will scrape the email from the site if you don't surface one directly.

Return ONLY a JSON object with this exact shape:
{
  "agencies": [
    {"name": "Site or Blog Name", "author": "Author First and Last Name or null", "website": "real-domain.com", "email": "editor@real-domain.com or null", "city": null, "article": "https://real-domain.com/best-ai-clip-tools or null"}
  ]
}

Rules:
1. "website" is a fully-qualified web domain with a real TLD. It is NEVER:
   - a YouTube, Instagram, TikTok, Twitter/X, Facebook, LinkedIn, Medium, Substack, Reddit or Wikipedia URL
   - a handle, a slug, a string without a dot-TLD
   - a placeholder ("example.com", "your-domain", etc.)
2. "article" is the full URL of the specific relevant article or listing page on that site, or null if you only know the site.
3. "author" is the byline author of that article (a real person's name) when visible, or null. Never invent a name.
4. "email" is a real visible-on-the-website email if you know one. Otherwise null and we will scrape.
5. Prefer independent blogs, agency blogs and niche sites over huge publishers (no techcrunch, no forbes); mid-size sites actually update their listicles.
6. "website" must be the apex domain only (no https://, no www., no path). The "article" field carries the full URL instead.
7. Avoid duplicates of name OR website.

The outer "agencies" key name is required by the schema even though these are blogs/sites.

Bias toward HIGH RECALL: if a site plausibly fits, include it with email=null and a real website. Only exclude entries where the website itself is fake or clearly irrelevant to video/marketing/AI tools.`;
}

async function callSonar(prompt: string): Promise<LinkbuildingSearchResult> {
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
  const results: LinkbuildingResult[] = [];
  for (const a of raw) {
    if (typeof a !== "object" || a === null) continue;
    const obj = a as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : null;
    const website =
      typeof obj.website === "string" ? normalizeDomain(obj.website) : null;
    if (!name || !website) continue;
    // Suffix match so subdomains are caught too (filmora.wondershare.com).
    const isExcluded =
      EXCLUDED_DOMAINS.has(website) ||
      [...EXCLUDED_DOMAINS].some((d) => website.endsWith(`.${d}`));
    if (isExcluded) continue;
    const emailRaw =
      typeof obj.email === "string" && obj.email.includes("@")
        ? obj.email.trim().toLowerCase()
        : null;
    const email = emailRaw && !isPlaceholderEmail(emailRaw) ? emailRaw : null;
    const city = typeof obj.city === "string" ? obj.city.trim() : null;
    const articleUrl =
      typeof obj.article === "string" && obj.article.startsWith("http")
        ? obj.article.trim()
        : null;
    const author =
      typeof obj.author === "string" && obj.author.trim().length > 2
        ? obj.author.trim()
        : null;
    results.push({ name, website, email, city, articleUrl, author });
  }

  return {
    results,
    citations,
    rawContent: content,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}

export async function searchLinkbuildingSites(
  country: string,
  category: LinkbuildingCategory,
  options: { maxResults?: number; angle: string },
): Promise<LinkbuildingSearchResult> {
  const prompt = buildPrompt(country, category, options.maxResults ?? 15, options.angle);
  return callSonar(prompt);
}
