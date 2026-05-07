// B2B template for stand-up schools, comedy clubs, festivals and production companies.
// Faithful translation of standup-org-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)} team,</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). We work with stand-up schools, comedy clubs, festivals and comedy production companies that need to generate volume of clips from their comedians for promo, social, and ticket sales.</p><p>Clipzi turns recordings of nights, workshops or specials into clips ready for Reels, TikTok and Shorts. Your team uploads the video, the AI finds the best punchlines, and you fine-tune them in a visual editor.</p><p>We can open a trial workspace with credits so you can run a recent recording through the flow. If it fits, we talk multi-team plan with centralized billing.</p><p>If it sounds interesting, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
