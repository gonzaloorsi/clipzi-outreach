// Renders the YouTube v2 email for one channel or one video, using the real
// enrich (InnerTube heatmap + Data API) and the real templates. Nothing is
// written or sent. Use it before touching copy or when a channel's email
// looks off.
//
//   npx tsx scripts/preview-hot-email.ts UCGQrmIJUUY-OliERiaK92tA        # channel id
//   npx tsx scripts/preview-hot-email.ts yjwazQE1uvI --video --lang es    # one video
//   flags: --lang es|en|pt  --to info@x.com  --country AR

import { config } from "dotenv";
config({ path: ".env.local" });

import { YouTubeClient } from "../lib/youtube";
import { computeHotMoment, fetchHeatmap, pickHotWindows, parseChapters, labelMoment, formatMmss } from "../lib/heatmap";
import type { HotMoment } from "../lib/heatmap";
import { htmlToPlainText } from "../lib/email";
import { build as hotEs } from "../lib/templates/youtube-hot-es";
import { build as hotEn } from "../lib/templates/youtube-hot-en";
import { build as hotPt } from "../lib/templates/youtube-hot-pt";
import { build as qEs } from "../lib/templates/youtube-question-es";
import { build as qEn } from "../lib/templates/youtube-question-en";
import { build as qPt } from "../lib/templates/youtube-question-pt";
import type { HotInput } from "../lib/templates/types";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
if (!id) {
  console.error("usage: npx tsx scripts/preview-hot-email.ts <channelId|videoId> [--video] [--lang es] [--to x@y] [--country AR]");
  process.exit(1);
}
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const isVideo = args.includes("--video");
const lang = (flag("lang") ?? "es") as "es" | "en" | "pt";
const to = flag("to") ?? "creator@example.com";
const country = flag("country") ?? (lang === "es" ? "AR" : lang === "pt" ? "BR" : "US");
const fromName = process.env.SENDER_NAME ?? "Gonzalo Orsi";

const yt = new YouTubeClient(process.env.YOUTUBE_API_KEY_1 ? undefined : ["missing-key"]);
let hot: HotMoment | null;
if (isVideo) {
  // One video: skip the channel-level pick, read heatmap + chapters directly.
  // Data API for title + description (chapters). When no valid key is around
  // (local runs: the keys live in Vercel), fall back to public oEmbed for the
  // title; chapters are then unavailable and the label stays null.
  let item: { snippet?: { title?: string; description?: string; publishedAt?: string }; statistics?: { viewCount?: string } } | undefined;
  try {
    const v = await yt.call<{ items?: Array<typeof item> }>("videos", { part: "snippet,contentDetails,statistics", id });
    item = v.items?.[0];
  } catch (e) {
    console.warn("Data API unavailable, using oEmbed for the title:", e instanceof Error ? e.message.split("\n")[0] : e);
    const o = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`).then((r) => r.json());
    item = { snippet: { title: o.title, description: "", publishedAt: "" } };
  }
  if (!item) throw new Error(`video ${id} not found`);
  const markers = await fetchHeatmap(id);
  const windows = markers ? pickHotWindows(markers) : [];
  const chapters = parseChapters(item.snippet?.description);
  console.log(`heatmap markers: ${markers?.length ?? 0}, windows: ${windows.map((w) => `${formatMmss(w.start)} (${w.peak.toFixed(2)})`).join(", ") || "none"}, chapters: ${chapters.length}`);
  hot = windows.length
    ? {
        source: "heatmap",
        video: { videoId: id, title: item.snippet?.title ?? "", description: item.snippet?.description ?? "", durationS: 0, publishedAt: item.snippet?.publishedAt ?? "", viewCount: Number(item.statistics?.viewCount ?? 0) },
        startS: windows[0].start,
        start2S: windows[1]?.start ?? null,
        label: labelMoment(windows[0].start, chapters),
        perMonth: null,
        avgMinutes: null,
        markers,
      }
    : null;
} else {
  hot = await computeHotMoment(yt, id);
}

console.log("hot:", hot ? { source: hot.source, video: hot.video.title, mmss: hot.startS != null ? formatMmss(hot.startS) : null, mmss2: hot.start2S != null ? formatMmss(hot.start2S) : null, label: hot.label, perMonth: hot.perMonth, avgMinutes: hot.avgMinutes } : null);
console.log("quota used:", yt.quotaUsed);

const hotInput: HotInput | undefined = hot
  ? {
      source: hot.source,
      videoTitle: hot.video.title,
      mmss: hot.startS != null ? formatMmss(hot.startS) : null,
      mmss2: hot.start2S != null ? formatMmss(hot.start2S) : null,
      label: hot.label,
      perMonth: hot.perMonth,
      avgMinutes: hot.avgMinutes,
    }
  : undefined;

const builder = hotInput
  ? { es: hotEs, en: hotEn, pt: hotPt }[lang]
  : { es: qEs, en: qEn, pt: qPt }[lang];
const { subject, html } = builder({ channelName: "Demo Channel", fromName, toEmail: to, country, hot: hotInput });
const text = htmlToPlainText(html);
const words = text.split(/\s+/).filter(Boolean).length;
console.log("\n──── subject:", subject.toLowerCase());
console.log("──── body (" + words + " words):\n");
console.log(text);
console.log("\n──── checks:", { emDash: /[—–]/.test(text), link: /https?:\/\//.test(text), price: /\$\s?\d/.test(text), underEighty: words < 80 });
