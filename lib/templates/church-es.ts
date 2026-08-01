// Template para iglesias y ministerios (español). El ángulo no es marketing,
// es alcance del mensaje: un servicio de una hora tiene 5 o 6 momentos que
// pueden llegar a mucha más gente en Reels/TikTok/Shorts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). Vi que comparten sus servicios en YouTube. Un mensaje de una hora tiene 5 o 6 momentos que pueden llegar a muchísima más gente en Reels, TikTok y Shorts, sobre todo a los más jóvenes.</p><p>Clipzi encuentra esos momentos con IA, los recorta en vertical y les agrega subtítulos, listos para publicar. Quien maneja las redes no necesita saber editar.</p><p>Tienen 2 videos gratis por mes para probarlo con el próximo servicio. Si les sirve, hay planes para más volumen.</p><p>Si les interesa, armamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
