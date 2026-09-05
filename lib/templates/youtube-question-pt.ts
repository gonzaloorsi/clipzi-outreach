// YouTube v2 fallback (pt-BR). See youtube-question-es.ts.

import type { TemplateBuilder } from "./types";
import { esc, isRoleAddress, signatureHtml } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName, toEmail }) => {
  const plural = isRoleAddress(toEmail);
  const name = esc(channelName);
  return {
    subject: `os shorts do ${channelName}`,
    html: [
      `<p>Olá,</p>`,
      `<p>Uma pergunta sobre o ${name}: quem corta os shorts hoje? Se a resposta for ninguém, ou um editor que leva dias pra mandar, ${plural ? "olhem" : "olha"} isto: ${plural ? "sobem" : "sobe"} o vídeo no Clipzi, ele marca os melhores momentos e em cinco minutos ${plural ? "vocês têm" : "você tem"} os shorts na vertical, com legendas.</p>`,
      `<p>${plural ? "Testem" : "Testa"} grátis em clipzi.app.</p>`,
      signatureHtml(fromName),
    ].join(""),
  };
};
