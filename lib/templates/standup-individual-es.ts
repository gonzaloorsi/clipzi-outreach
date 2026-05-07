// Template para comediantes de stand-up (individuos). Tono cercano.
// Foco: clipear sets, especiales y podcasts en momentos virales.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). Convertimos sets, especiales y podcasts de stand-up en clips listos para Reels, TikTok y Shorts. Subís el video, la IA encuentra los mejores remates y los terminás en un editor visual.</p><p>Te dejamos 2 videos gratis por mes para que pruebes con tu próximo material. Si después querés más volumen o funciones extra, hay planes pagos.</p><p>Si te interesa, armamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
