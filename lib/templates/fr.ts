// Faithful translation of lib/templates/es.ts. Uses "vous" form (plural-you)
// to match "ustedes", which is the standard for B2B / outreach in French.
//
// TODO: native French speaker review before scaling FR volume.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName }) => ({
  subject: `${channelName} x Clipzi`,
  html: `<p>Bonjour l'équipe de ${esc(channelName)},</p><p>Clipzi (https://clipzi.app/) transforme les vidéos longues en clips pour TikTok, Reels et Shorts. Vous uploadez la vidéo, l'IA trouve les meilleurs moments, puis vous ajustez dans un éditeur visuel.</p><p>On donne 2 vidéos gratuites par mois pour tester le flux. Si vous avez besoin de plus d'utilisation ou de plus de fonctionnalités, il y a des plans payants.</p><p>Si ça vous intéresse, on peut faire quelque chose de spécifique pour ${esc(channelName)}.</p><p>${esc(fromName)}<br/>Co-fondateur &amp; CEO, Clipzi</p>`,
});
