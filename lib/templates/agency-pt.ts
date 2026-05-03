// B2B template for agencies — Portuguese (Brazilian).
// Faithful translation of agency-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi equipe da ${esc(channelName)},</p><p>Sou ${esc(fromName)}, co-founder da Clipzi (https://clipzi.app/). Trabalhamos com agências que gerenciam criadores e precisam gerar volume de clipes para seus clientes.</p><p>A Clipzi transforma vídeos longos em clipes prontos para TikTok, Reels e Shorts. A equipe sobe o vídeo, a IA encontra os melhores momentos, e vocês ajustam em um editor visual.</p><p>Abrimos um workspace de teste com créditos para vocês rodarem um dos clientes pelo fluxo. Se encaixar, falamos plano agência (multi-team, billing centralizado).</p><p>Se tiverem interesse, podemos fazer algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Co-founder &amp; CEO, Clipzi</p>`,
});
