// Template for linkbuilding: marketing/SEO blogs, listicle authors and tool
// directories. Research-driven pitch: reference the SPECIFIC article when we
// have it (measurable reply lift), lead with editorial value (most tools in
// these lists are paid; Clipzi has a real free plan their readers can start
// with), offer free Creator access + ready-made blurb. One micro-CTA.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName, article }) => {
  const ref = article
    ? `your article at ${esc(article)}`
    : `your coverage of AI video and clipping tools`;
  return {
    subject: `${channelName} x Clipzi`,
    html: `<p>Hi ${esc(channelName)},</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). I read ${ref} and noticed almost every tool in these lists is paid.</p><p>Clipzi turns long videos and podcasts into short viral clips with AI, and it has a real free plan (2 videos a month, no card needed). For your readers it's the easiest way to actually try this category.</p><p>I can send you free Creator access to test it yourself, plus a short blurb and screenshots so adding it takes five minutes.</p><p>Want me to send that over?</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
  };
};
