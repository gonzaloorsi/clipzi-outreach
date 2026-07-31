// Linkbuilding-Template auf Deutsch. Getreue Übersetzung von linkbuilding-en.ts.

import type { TemplateBuilder } from "./types";
import { esc } from "./types";

export const build: TemplateBuilder = ({ channelName, fromName, article }) => {
  const ref = article
    ? `euren Artikel auf ${esc(article)}`
    : `eure Beiträge über KI-Video-Tools`;
  return {
    subject: `${channelName} x Clipzi`,
    html: `<p>Hallo ${esc(channelName)},</p><p>ich bin ${esc(fromName)}, Founder von Clipzi (clipzi.app). Ich habe ${ref} gelesen und mir ist aufgefallen, dass fast alle Tools in diesen Listen kostenpflichtig sind.</p><p>Clipzi verwandelt lange Videos und Podcasts mit KI in kurze virale Clips und hat einen echten Gratis-Plan (2 Videos pro Monat, ohne Karte). Für eure Leser ist das der einfachste Einstieg in diese Kategorie.</p><p>Ich schicke euch gern kostenlosen Creator-Zugang zum Testen, plus einen kurzen Blurb und Screenshots, damit das Hinzufügen fünf Minuten dauert.</p><p>Soll ich das schicken?</p><p>${esc(fromName)}<br/>Founder, Clipzi</p>`,
  };
};
