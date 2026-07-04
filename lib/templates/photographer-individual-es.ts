// Template para fotógrafos y videógrafos (individuos). Tono cercano.
// Pitch: filman horas de video en bodas y eventos; Clipzi saca los mejores
// momentos en clips para entregar al cliente y para su propia promo en redes.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). Trabajamos con fotógrafos y videógrafos que filman horas de video en bodas y eventos. Subís el material, la IA encuentra los mejores momentos y los convertís en clips listos para entregar al cliente y para promocionar tu trabajo en Reels, TikTok y Shorts.</p><p>Te dejamos 2 videos gratis por mes para que pruebes con tu próximo evento. Si después querés más volumen o funciones extra, hay planes pagos.</p><p>Si te interesa, armamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
