// "Most replayed" moment for a channel's best target video.
//
// YouTube shows a replay heatmap above the progress bar of any video with
// enough views. The official Data API does not expose it; the web player gets
// it from InnerTube (`/youtubei/v1/next`), which answers a plain POST with no
// API key. We read it once per channel, right before the cold email goes out,
// so the first line can name the exact second the audience keeps rewinding to.
//
// Verified 2026-09-05 with yjwazQE1uvI (Facundo Cabral): 100 markers of 21s,
// peak 31:03 (1.00) = start of "No soy de aquí, ni soy de allá", second 26:49
// (0.81), everything else < 0.05. The ANDROID client returns 400; WEB works.
//
// Fallback ladder when the heatmap is missing (small channels, fresh videos):
//   heatmap → top comment (Data API, 1 unit) → cadence (long uploads/month).
// Chapters (timestamps in the description) only LABEL a heatmap peak; on their
// own they are not a hook.
//
// Risks: undocumented endpoint (can change without notice), IP rate limits at
// volume. Both are mitigated by caching the result on `channels` and by
// processing only the rows about to be sent.

import type {
  YouTubeClient,
  YtPlaylistItemsResult,
  YtVideosResult,
  YtCommentThreadsResult,
} from "./youtube";

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/next?prettyPrint=false";
const WEB_CLIENT_VERSION = "2.20250901.00.00";
const WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export const LONG_VIDEO_MIN_S = 20 * 60;
const RECENT_DAYS = 30;
const CATALOG_DAYS = 365;

export interface HeatmapMarker {
  startS: number;
  durationS: number;
  intensity: number; // 0..1, normalized by YouTube (max marker = 1)
}

export interface HotWindow {
  start: number;
  end: number;
  peak: number;
}

export interface Chapter {
  start: number;
  title: string;
}

export interface TargetVideo {
  videoId: string;
  title: string;
  description: string;
  durationS: number;
  publishedAt: string; // ISO
  viewCount: number;
}

export type HotSource = "heatmap" | "top_comment" | "cadence";

export interface HotMoment {
  source: HotSource;
  video: TargetVideo;
  startS: number | null;
  start2S: number | null;
  label: string | null; // chapter title at the peak (heatmap) or comment text
  perMonth: number | null; // cadence: long uploads per month
  avgMinutes: number | null; // cadence: average long-video length
  markers: HeatmapMarker[] | null; // heatmap source only: feeds the frame render (lib/frames.ts)
}

// ─── InnerTube ──────────────────────────────────────────────────────────────

interface InnerTubeMarker {
  startMillis?: string | number;
  durationMillis?: string | number;
  intensityScoreNormalized?: number;
}

/**
 * Fetch the replay heatmap for a video. Returns null when the video has no
 * heatmap (too few views) or InnerTube did not answer. Never throws.
 */
export async function fetchHeatmap(
  videoId: string,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<HeatmapMarker[] | null> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 1;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(INNERTUBE_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "X-YouTube-Client-Name": "1",
          "X-YouTube-Client-Version": WEB_CLIENT_VERSION,
          "User-Agent": WEB_UA,
          "Accept-Language": "en-US,en;q=0.9",
        },
        body: JSON.stringify({
          context: {
            client: { clientName: "WEB", clientVersion: WEB_CLIENT_VERSION, hl: "en", gl: "US" },
          },
          videoId,
        }),
      });
      if (res.status >= 500 && attempt < retries) continue;
      if (!res.ok) return null;
      const json = (await res.json()) as {
        frameworkUpdates?: {
          entityBatchUpdate?: {
            mutations?: Array<{
              payload?: {
                macroMarkersListEntity?: {
                  markersList?: { markerType?: string; markers?: InnerTubeMarker[] };
                };
              };
            }>;
          };
        };
      };
      const mutations = json.frameworkUpdates?.entityBatchUpdate?.mutations ?? [];
      for (const m of mutations) {
        const list = m.payload?.macroMarkersListEntity?.markersList;
        if (list?.markerType !== "MARKER_TYPE_HEATMAP") continue;
        const markers = (list.markers ?? [])
          .map((k) => ({
            startS: Number(k.startMillis ?? 0) / 1000,
            durationS: Number(k.durationMillis ?? 0) / 1000,
            intensity: Number(k.intensityScoreNormalized ?? 0),
          }))
          .filter((k) => Number.isFinite(k.startS) && Number.isFinite(k.intensity));
        return markers.length > 0 ? markers : null;
      }
      return null;
    } catch {
      if (attempt >= retries) return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Merge the top-intensity markers into up to `maxWindows` contiguous windows,
 * strongest first. Returns [] for flat heatmaps (no real peak: when more than
 * `flatShare` of the markers sit above 0.5 the audience is not rewinding
 * anywhere in particular, and naming a second would be a lie).
 */
const INTRO_SKIP_S = 15;

export function pickHotWindows(
  markers: HeatmapMarker[],
  opts: { topPct?: number; maxWindows?: number; flatShare?: number } = {},
): HotWindow[] {
  const topPct = opts.topPct ?? 0.1;
  const maxWindows = opts.maxWindows ?? 2;
  const flatShare = opts.flatShare ?? 0.3;
  if (markers.length < 10) return [];
  const above = markers.filter((m) => m.intensity >= 0.5).length;
  if (above / markers.length > flatShare) return [];

  const sorted = [...markers].sort((a, b) => b.intensity - a.intensity);
  const threshold = sorted[Math.max(0, Math.floor(markers.length * topPct) - 1)].intensity;
  // The first seconds always spike (everyone watches the start); that is not
  // a moment worth quoting, so windows opening inside the intro are dropped.
  const hot = markers
    .filter((m) => m.intensity >= threshold && m.startS >= INTRO_SKIP_S)
    .sort((a, b) => a.startS - b.startS);

  const windows: HotWindow[] = [];
  for (const m of hot) {
    const last = windows[windows.length - 1];
    if (last && m.startS <= last.end + 1) {
      last.end = m.startS + m.durationS;
      last.peak = Math.max(last.peak, m.intensity);
    } else {
      windows.push({ start: m.startS, end: m.startS + m.durationS, peak: m.intensity });
    }
  }
  windows.sort((a, b) => b.peak - a.peak);
  // The second window only counts when it is a real second peak, not noise.
  return windows.filter((w, i) => i === 0 || w.peak >= 0.5).slice(0, maxWindows);
}

// ─── Chapters (labels for a peak) ───────────────────────────────────────────

const TS_LINE_RE = /^\s*(?:[-–•*]\s*)?(?:\(?\[?)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\)?\]?)\s*[-–:.)]?\s*(.+?)\s*$/;
const GENERIC_CHAPTER_RE =
  /^(intro(ducci[oó]n|duction)?|inicio|start|bienvenid[ao]s?|welcome|presentaci[oó]n|apertura|opening|outro|cierre|despedida|closing|final|end|cr[eé]ditos|credits|untitled.*|cap[ií]tulo\s*\d+|chapter\s*\d+|parte\s*\d+|part\s*\d+)$/i;

export function parseTimestamp(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

/** Timestamped lines in a description ("05:57 Vengo de un lugar"). */
export function parseChapters(description: string | null | undefined): Chapter[] {
  if (!description) return [];
  const out: Chapter[] = [];
  for (const raw of description.split(/\r?\n/)) {
    const m = raw.match(TS_LINE_RE);
    if (!m) continue;
    const start = parseTimestamp(m[1]);
    const title = m[2].replace(/^["“'«]+|["”'»]+$/g, "").trim();
    if (!Number.isFinite(start) || title.length < 2 || title.length > 80) continue;
    if (/https?:\/\//i.test(title)) continue;
    out.push({ start, title });
  }
  out.sort((a, b) => a.start - b.start);
  return out.length >= 2 ? out : [];
}

/** Chapter active at `startS`, unless it is a generic label (intro, part 2). */
export function labelMoment(startS: number, chapters: Chapter[]): string | null {
  let active: Chapter | null = null;
  for (const c of chapters) {
    if (c.start <= startS + 1) active = c;
    else break;
  }
  if (!active) return null;
  if (GENERIC_CHAPTER_RE.test(active.title.trim())) return null;
  return active.title;
}

export function formatMmss(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

// ─── Target video (Data API) ────────────────────────────────────────────────

export function parseIsoDuration(iso: string | undefined): number {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, mi, s] = m;
  return (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(mi ?? 0) * 60) + Number(s ?? 0);
}

/**
 * The channel's recent uploads with durations (2 quota units). `UC...` channel
 * ids map to the `UU...` uploads playlist with no extra call.
 */
export async function listRecentUploads(
  yt: YouTubeClient,
  channelId: string,
  maxResults = 25,
): Promise<TargetVideo[]> {
  if (!channelId.startsWith("UC")) return [];
  const uploadsPlaylist = `UU${channelId.slice(2)}`;
  let items: YtPlaylistItemsResult;
  try {
    items = await yt.call<YtPlaylistItemsResult>("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylist,
      maxResults,
    });
  } catch (e) {
    // Playlist 404s for terminated channels or channels with no uploads.
    if (e instanceof Error && e.name === "QuotaExceededError") throw e;
    return [];
  }
  const ids = (items.items ?? [])
    .map((it) => it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const videos = await yt.call<YtVideosResult>("videos", {
    part: "snippet,contentDetails,statistics",
    id: ids.join(","),
    maxResults: 50,
  });
  return (videos.items ?? [])
    .map((v) => ({
      videoId: v.id ?? "",
      title: v.snippet?.title ?? "",
      description: v.snippet?.description ?? "",
      durationS: parseIsoDuration(v.contentDetails?.duration),
      publishedAt: v.snippet?.publishedAt ?? "",
      viewCount: Number(v.statistics?.viewCount ?? 0),
    }))
    .filter((v) => v.videoId && v.title && v.publishedAt);
}

/**
 * Which video to talk about: the latest long upload of the last 30 days
 * (creators posting weekly), else the most viewed long video of the last year
 * (catalog channels), else the most viewed long video at all. Null when the
 * channel has no long-form uploads: nothing to clip, wrong prospect.
 */
export function pickTargetVideo(uploads: TargetVideo[], now = new Date()): TargetVideo | null {
  const long = uploads.filter((v) => v.durationS >= LONG_VIDEO_MIN_S);
  if (long.length === 0) return null;
  const ageDays = (v: TargetVideo) => (now.getTime() - new Date(v.publishedAt).getTime()) / 86_400_000;
  const recent = long.filter((v) => ageDays(v) <= RECENT_DAYS).sort((a, b) => ageDays(a) - ageDays(b));
  if (recent.length > 0) return recent[0];
  const year = long.filter((v) => ageDays(v) <= CATALOG_DAYS).sort((a, b) => b.viewCount - a.viewCount);
  if (year.length > 0) return year[0];
  return [...long].sort((a, b) => b.viewCount - a.viewCount)[0];
}

/** Long uploads per month and their average length, from the recent uploads. */
export function cadenceFromUploads(uploads: TargetVideo[], now = new Date()): { perMonth: number; avgMinutes: number } | null {
  const long = uploads.filter((v) => v.durationS >= LONG_VIDEO_MIN_S);
  if (long.length < 2) return null;
  const times = long.map((v) => new Date(v.publishedAt).getTime()).sort((a, b) => a - b);
  const spanDays = Math.max(7, (now.getTime() - times[0]) / 86_400_000);
  const perMonth = Math.round((long.length / spanDays) * 30);
  const avgMinutes = Math.round(long.reduce((a, v) => a + v.durationS, 0) / long.length / 60);
  if (perMonth < 1) return null;
  return { perMonth, avgMinutes };
}

// ─── Top comment (Data API, 1 unit) ─────────────────────────────────────────

const COMMENT_MIN_LIKES = 10;

export async function fetchTopComment(yt: YouTubeClient, videoId: string): Promise<string | null> {
  let res: YtCommentThreadsResult;
  try {
    res = await yt.call<YtCommentThreadsResult>("commentThreads", {
      part: "snippet",
      videoId,
      order: "relevance",
      maxResults: 10,
      textFormat: "plainText",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "QuotaExceededError") throw e;
    return null; // comments disabled
  }
  const candidates = (res.items ?? [])
    .map((it) => it.snippet?.topLevelComment?.snippet)
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ text: (s.textOriginal ?? s.textDisplay ?? "").replace(/\s+/g, " ").trim(), likes: s.likeCount ?? 0 }))
    .filter((c) => c.likes >= COMMENT_MIN_LIKES && c.text.length >= 20 && c.text.length <= 140)
    .filter((c) => !/https?:\/\/|@|#/.test(c.text))
    .sort((a, b) => b.likes - a.likes);
  return candidates[0]?.text ?? null;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * heatmap → top comment → cadence. Null when the channel has no long-form
 * uploads (the caller still stamps hot_checked_at so it is never retried).
 * Quota: 2 units (uploads + videos) + 1 for the comment fallback.
 */
export async function computeHotMoment(yt: YouTubeClient, channelId: string): Promise<HotMoment | null> {
  const uploads = await listRecentUploads(yt, channelId);
  const video = pickTargetVideo(uploads);
  if (!video) return null;

  const markers = await fetchHeatmap(video.videoId);
  if (markers) {
    const windows = pickHotWindows(markers);
    if (windows.length > 0) {
      const chapters = parseChapters(video.description);
      return {
        source: "heatmap",
        video,
        startS: windows[0].start,
        start2S: windows[1]?.start ?? null,
        label: labelMoment(windows[0].start, chapters),
        perMonth: null,
        avgMinutes: null,
        markers,
      };
    }
  }

  const comment = await fetchTopComment(yt, video.videoId);
  if (comment) {
    return { source: "top_comment", video, startS: null, start2S: null, label: comment, perMonth: null, avgMinutes: null, markers: null };
  }

  const cadence = cadenceFromUploads(uploads);
  if (cadence) {
    return { source: "cadence", video, startS: null, start2S: null, label: null, ...cadence, markers: null };
  }
  return null;
}
