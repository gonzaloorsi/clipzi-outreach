// search.list?q=... — keyword-driven discovery beyond trending.
// 100 quota units per call (vs 1 for trending), up to 50 results per call.
// Targets LONG-FORM, talk-heavy creators (videoDuration=long) across our niches
// and languages — the best fit for Clipzi (we clip long videos into shorts).
//
// Why this exists: the trending crawler re-scans the same ~8.9k trending channels
// every run (~120 qualified/day, tapped out). Search reaches net-new channels by
// niche + language, and we have ~47k spare YouTube units/day to spend on it.

import type { YouTubeClient, YtSearchResult } from "../youtube";

export type SearchOrder = "relevance" | "date" | "viewCount";

export interface SearchQuery {
  q: string;
  lang: string; // relevanceLanguage (ISO-639-1) — biases results, doesn't geo-lock
  niche: string; // for attribution / telemetry
}

// ─── Query pool ──────────────────────────────────────────────────────────────
// Niches chosen for Clipzi fit (long-form, hablado): podcasts/interviews,
// streamers/gaming, commentary/education. Languages match our send templates
// (es/en/pt/fr/de/it). Each query is paired with videoDuration=long downstream.
export const SEARCH_QUERIES: SearchQuery[] = [
  // ── Podcasts & interviews ──
  { q: "podcast", lang: "es", niche: "podcast" },
  { q: "entrevista", lang: "es", niche: "podcast" },
  { q: "podcast completo", lang: "es", niche: "podcast" },
  { q: "podcast", lang: "en", niche: "podcast" },
  { q: "interview", lang: "en", niche: "podcast" },
  { q: "full podcast episode", lang: "en", niche: "podcast" },
  { q: "podcast", lang: "pt", niche: "podcast" },
  { q: "entrevista", lang: "pt", niche: "podcast" },
  { q: "podcast", lang: "fr", niche: "podcast" },
  { q: "interview", lang: "fr", niche: "podcast" },
  { q: "podcast", lang: "de", niche: "podcast" },
  { q: "interview", lang: "de", niche: "podcast" },
  { q: "podcast", lang: "it", niche: "podcast" },
  { q: "intervista", lang: "it", niche: "podcast" },

  // ── Streamers & gaming (long VODs / full streams) ──
  { q: "gameplay español", lang: "es", niche: "gaming" },
  { q: "directo completo", lang: "es", niche: "gaming" },
  { q: "stream completo", lang: "es", niche: "gaming" },
  { q: "full gameplay", lang: "en", niche: "gaming" },
  { q: "twitch stream vod", lang: "en", niche: "gaming" },
  { q: "lets play full game", lang: "en", niche: "gaming" },
  { q: "gameplay português", lang: "pt", niche: "gaming" },
  { q: "live completa", lang: "pt", niche: "gaming" },
  { q: "gameplay français", lang: "fr", niche: "gaming" },
  { q: "let's play", lang: "fr", niche: "gaming" },
  { q: "gameplay deutsch", lang: "de", niche: "gaming" },
  { q: "let's play", lang: "de", niche: "gaming" },
  { q: "gameplay ita", lang: "it", niche: "gaming" },

  // ── Commentary & education (video essays, lectures, analysis) ──
  { q: "video ensayo", lang: "es", niche: "commentary" },
  { q: "análisis", lang: "es", niche: "commentary" },
  { q: "clase completa", lang: "es", niche: "commentary" },
  { q: "video essay", lang: "en", niche: "commentary" },
  { q: "commentary", lang: "en", niche: "commentary" },
  { q: "full lecture", lang: "en", niche: "commentary" },
  { q: "vídeo ensaio", lang: "pt", niche: "commentary" },
  { q: "análise", lang: "pt", niche: "commentary" },
  { q: "aula completa", lang: "pt", niche: "commentary" },
  { q: "essai vidéo", lang: "fr", niche: "commentary" },
  { q: "analyse", lang: "fr", niche: "commentary" },
  { q: "video essay", lang: "de", niche: "commentary" },
  { q: "erklärt", lang: "de", niche: "commentary" },
  { q: "analisi", lang: "it", niche: "commentary" },
  { q: "spiegazione", lang: "it", niche: "commentary" },
];

export interface SearchResult {
  channelIds: Set<string>;
  channelMeta: Map<string, { title?: string; lang?: string; niche?: string }>;
  quotaUsed: number;
  callsMade: number;
  queriesHit: string[];
  errors: string[];
}

export interface SearchOptions {
  queries?: SearchQuery[]; // defaults to a budget-sized slice picked by the caller
  order?: SearchOrder; // rotated per-run by the caller to surface different results
  maxQuota?: number; // hard ceiling (each call = 100 units)
  maxResultsPerCall?: number; // 1-50, default 50
}

/**
 * Run search.list for each query, collecting deduplicated channelIds + light
 * metadata for downstream enrichment. Each call costs 100 quota units.
 *
 * videoDuration=long restricts to >20min videos (type=video is required for it),
 * which is exactly the long-form content Clipzi turns into clips.
 */
export async function crawlSearch(
  yt: YouTubeClient,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const queries = opts.queries ?? SEARCH_QUERIES;
  const maxResults = opts.maxResultsPerCall ?? 50;
  const order = opts.order ?? "relevance";

  const channelIds = new Set<string>();
  const channelMeta = new Map<string, { title?: string; lang?: string; niche?: string }>();
  const queriesHit: string[] = [];
  const errors: string[] = [];

  let callsMade = 0;
  const quotaStart = yt.quotaUsed;

  for (const query of queries) {
    // Stop if we've hit the budget for this run.
    if (opts.maxQuota !== undefined && yt.quotaUsed - quotaStart >= opts.maxQuota) {
      break;
    }

    const params: Record<string, string | number> = {
      part: "snippet",
      type: "video",
      videoDuration: "long", // >20min — long-form, the Clipzi sweet spot
      q: query.q,
      relevanceLanguage: query.lang,
      order,
      maxResults,
      safeSearch: "none",
    };

    try {
      const data = await yt.call<YtSearchResult>("search", params);
      callsMade++;
      const tag = `${query.niche}:${query.lang}:${query.q}`;
      queriesHit.push(tag);

      for (const item of data.items ?? []) {
        const cid = item.snippet?.channelId ?? item.id?.channelId;
        if (!cid) continue;
        channelIds.add(cid);
        if (!channelMeta.has(cid)) {
          channelMeta.set(cid, {
            title: item.snippet?.channelTitle,
            lang: query.lang,
            niche: query.niche,
          });
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("QuotaExceededError") || msg.includes("All YouTube API keys")) {
        errors.push(`quota exhausted at ${query.niche}:${query.lang}:${query.q}`);
        break;
      }
      errors.push(`${query.niche}:${query.lang}:${query.q} → ${msg.slice(0, 120)}`);
    }
  }

  return {
    channelIds,
    channelMeta,
    quotaUsed: yt.quotaUsed - quotaStart,
    callsMade,
    queriesHit,
    errors,
  };
}
