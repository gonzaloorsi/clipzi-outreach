// Template linkbuilding en español. Pitch de valor editorial: referencia al
// artículo específico cuando lo tenemos, ángulo "tu lista no tiene opción
// gratis de verdad", acceso Starter + blurb listo. Un solo micro-CTA.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName, article }) => {
  const ref = article
    ? `tu artículo en ${esc(article)}`
    : `que cubren herramientas de IA para video`;
  const intro = article ? `Leí ${ref}` : `Vi ${ref}`;
  return {
    subject: `${channelName} x Clipzi`,
    html: `<p>Hola ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). ${intro} y noté que casi todas las herramientas de estas listas son pagas.</p><p>Clipzi convierte videos largos y podcasts en clips cortos virales con IA, y tiene un plan gratis de verdad (2 videos para probarlo, sin tarjeta). Para tus lectores es la forma más fácil de probar esta categoría.</p><p>Te puedo mandar acceso Starter gratis para que lo pruebes vos, más un blurb corto y capturas para que agregarlo te tome cinco minutos.</p><p>¿Te lo mando?</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
  };
};
