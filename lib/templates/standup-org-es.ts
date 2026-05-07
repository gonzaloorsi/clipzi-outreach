// Template B2B para escuelas de stand-up, clubs, festivales y productoras de comedy.
// Foco: volumen multi-comediante, contenido recurrente para promo y redes.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola equipo de ${esc(channelName)},</p><p>Soy ${esc(fromName)}, co-founder de Clipzi (https://clipzi.app/). Trabajamos con escuelas, clubs y productoras de stand-up que necesitan generar volumen de clips de sus comediantes para promo, redes y venta de entradas.</p><p>Clipzi convierte grabaciones de noches, talleres o especiales en clips listos para Reels, TikTok y Shorts. El equipo sube el video, la IA encuentra los mejores remates, y los terminan en un editor visual.</p><p>Les abrimos un workspace de prueba con créditos para que prueben con una grabación reciente. Si encaja, hablamos plan multi-team con billing centralizado.</p><p>Si les interesa, armamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Co-founder &amp; CEO, Clipzi</p>`,
});
