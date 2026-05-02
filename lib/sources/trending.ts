// videos.list?chart=mostPopular per regionCode × videoCategoryId.
// 1 quota unit per call. Naturally fresh (changes daily).
//
// Strategy: prioritize high-creator-economy regions first, cycle through
// productive categories (ones with creators that fit Clipzi: long-form,
// podcast-y, talkative). Skip music/news (mostly major labels / outlets).

import type { YouTubeClient, YtVideosResult } from "../youtube";

// Region codes ranked by creator economy / TAM-fit.
// Order matters when budget is tight.
export const TRENDING_REGIONS = [
  // English-speaking core
  "US", "GB", "CA", "AU", "IE", "NZ",
  // Spanish-speaking (legacy core)
  "MX", "AR", "CO", "CL", "PE", "ES", "EC", "VE", "UY", "PY", "BO", "CR", "PA", "DO", "GT",
  // Portuguese
  "BR", "PT",
  // Western Europe
  "DE", "FR", "IT", "NL", "SE", "DK", "NO", "FI", "BE", "AT", "CH",
  // Asia-Pacific (high creator activity)
  "ID", "PH", "IN", "MY", "TH", "VN", "JP", "KR", "TW", "HK", "SG",
  // Eastern Europe
  "PL", "CZ", "RO", "HU", "GR", "TR", "UA",
  // Middle East
  "SA", "AE", "EG", "IL",
  // Africa (rising creator markets)
  "ZA", "NG", "KE", "GH",
] as const;

// Category IDs that map to creators we want to reach.
// Skip: 10 (Music — mostly labels), 25 (News — outlets), 19 (Travel — small)
// Prioritize: 22 (People & Blogs), 24 (Entertainment), 20 (Gaming), 26 (Howto), 27 (Education), 28 (Science & Tech), 17 (Sports), 23 (Comedy), 15 (Pets), 29 (Nonprofits — sometimes hits creator-led)
export const TRENDING_CATEGORIES = [
  "22", // People & Blogs (vlogs, podcasters)
  "24", // Entertainment
  "20", // Gaming
  "26", // Howto & Style
  "27", // Education
  "28", // Science & Technology
  "17", // Sports
  "23", // Comedy
  "1",  // Film & Animation
  "15", // Pets & Animals
];

// "" = no category filter (always valid in every region — gets global trending).
// Specific category IDs vary per region (e.g. id 28 may not exist in BR), so
// per Google docs (https://developers.google.com/youtube/v3/docs/videoCategories/list)
// the proper way is to call videoCategories.list per regionCode and cache results.
// For now we lead each region with the universal "" call so we always get data,
// then attempt the specific categories as bonus diversification.
export const TRENDING_CATEGORIES_ALL: string[] = ["", ...TRENDING_CATEGORIES];

export interface TrendingResult {
  channelIds: Set<string>;
  channelMeta: Map<string, { title?: string; categoryId?: string; defaultLanguage?: string }>;
  quotaUsed: number;
  callsMade: number;
  regionsHit: string[];
  errors: string[];
}

export interface TrendingOptions {
  regions?: readonly string[];
  categories?: readonly string[];
  maxQuota?: number; // hard ceiling
  maxResultsPerCall?: number; // 1-50, default 50
  pagesPerCombo?: number; // default 1 (no pagination — first page is enough fresh)
}

/**
 * Crawl trending videos across regions × categories. Each call costs 1 quota unit.
 * Returns deduplicated channelIds + light metadata for downstream enrichment.
 */
export async function crawlTrending(
  yt: YouTubeClient,
  opts: TrendingOptions = {},
): Promise<TrendingResult> {
  const regions = opts.regions ?? TRENDING_REGIONS;
  const categories = opts.categories ?? TRENDING_CATEGORIES_ALL;
  const maxResults = opts.maxResultsPerCall ?? 50;
  const pages = opts.pagesPerCombo ?? 1;

  const channelIds = new Set<string>();
  const channelMeta = new Map<
    string,
    { title?: string; categoryId?: string; defaultLanguage?: string }
  >();
  const regionsHit: string[] = [];
  const errors: string[] = [];

  let callsMade = 0;
  const quotaStart = yt.quotaUsed;

  outer: for (const region of regions) {
    for (const categoryId of categories) {
      // Stop if we've hit the budget for this run
      if (opts.maxQuota !== undefined && yt.quotaUsed - quotaStart >= opts.maxQuota) {
        break outer;
      }

      let pageToken: string | undefined;
      for (let page = 0; page < pages; page++) {
        const params: Record<string, string | number> = {
          part: "snippet,statistics",
          chart: "mostPopular",
          regionCode: region,
          maxResults,
        };
        if (categoryId) params.videoCategoryId = categoryId;
        if (pageToken) params.pageToken = pageToken;

        try {
          const data = await yt.call<YtVideosResult>("videos", params);
          callsMade++;
          if (!regionsHit.includes(region)) regionsHit.push(region);

          for (const item of data.items ?? []) {
            const cid = item.snippet?.channelId;
            if (!cid) continue;
            channelIds.add(cid);
            if (!channelMeta.has(cid)) {
              channelMeta.set(cid, {
                title: item.snippet?.channelTitle,
                categoryId: item.snippet?.categoryId,
                defaultLanguage:
                  item.snippet?.defaultLanguage ??
                  item.snippet?.defaultAudioLanguage,
              });
            }
          }

          pageToken = data.nextPageToken;
          if (!pageToken) break;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          // Some category/region combos are simply not available — that's a 400
          // "videoChartNotFound" and we should skip silently rather than abort.
          if (msg.includes("videoChartNotFound") || msg.includes("400")) {
            break;
          }
          if (msg.includes("QuotaExceededError") || msg.includes("All YouTube API keys")) {
            errors.push(`quota exhausted at ${region}:${categoryId || "ALL"}`);
            break outer;
          }
          errors.push(`${region}:${categoryId || "ALL"} → ${msg.slice(0, 120)}`);
          break; // skip remaining pages for this combo
        }
      }
    }
  }

  return {
    channelIds,
    channelMeta,
    quotaUsed: yt.quotaUsed - quotaStart,
    callsMade,
    regionsHit,
    errors,
  };
}
