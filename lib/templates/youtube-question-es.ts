// YouTube v2 fallback (es): no personalization data, so the hook is the
// question every channel asks itself (who cuts the shorts today?) and the
// answer is the self-serve flow. Same pre-loaded month as youtube-hot.

import type { TemplateBuilder } from "./types";
import { esc, isRoleAddress, signatureHtml, usesVoseo } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName, country, toEmail }) => {
  const plural = isRoleAddress(toEmail);
  const vos = usesVoseo(country);
  const name = esc(channelName);
  const f = (pl: string, v: string, t: string) => (plural ? pl : vos ? v : t);
  const mira = f("miren", "mirá", "mira");
  const subis = f("suben", "subís", "subes");
  const marca = f("les marca", "te marca", "te marca");
  const tenes = f("tienen", "tenés", "tienes");
  return {
    subject: `los shorts de ${channelName}`,
    html: [
      `<p>Hola,</p>`,
      `<p>Una pregunta sobre ${name}: ¿quién corta los shorts hoy? Si la respuesta es nadie, o un editor al que hay que esperar días, ${mira} esto: ${subis} el video a Clipzi, ${marca} los mejores momentos y en cinco minutos ${tenes} los shorts en vertical, con subtítulos.</p>`,
      `<p>${plural ? "Pruébenlo" : vos ? "Probalo" : "Pruébalo"} gratis en clipzi.app.</p>`,
      signatureHtml(fromName),
    ].join(""),
  };
};
