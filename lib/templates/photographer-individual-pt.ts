// Template para fotógrafos e videomakers (indivíduos), Português Brasil.
// Tradução fiel de photographer-individual-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi ${esc(channelName)},</p><p>Sou ${esc(fromName)}, founder da Clipzi (clipzi.app). Trabalhamos com fotógrafos e videomakers que filmam horas de vídeo em casamentos e eventos. Você sobe o material, a IA encontra os melhores momentos, e você os transforma em clipes prontos para entregar ao cliente e para divulgar seu trabalho em Reels, TikTok e Shorts.</p><p>Você tem 2 vídeos grátis para testar com seu próximo evento. Se depois quiser mais volume ou funções extras, há planos pagos.</p><p>Se tiver interesse, montamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
