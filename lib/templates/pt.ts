// Faithful translation of lib/templates/es.ts. Brazilian "vocês" to match the
// "ustedes" plural-you form.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi equipe da ${esc(channelName)},</p><p>Clipzi (clipzi.app) transforma vídeos longos em clipes para TikTok, Reels e Shorts. Vocês sobem o vídeo, a IA encontra os melhores momentos, e depois ajustam num editor visual.</p><p>Damos 2 vídeos grátis por mês para testar o fluxo. Se depois precisarem de mais uso ou mais funcionalidades, tem planos pagos.</p><p>Se tiverem interesse, podemos fazer algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
