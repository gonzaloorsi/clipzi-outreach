// Template linkbuilding en français. Traduction fidèle de linkbuilding-en.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName, article }) => {
  const ref = article
    ? `votre article sur ${esc(article)}`
    : `vos contenus sur les outils d'IA pour la vidéo`;
  return {
    subject: `${channelName} x Clipzi`,
    html: `<p>Bonjour ${esc(channelName)},</p><p>Je suis ${esc(fromName)}, founder de Clipzi (clipzi.app). J'ai lu ${ref} et j'ai remarqué que presque tous les outils de ces listes sont payants.</p><p>Clipzi transforme les vidéos longues et les podcasts en clips courts viraux avec l'IA, et propose un vrai plan gratuit (2 vidéos pour l'essayer, sans carte). Pour vos lecteurs, c'est la façon la plus simple d'essayer cette catégorie.</p><p>Je peux vous envoyer un accès Starter gratuit pour le tester, plus un court descriptif et des captures d'écran pour que l'ajout prenne cinq minutes.</p><p>Je vous envoie ça ?</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
  };
};
