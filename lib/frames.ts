// The frame attached to the YouTube v2 cold email: the still at the second the
// audience replays most, with the replay curve drawn under it. Rendered by the
// clipzi Modal app (modal/app.py `frame_async`, ffmpeg + Pillow) and stored in
// R2 at a DETERMINISTIC key, so nothing needs a database column:
//   {FRAME_PUBLIC_BASE}/outreach/frames/{videoId}-{startS}.jpg
//
// hot-moments requests the render right after computing the heatmap (fire and
// forget, Modal answers 202 in <1s); the send cron fetches the JPEG ~20 minutes
// later and attaches it. Any failure means "no attachment", never "no email".
//
// Env: MODAL_FRAME_URL, MODAL_TOKEN_ID, MODAL_TOKEN_SECRET (same Modal
// workspace as clipzi), FRAME_PUBLIC_BASE (default https://clips.clipzi.cc).

import type { HeatmapMarker } from "./heatmap";

export interface EmailAttachment {
  filename: string;
  content: string; // base64
  contentType: string;
}

const CAPTION: Record<string, string> = {
  es: "Momento más repetido",
  en: "Most replayed",
  pt: "Momento mais repetido",
};

export function frameUrlFor(videoId: string, startS: number): string {
  const base = (process.env.FRAME_PUBLIC_BASE || "https://clips.clipzi.cc").replace(/\/$/, "");
  return `${base}/outreach/frames/${videoId}-${Math.round(startS)}.jpg`;
}

export function frameFilename(startS: number): string {
  const s = Math.max(0, Math.round(startS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const label = h ? `${h}-${String(m).padStart(2, "0")}-${String(sec).padStart(2, "0")}` : `${m}-${String(sec).padStart(2, "0")}`;
  return `minuto-${label}.jpg`;
}

/** Ask Modal to render (and store) the frame. Returns false when disabled or failed. */
export async function requestFrame(input: {
  videoId: string;
  startS: number;
  durationS: number;
  markers: HeatmapMarker[];
  language: string;
}): Promise<boolean> {
  const url = process.env.MODAL_FRAME_URL;
  const id = process.env.MODAL_TOKEN_ID;
  const secret = process.env.MODAL_TOKEN_SECRET;
  if (!url || !id || !secret) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "Modal-Key": id, "Modal-Secret": secret },
      body: JSON.stringify({
        videoId: input.videoId,
        startS: input.startS,
        durationS: input.durationS,
        markers: input.markers.map((m) => ({ startS: m.startS, intensity: m.intensity })),
        caption: CAPTION[input.language] ?? CAPTION.en,
      }),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the stored frame as an email attachment; null when it is not there (yet). */
export async function fetchFrameAttachment(videoId: string, startS: number): Promise<EmailAttachment | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(frameUrlFor(videoId, startS), { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5_000 || buf.length > 400_000) return null;
    return { filename: frameFilename(startS), content: buf.toString("base64"), contentType: "image/jpeg" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
