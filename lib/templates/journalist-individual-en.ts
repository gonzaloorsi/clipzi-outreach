// Template for independent journalists (individuals). Casual tone.
// Faithful translation of journalist-individual-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)},</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). We turn interviews, streams, reports and podcasts into clips ready for Reels, TikTok and Shorts. You upload the video, the AI finds the best moments, and you fine-tune them in a visual editor.</p><p>You get 2 free videos to try it with your next story or show. If you later want more volume or extra features, there are paid plans.</p><p>If it sounds interesting, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
