// Template for photographers and videographers (individuals). Casual tone.
// Faithful translation of photographer-individual-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)},</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). We work with photographers and videographers who shoot hours of video at weddings and events. You upload the footage, the AI finds the best moments, and you turn them into clips ready to deliver to your client and to promote your work on Reels, TikTok and Shorts.</p><p>You get 2 free videos to try it with your next event. If you later want more volume or extra features, there are paid plans.</p><p>If it sounds interesting, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
