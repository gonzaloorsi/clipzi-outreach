// Renders one example email per supported language using a real candidate
// from the queue. Use this BEFORE any real send to review copy.
//
//   npx tsx scripts/render-templates.ts
//   # writes /tmp/email-preview.html, then open in browser to see formatted

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { writeFileSync } from "fs";

import { detectLanguage, getTemplate } from "../lib/templates/index";
import type { SupportedLanguage } from "../lib/templates/index";

const sql = neon(process.env.DATABASE_URL!);
const SENDER_NAME = process.env.SENDER_NAME ?? "Gonzalo Orsi";

const LANGS: SupportedLanguage[] = ["en", "es", "pt", "de", "fr"];

const COUNTRIES_BY_LANG: Record<SupportedLanguage, string[]> = {
  en: ["US", "GB", "CA", "AU", "IN"],
  es: ["ES", "MX", "AR", "CO", "PE"],
  pt: ["BR", "PT"],
  de: ["DE", "AT"],
  fr: ["FR", "BE"],
};

interface ChannelRow {
  id: string;
  title: string;
  clean_name: string | null;
  country: string | null;
  language: string | null;
  primary_email: string;
  score: number | null;
}

const sections: string[] = [];

for (const lang of LANGS) {
  const countries = COUNTRIES_BY_LANG[lang];
  // Use sql.unsafe-style call: drizzle's neon() supports passing as fn(query, params)
  const rows = (await sql(
    `SELECT id, title, clean_name, country, language, primary_email, score
     FROM channels
     WHERE status = 'queued' AND country = ANY($1::text[]) AND primary_email IS NOT NULL
     ORDER BY score DESC NULLS LAST LIMIT 1`,
    [countries],
  )) as ChannelRow[];

  if (rows.length === 0) {
    console.log(`(skip) no queued candidate for lang=${lang}`);
    continue;
  }

  const c = rows[0];
  const detected = detectLanguage(c.country, c.language);
  const tpl = getTemplate(detected);
  const { subject, html } = tpl({
    channelName: c.clean_name || c.title,
    fromName: SENDER_NAME,
  });

  console.log(`\n=== lang=${lang} (detected=${detected}) ===`);
  console.log(`channel: ${c.clean_name || c.title} (${c.country}, score=${c.score})`);
  console.log(`subject: ${subject}`);
  console.log(`---`);
  const plain = html
    .replace(/<\/?p>/g, "\n")
    .replace(/<br\/?>/g, "\n")
    .replace(/<a [^>]*>([^<]+)<\/a>/g, "$1")
    .replace(/&amp;/g, "&")
    .trim();
  console.log(plain);

  sections.push(`
<section style="margin-bottom: 3rem; padding: 1rem; border: 1px solid #ccc; border-radius: 8px;">
  <h2 style="margin-top: 0;">lang = ${lang} (detected = ${detected})</h2>
  <p style="color: #666; font-size: 13px;">
    Channel: ${c.clean_name || c.title} · Country: ${c.country} · Score: ${c.score}
  </p>
  <p style="color: #666; font-size: 13px;"><strong>Subject:</strong> ${subject}</p>
  <hr/>
  <div style="background:#f7f7f7; padding: 1rem; border-radius: 6px;">
    ${html}
  </div>
</section>
  `);
}

const file = "/tmp/email-preview.html";
writeFileSync(
  file,
  `<!doctype html><meta charset="utf-8">
  <title>Email template preview</title>
  <body style="font-family: system-ui; max-width: 720px; margin: 2rem auto; padding: 0 1rem;">
    <h1>Email template preview</h1>
    <p style="color:#666;">From: ${SENDER_NAME} (sender chosen at send-time, round-robin)</p>
    ${sections.join("\n")}
  </body>`,
);

console.log(`\nHTML preview written to ${file}`);
console.log(`Open in browser:  open ${file}`);
