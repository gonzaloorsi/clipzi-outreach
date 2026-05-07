// Template B2B para escolas de stand-up, comedy clubs, festivais e produtoras (Português Brasil).
// Tradução fiel de standup-org-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi equipe da ${esc(channelName)},</p><p>Sou ${esc(fromName)}, founder da Clipzi (clipzi.app). Trabalhamos com escolas, comedy clubs, festivais e produtoras de stand-up que precisam gerar volume de clipes dos seus comediantes para divulgação, redes e venda de ingressos.</p><p>A Clipzi transforma gravações de noites, workshops ou especiais em clipes prontos para Reels, TikTok e Shorts. O time sobe o vídeo, a IA encontra as melhores tiradas, e vocês ajustam em um editor visual.</p><p>Abrimos um workspace de teste com créditos para vocês rodarem uma gravação recente pelo fluxo. Se encaixar, falamos plano multi-team com billing centralizado.</p><p>Se tiverem interesse, montamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
