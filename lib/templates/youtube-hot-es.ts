// YouTube v2 (es): the first line hands the creator a fact about THEIR video
// they probably never saw (the moments the audience replays most, YouTube's
// own "most replayed" marker, from the InnerTube heatmap, lib/heatmap.ts).
// Falls back to the top comment or to the upload cadence when the heatmap is
// missing.
//
// Register (fifth iteration, 2026-09-05, with Gonzalo): a gift, not a pitch
// ("por si te sirve el dato"), the creator is the protagonist (uploads,
// adjusts in the editor), the result is multi-platform (Shorts, Reels,
// TikTok), one time promise (five minutes), free-trial CTA. No "reply yes", no
// code, no card talk, no discount, no PS, company voice without sounding like
// a help desk. Peak START times only, never ranges: the heatmap comes in 21s
// blocks and two same-length ranges read as machine output. Voseo for AR/UY,
// tú elsewhere, plural for role addresses. The 50% first-month discount is
// attached server-side (clipzi reads the outreach send) and only the day-10
// close names it.

import type { TemplateBuilder } from "./types";
import { esc, formatThousands, isRoleAddress, shortTitle, signatureHtml, titleStub, usesVoseo, SOCIAL_PROOF_CREATORS } from "./types";

export const build: TemplateBuilder = ({ fromName, hot, country, toEmail }) => {
  const plural = isRoleAddress(toEmail);
  const vos = usesVoseo(country);
  const proof = formatThousands(SOCIAL_PROOF_CREATORS, "es");
  const title = esc(shortTitle(hot?.videoTitle ?? ""));

  // Second-person forms: plural (ustedes) / vos / tú.
  const f = (pl: string, v: string, t: string) => (plural ? pl : vos ? v : t);
  const te = f("les", "te", "te");
  const tu = f("su", "tu", "tu");
  const subis = f("suben", "subís", "subes");
  const marca = f("les marca", "te marca", "te marca");
  const ajustas = f("los ajustan", "los ajustás", "los ajustas");
  const probalo = f("Pruébenlo", "Probalo", "Pruébalo");
  const publican = f("Publican", "Publicás", "Publicas");

  let subject: string;
  let opener: string;

  if (hot?.source === "heatmap" && hot.mmss) {
    subject = `minuto ${hot.mmss}`;
    const where = hot.label ? `, cuando empieza "${esc(hot.label)}"` : "";
    const moments = hot.mmss2
      ? `los momentos que ${tu} audiencia más repite son el ${hot.mmss}${where}${where ? "," : ""} y el ${hot.mmss2}`
      : `el momento que ${tu} audiencia más repite es el ${hot.mmss}${where}`;
    const waiting = hot.mmss2 ? "Ahí hay dos clips esperando para Shorts, Reels y TikTok." : "Ahí hay un clip esperando para Shorts, Reels y TikTok.";
    opener = `Por si ${te} sirve el dato, en ${tu} video "${title}" ${moments}. ${waiting}`;
  } else if (hot?.source === "top_comment" && hot.label) {
    subject = titleStub(hot.videoTitle);
    opener = `Por si ${te} sirve el dato, el comentario más votado de ${tu} video "${title}" dice: "${esc(hot.label)}". Ese momento es un clip que todavía no existe.`;
  } else {
    const perMonth = hot?.perMonth ?? 4;
    const avg = hot?.avgMinutes ?? 60;
    const clips = Math.max(10, Math.round(perMonth * (avg / 60) * 12));
    subject = `${clips} clips que nadie está cortando`;
    opener = `Por si ${te} sirve el dato, ${publican.toLowerCase()} ${perMonth} ${perMonth === 1 ? "video largo" : "videos largos"} por mes, de ${avg} minutos. Ahí adentro hay unos ${clips} clips para Shorts, Reels y TikTok que nadie está cortando.`;
  }

  const html = [
    `<p>Hola,</p>`,
    `<p>${opener}</p>`,
    `<p>Con Clipzi ${subis} el video, ${marca} esos momentos, ${ajustas} en el editor y en cinco minutos salen con subtítulos, listos para publicar. Ya lo usan ${proof} creadores.</p>`,
    `<p>${probalo} gratis en clipzi.app con ese video.</p>`,
    signatureHtml(fromName),
  ].join("");

  return { subject, html };
};
