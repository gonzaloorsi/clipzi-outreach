// B2B template for agencies (marketing/PR/community/talent management).
// Mirrors the structure of the creator template but reframes the value prop:
// "for your clients" instead of "for you".

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola equipo de ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). Trabajamos con agencias que manejan creadores y necesitan generar volumen de clips para sus clientes.</p><p>Clipzi convierte videos largos en clips listos para TikTok, Reels y Shorts. El equipo sube el video, la IA encuentra los mejores momentos, y luego los ajustan en un editor visual.</p><p>Les abrimos un workspace de prueba con créditos para que prueben el flujo con uno de sus clientes. Si encaja, hablamos plan agencia (multi-team, billing centralizado).</p><p>Si les interesa, podemos hacer algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
