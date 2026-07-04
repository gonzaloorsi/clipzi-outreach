// Template B2B para estudios de foto/video y asociaciones de fotógrafos.
// Foco: volumen de material de eventos, clips para clientes y redes del estudio.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Hola equipo de ${esc(channelName)},</p><p>Soy ${esc(fromName)}, founder de Clipzi (clipzi.app). Trabajamos con estudios de foto y video y asociaciones de fotógrafos que producen horas de material de bodas, eventos y marcas y necesitan generar clips para entregar a clientes y para sus redes.</p><p>El equipo sube el video, la IA encuentra los mejores momentos, y los terminan en un editor visual. Pensado para operación con varios camarógrafos y proyectos en paralelo.</p><p>Les abrimos un workspace de prueba con créditos para que prueben con un evento reciente. Si encaja, hablamos plan multi-team con billing centralizado.</p><p>Si les interesa, armamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
