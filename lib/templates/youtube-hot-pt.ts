// YouTube v2 (pt-BR). See youtube-hot-es.ts for the rationale and register.

import type { TemplateBuilder } from "./types";
import { esc, formatThousands, isRoleAddress, shortTitle, signatureHtml, titleStub, SOCIAL_PROOF_CREATORS } from "./types";

export const build: TemplateBuilder = ({ fromName, hot, toEmail }) => {
  const plural = isRoleAddress(toEmail);
  const proof = formatThousands(SOCIAL_PROOF_CREATORS, "pt");
  const title = esc(shortTitle(hot?.videoTitle ?? ""));
  const seuVideo = plural ? "no vídeo de vocês" : "no seu vídeo";
  const sua = plural ? "a audiência de vocês" : "sua audiência";
  const sobem = plural ? "vocês sobem" : "você sobe";
  const marca = plural ? "ele marca pra vocês" : "ele te marca";
  const ajustam = plural ? "vocês ajustam" : "você ajusta";
  const testem = plural ? "Testem" : "Testa";
  const publica = plural ? "vocês publicam" : "você publica";

  let subject: string;
  let opener: string;

  if (hot?.source === "heatmap" && hot.mmss) {
    subject = `minuto ${hot.mmss}`;
    const where = hot.label ? `, quando começa "${esc(hot.label)}"` : "";
    const moments = hot.mmss2
      ? `os momentos que ${sua} mais repete são o ${hot.mmss}${where}${where ? "," : ""} e o ${hot.mmss2}`
      : `o momento que ${sua} mais repete é o ${hot.mmss}${where}`;
    const waiting = hot.mmss2 ? "Aí tem dois clipes esperando pra Shorts, Reels e TikTok." : "Aí tem um clipe esperando pra Shorts, Reels e TikTok.";
    opener = `Caso sirva o dado, ${seuVideo} "${title}" ${moments}. ${waiting}`;
  } else if (hot?.source === "top_comment" && hot.label) {
    subject = titleStub(hot.videoTitle);
    opener = `Caso sirva o dado, o comentário mais curtido ${seuVideo} "${title}" diz: "${esc(hot.label)}". Esse momento é um clipe que ainda não existe.`;
  } else {
    const perMonth = hot?.perMonth ?? 4;
    const avg = hot?.avgMinutes ?? 60;
    const clips = Math.max(10, Math.round(perMonth * (avg / 60) * 12));
    subject = `${clips} clipes que ninguém está cortando`;
    opener = `Caso sirva o dado, ${publica} ${perMonth} ${perMonth === 1 ? "vídeo longo" : "vídeos longos"} por mês, de ${avg} minutos. Aí dentro tem uns ${clips} clipes pra Shorts, Reels e TikTok que ninguém está cortando.`;
  }

  const html = [
    `<p>Olá,</p>`,
    `<p>${opener}</p>`,
    `<p>Com o Clipzi ${sobem} o vídeo, ${marca} esses momentos, ${ajustam} no editor e em cinco minutos saem com legendas, prontos pra publicar. ${proof} criadores já usam.</p>`,
    `<p>${testem} grátis em clipzi.app com esse vídeo.</p>`,
    signatureHtml(fromName),
  ].join("");

  return { subject, html };
};
