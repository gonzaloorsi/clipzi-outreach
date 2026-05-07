// Template B2B para rádios, networks de podcast e canais de streaming (Português Brasil).
// Tradução fiel de media-org-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi equipe da ${esc(channelName)},</p><p>Sou ${esc(fromName)}, co-founder da Clipzi (https://clipzi.app/). Trabalhamos com rádios, networks de podcast e canais de streaming que produzem horas de conteúdo gravado por dia e precisam gerar clipes para Reels, TikTok e Shorts.</p><p>O time sobe o vídeo do programa, a IA encontra os melhores momentos, e vocês ajustam em um editor visual. Pensado para operação multi-show com vários apresentadores.</p><p>Abrimos um workspace de teste com créditos para vocês rodarem um programa recente pelo fluxo. Se encaixar, falamos plano multi-team com billing centralizado.</p><p>Se tiverem interesse, montamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Co-founder &amp; CEO, Clipzi</p>`,
});
