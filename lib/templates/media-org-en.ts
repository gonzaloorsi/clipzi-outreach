// B2B template for radios, podcast networks, and streaming-TV channels.
// Faithful translation of media-org-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)} team,</p><p>I'm ${esc(fromName)}, co-founder of Clipzi (https://clipzi.app/). We work with radios, podcast networks, and streaming channels that produce hours of recorded content per day and need to generate clips for Reels, TikTok, and Shorts.</p><p>Your team uploads the show video, the AI finds the best moments, and you fine-tune them in a visual editor. Built for multi-show operations with several hosts.</p><p>We can open a trial workspace with credits so you can run a recent show through the flow. If it fits, we talk multi-team plan with centralized billing.</p><p>If it sounds interesting, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Co-founder &amp; CEO, Clipzi</p>`,
});
