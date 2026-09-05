// YouTube v2 (en). See youtube-hot-es.ts for the rationale and register.
// English "you" already covers a team inbox; no plural switch needed.

import type { TemplateBuilder } from "./types";
import { esc, formatThousands, shortTitle, signatureHtml, titleStub, SOCIAL_PROOF_CREATORS } from "./types";

export const build: TemplateBuilder = ({ fromName, hot }) => {
  const proof = formatThousands(SOCIAL_PROOF_CREATORS, "en");
  const title = esc(shortTitle(hot?.videoTitle ?? ""));

  let subject: string;
  let opener: string;

  if (hot?.source === "heatmap" && hot.mmss) {
    subject = `minute ${hot.mmss}`;
    const where = hot.label ? `, when "${esc(hot.label)}" starts` : "";
    const moments = hot.mmss2
      ? `the moments your audience replays most are ${hot.mmss}${where}${where ? "," : ""} and ${hot.mmss2}`
      : `the moment your audience replays most is ${hot.mmss}${where}`;
    const waiting = hot.mmss2 ? "That's two clips waiting for Shorts, Reels and TikTok." : "That's a clip waiting for Shorts, Reels and TikTok.";
    opener = `In case it's useful, in your video "${title}" ${moments}. ${waiting}`;
  } else if (hot?.source === "top_comment" && hot.label) {
    subject = titleStub(hot.videoTitle);
    opener = `In case it's useful, the top comment on your video "${title}" says: "${esc(hot.label)}". That moment is a clip that doesn't exist yet.`;
  } else {
    const perMonth = hot?.perMonth ?? 4;
    const avg = hot?.avgMinutes ?? 60;
    const clips = Math.max(10, Math.round(perMonth * (avg / 60) * 12));
    subject = `${clips} clips nobody is cutting`;
    opener = `In case it's useful, you publish ${perMonth} long ${perMonth === 1 ? "video" : "videos"} a month, ${avg} minutes each. Inside them are about ${clips} clips for Shorts, Reels and TikTok that nobody is cutting.`;
  }

  const html = [
    `<p>Hi,</p>`,
    `<p>${opener}</p>`,
    `<p>With Clipzi you upload the video, it flags those moments, you adjust them in the editor and five minutes later they come out captioned, ready to post. ${proof} creators already use it.</p>`,
    `<p>Try it free at clipzi.app with that video.</p>`,
    signatureHtml(fromName),
  ].join("");

  return { subject, html };
};
