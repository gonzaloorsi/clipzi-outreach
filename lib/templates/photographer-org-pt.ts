// Template B2B para estúdios de foto/vídeo e associações de fotógrafos
// (Português Brasil). Tradução fiel de photographer-org-es.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Oi equipe da ${esc(channelName)},</p><p>Sou ${esc(fromName)}, founder da Clipzi (clipzi.app). Trabalhamos com estúdios de foto e vídeo e associações de fotógrafos que produzem horas de material de casamentos, eventos e marcas e precisam gerar clipes para entregar aos clientes e para as próprias redes.</p><p>O time sobe o vídeo, a IA encontra os melhores momentos, e vocês ajustam em um editor visual. Pensado para operação com vários cinegrafistas e projetos em paralelo.</p><p>Abrimos um workspace de teste com créditos para vocês rodarem um evento recente pelo fluxo. Se encaixar, falamos plano multi-team com billing centralizado.</p><p>Se tiverem interesse, montamos algo específico para ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
});
