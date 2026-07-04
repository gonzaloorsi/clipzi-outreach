// B2B template for press unions, journalist associations, press clubs and
// journalism schools. Faithful translation of journalist-org-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hi ${esc(channelName)} team,</p><p>I'm ${esc(fromName)}, founder of Clipzi (clipzi.app). We work with press associations, journalist unions and journalism schools that record talks, panels, trainings and conferences and need to turn them into clips for social.</p><p>Your team uploads the video, the AI finds the best moments, and you fine-tune them in a visual editor. It also works as a member benefit: each journalist can clip their own content.</p><p>We can open a trial workspace with credits so you can run a recent recording through it. If it fits, we can talk about a multi-team plan with centralized billing.</p><p>If you're interested, we can put together something specific for ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
