// B2B template for photo/video studios and photographer associations.
// Faithful translation of photographer-org-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)} team,</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). We work with photo and video studios and photographer associations that produce hours of wedding, event and brand footage and need to turn it into clips to deliver to clients and to feed their own social channels.</p><p>Your team uploads the video, the AI finds the best moments, and you fine-tune them in a visual editor. Built for operations with several shooters and parallel projects.</p><p>We can open a trial workspace with credits so you can run a recent event through it. If it fits, we can talk about a multi-team plan with centralized billing.</p><p>If you're interested, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
