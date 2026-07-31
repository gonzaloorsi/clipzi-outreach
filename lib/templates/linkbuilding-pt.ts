// Template linkbuilding em português. Tradução fiel de linkbuilding-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName, article }) => {
  const ref = article
    ? `seu artigo em ${esc(article)}`
    : `que vocês cobrem ferramentas de IA para vídeo`;
  const intro = article ? `Li ${ref}` : `Vi ${ref}`;
  return {
    subject: `${channelName} x Clipzi`,
    html: `<p>Olá ${esc(channelName)},</p><p>Sou ${esc(fromName)}, founder da Clipzi (clipzi.app). ${intro} e notei que quase todas as ferramentas dessas listas são pagas.</p><p>A Clipzi transforma vídeos longos e podcasts em clipes curtos virais com IA, e tem um plano grátis de verdade (2 vídeos por mês, sem cartão). Para seus leitores é o jeito mais fácil de testar essa categoria.</p><p>Posso enviar acesso Creator grátis para você testar, além de um blurb curto e capturas de tela para que adicionar leve cinco minutos.</p><p>Quer que eu envie?</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
  };
};
