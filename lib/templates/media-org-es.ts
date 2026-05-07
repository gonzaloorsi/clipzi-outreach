// Template B2B para radios, networks de podcast y canales de streaming-TV.
// Pitch unificado: organizaciones que producen contenido grabado y necesitan clipear.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola equipo de ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). Trabajamos con radios, networks de podcast y canales de streaming que producen horas de contenido grabado por día y necesitan generar clips para Reels, TikTok y Shorts.</p><p>El equipo sube los videos del programa, la IA encuentra los mejores momentos, y los terminan en un editor visual. Pensado para operación multi-show con varios conductores.</p><p>Les abrimos un workspace de prueba con créditos para que prueben con un programa reciente. Si encaja, hablamos plan multi-team con billing centralizado.</p><p>Si les interesa, armamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
