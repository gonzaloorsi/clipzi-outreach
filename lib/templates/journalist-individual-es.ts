// Template para periodistas independientes (individuos). Tono cercano.
// Foco: clipear entrevistas, streams, coberturas y podcasts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). Convertimos entrevistas, streams, coberturas y podcasts en clips listos para Reels, TikTok y Shorts. Subís el video, la IA encuentra los mejores momentos y los terminás en un editor visual.</p><p>Te dejamos 2 videos gratis para que pruebes con tu próxima nota o programa. Si después querés más volumen o funciones extra, hay planes pagos.</p><p>Si te interesa, armamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
