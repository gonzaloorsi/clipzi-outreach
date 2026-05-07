// Faithful translation of lib/templates/es.ts (the source of truth — legacy
// copy). Plural-you to match "ustedes". URL plain text in parens.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)} team,</p><p>Clipzi (clipzi.app) turns long-form videos into clips for TikTok, Reels and Shorts. You upload the video, the AI finds the best moments, and then you fine-tune it in a visual editor.</p><p>We give 2 free videos per month so you can try the flow. If you later need more usage or more features, there are paid plans.</p><p>If it sounds interesting, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
