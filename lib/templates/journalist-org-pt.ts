// Template B2B para sindicatos de jornalistas, associações de imprensa e
// escolas de jornalismo (Português Brasil). Tradução fiel de journalist-org-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi equipe da ${esc(channelName)},</p><p>Sou ${esc(fromName)}, founder da Clipzi (clipzi.app). Trabalhamos com associações, sindicatos de imprensa e escolas de jornalismo que gravam palestras, painéis, capacitações e conferências e precisam gerar clipes para as redes.</p><p>O time sobe o vídeo, a IA encontra os melhores momentos, e vocês ajustam em um editor visual. Também funciona como benefício para os associados: cada jornalista pode clipar o próprio conteúdo.</p><p>Abrimos um workspace de teste com créditos para vocês rodarem uma gravação recente pelo fluxo. Se encaixar, falamos plano multi-team com billing centralizado.</p><p>Se tiverem interesse, montamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
