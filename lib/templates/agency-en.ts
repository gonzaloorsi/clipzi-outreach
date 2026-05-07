// B2B template for agencies — English.
// Faithful translation of agency-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)} team,</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). We work with agencies that manage creators and need to generate volume of clips for their clients.</p><p>Clipzi turns long-form videos into clips ready for TikTok, Reels, and Shorts. Your team uploads the video, the AI finds the best moments, and then you fine-tune them in a visual editor.</p><p>We can open a trial workspace with credits so you can run one of your clients through the flow. If it fits, we talk agency plan (multi-team, centralized billing).</p><p>If it sounds interesting, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
