// Template B2B para uniones, sindicatos, asociaciones de prensa, press clubs
// y escuelas de periodismo. Foco: clips de sus eventos + beneficio para miembros.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola equipo de ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). Trabajamos con asociaciones, sindicatos de prensa y escuelas de periodismo que graban charlas, paneles, capacitaciones y conferencias y necesitan generar clips para redes.</p><p>El equipo sube el video, la IA encuentra los mejores momentos, y los terminan en un editor visual. También funciona como beneficio para sus miembros: cada periodista puede clipear su propio contenido.</p><p>Les abrimos un workspace de prueba con créditos para que prueben con una grabación reciente. Si encaja, hablamos plan multi-team con billing centralizado.</p><p>Si les interesa, armamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
