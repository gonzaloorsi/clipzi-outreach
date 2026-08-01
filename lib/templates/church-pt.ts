// Template para igrejas e ministérios (português). Tradução fiel de church-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Olá ${esc(channelName)},</p><p>Sou ${esc(fromName)}, founder da Clipzi (clipzi.app). Vi que vocês compartilham seus cultos no YouTube. Uma mensagem de uma hora tem 5 ou 6 momentos que podem alcançar muito mais pessoas no Reels, TikTok e Shorts, principalmente os mais jovens.</p><p>A Clipzi encontra esses momentos com IA, corta em vertical e adiciona legendas, prontos para publicar. Quem cuida das redes não precisa saber editar.</p><p>Vocês têm 2 vídeos grátis por mês para testar com o próximo culto. Se funcionar, há planos para mais volume.</p><p>Se tiverem interesse, montamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
