// Template para comediantes de stand-up (individuais), Português (Brasil).
// Tradução fiel de standup-individual-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi ${esc(channelName)},</p><p>Sou ${esc(fromName)}, founder da Clipzi (clipzi.app). Transformamos sets, especiais e podcasts de stand-up em clipes prontos para Reels, TikTok e Shorts. Você sobe o vídeo, a IA encontra as melhores tiradas, e finaliza num editor visual.</p><p>Liberamos 2 vídeos grátis por mês para você testar com o próximo material. Se depois quiser mais volume ou funções extras, tem planos pagos.</p><p>Se topar, montamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
