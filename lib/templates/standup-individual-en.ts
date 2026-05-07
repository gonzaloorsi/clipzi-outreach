// Template for individual stand-up comedians. Casual tone.
// Faithful translation of standup-individual-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)},</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). We turn stand-up sets, specials and podcasts into clips ready for Reels, TikTok and Shorts. You upload the video, the AI finds the best punchlines, and you fine-tune them in a visual editor.</p><p>You get 2 free videos per month to try it with your next set. If you later want more volume or extra features, there are paid plans.</p><p>If it sounds interesting, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
