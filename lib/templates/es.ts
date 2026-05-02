// Source of truth — this is the exact copy that legacy/daily-outreach.mjs has
// been sending. All other language templates are faithful translations of this.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola equipo de ${esc(channelName)},</p><p>Clipzi (https://clipzi.app/) convierte videos largos en clips para TikTok, Reels y Shorts. Suben el video, la IA encuentra los mejores momentos, y luego los ajustan en un editor visual.</p><p>Damos 2 videos gratis por mes para probar el flujo. Si después necesitan más uso o más funciones, hay planes pagos.</p><p>Si les interesa, podemos hacer algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Co-founder &amp; CEO, Clipzi</p>`,
});
