// Template for churches and ministries (English). Faithful translation of
// church-es.ts. The angle is reach of the message, not marketing.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)},</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). I saw you share your services on YouTube. A one-hour message holds 5 or 6 moments that can reach far more people on Reels, TikTok and Shorts, especially younger ones.</p><p>Clipzi finds those moments with AI, crops them vertical and adds captions, ready to publish. Whoever runs your social media doesn't need to know how to edit.</p><p>You get 2 free videos to try it with your next service. If it helps, there are plans for more volume.</p><p>If you're interested, we can set up something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
