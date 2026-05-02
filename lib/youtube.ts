// YouTube Data API v3 client with multi-key rotation.
// Each YT key has 10K daily quota. We rotate keys on quota exceeded so a single
// run can consume the union of all keys' quota.

const API_BASE = "https://www.googleapis.com/youtube/v3";

const KEYS = [
  process.env.YOUTUBE_API_KEY,
  process.env.YOUTUBE_API_KEY_2,
  process.env.YOUTUBE_API_KEY_3,
  process.env.YOUTUBE_API_KEY_4,
  process.env.YOUTUBE_API_KEY_5,
  process.env.YOUTUBE_API_KEY_6,
  process.env.YOUTUBE_API_KEY_7,
  process.env.YOUTUBE_API_KEY_8,
  process.env.YOUTUBE_API_KEY_9,
  process.env.YOUTUBE_API_KEY_10,
].filter((k): k is string => Boolean(k));

export const QUOTA_PER_KEY = 10_000;
export const TOTAL_QUOTA = KEYS.length * QUOTA_PER_KEY;

// Quota costs (per Google docs)
export const QUOTA_COST = {
  search: 100,
  videos: 1,
  channels: 1,
  commentThreads: 1,
  activities: 1,
} as const;

export class QuotaExceededError extends Error {
  constructor(message = "All YouTube API keys exhausted") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

// Tracks state across a single discovery run.
export class YouTubeClient {
  private keyIndex = 0;
  public quotaUsed = 0;

  constructor(private readonly keys: string[] = KEYS) {
    if (keys.length === 0) {
      throw new Error("No YOUTUBE_API_KEY env vars found");
    }
  }

  get keyCount(): number {
    return this.keys.length;
  }

  get currentKey(): string {
    return this.keys[this.keyIndex];
  }

  private rotateKey(): boolean {
    if (this.keyIndex + 1 < this.keys.length) {
      this.keyIndex++;
      return true;
    }
    return false;
  }

  async call<T = unknown>(
    endpoint: keyof typeof QUOTA_COST,
    params: Record<string, string | number>,
  ): Promise<T> {
    const url = new URL(`${API_BASE}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    url.searchParams.set("key", this.currentKey);

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      // Quota exceeded → try next key, retry once. Google does NOT charge a
      // quota unit for the rejected request when it's a quotaExceeded denial,
      // so we don't add anything before rotating.
      if (
        res.status === 403 &&
        (body.includes("quotaExceeded") || body.includes("quota"))
      ) {
        if (this.rotateKey()) {
          return this.call<T>(endpoint, params);
        }
        throw new QuotaExceededError();
      }
      // Per Google docs, every other request (4xx like videoChartNotFound,
      // 5xx server errors, malformed requests) costs at least 1 quota unit.
      this.quotaUsed += 1;
      throw new Error(
        `YouTube API ${endpoint} ${res.status}: ${body.slice(0, 300)}`,
      );
    }

    this.quotaUsed += QUOTA_COST[endpoint];
    return (await res.json()) as T;
  }
}

// ─── Typed wrappers (just the endpoints we need) ───────────────────────────

export interface YtSearchResult {
  items?: Array<{
    id?: { videoId?: string; channelId?: string };
    snippet?: {
      channelId?: string;
      channelTitle?: string;
      title?: string;
      publishedAt?: string;
    };
  }>;
  nextPageToken?: string;
  pageInfo?: { totalResults?: number };
}

export interface YtVideosResult {
  items?: Array<{
    id?: string;
    snippet?: {
      channelId?: string;
      channelTitle?: string;
      title?: string;
      categoryId?: string;
      defaultLanguage?: string;
      defaultAudioLanguage?: string;
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
  }>;
  nextPageToken?: string;
}

export interface YtChannelsResult {
  items?: Array<{
    id: string;
    snippet?: {
      title?: string;
      description?: string;
      country?: string;
      defaultLanguage?: string;
      publishedAt?: string;
    };
    statistics?: {
      subscriberCount?: string;
      videoCount?: string;
      viewCount?: string;
      hiddenSubscriberCount?: boolean;
    };
    topicDetails?: {
      topicCategories?: string[];
    };
    brandingSettings?: {
      channel?: {
        country?: string;
        defaultLanguage?: string;
      };
    };
  }>;
}

export interface YtCommentThreadsResult {
  items?: Array<{
    snippet?: {
      topLevelComment?: {
        snippet?: {
          authorChannelId?: { value?: string };
          authorDisplayName?: string;
        };
      };
    };
  }>;
  nextPageToken?: string;
}
