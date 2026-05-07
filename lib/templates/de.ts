// Faithful translation of lib/templates/es.ts. Uses "ihr" form (informal
// plural-you) to match "ustedes" — fits creator culture better than formal "Sie".
//
// TODO: native German speaker review before scaling DE volume.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hallo Team von ${esc(channelName)},</p><p>Clipzi (clipzi.app) verwandelt lange Videos in Clips für TikTok, Reels und Shorts. Ihr ladet das Video hoch, die KI findet die besten Momente, und dann passt ihr es in einem visuellen Editor an.</p><p>Wir geben 2 kostenlose Videos pro Monat, damit ihr den Ablauf testen könnt. Wenn ihr danach mehr Nutzung oder mehr Funktionen braucht, gibt es Bezahlpläne.</p><p>Falls Interesse besteht, können wir etwas Spezifisches für ${esc(channelName)} zusammenstellen.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
