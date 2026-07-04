// Template para jornalistas independentes (indivíduos), Português Brasil.
// Tradução fiel de journalist-individual-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi ${esc(channelName)},</p><p>Sou ${esc(fromName)}, founder da Clipzi (clipzi.app). Transformamos entrevistas, lives, coberturas e podcasts em clipes prontos para Reels, TikTok e Shorts. Você sobe o vídeo, a IA encontra os melhores momentos, e você ajusta em um editor visual.</p><p>Você tem 2 vídeos grátis por mês para testar com sua próxima matéria ou programa. Se depois quiser mais volume ou funções extras, há planos pagos.</p><p>Se tiver interesse, montamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
