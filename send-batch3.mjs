import { readFileSync, writeFileSync } from "fs";

// Load .env
try {
  const env = readFileSync(".env", "utf-8");
  env.split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
  });
} catch (e) {}

const RESEND_KEY = process.env.RESEND_API_KEY;

// Clean channel name for email
function cleanName(name) {
  let clean = name.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[⭐️🔹🐬✨♠️🏀🌸]/gu, '').trim();
  const separators = [' | ', ' · ', ' - ', ' : ', ' (', ' [', ' / '];
  for (const sep of separators) {
    const idx = clean.indexOf(sep);
    if (idx > 3) {
      const first = clean.substring(0, idx).trim();
      if (first.length > 3) clean = first;
    }
  }
  clean = clean.replace(/[_\-·|:]+$/g, '').trim();
  clean = clean.replace(/^(El Canal De |EL CANAL DE )/i, '');
  // Manual fixes
  if (clean === '412') clean = '412 Fútbol';
  if (clean.includes('Borja Capponi Adiestramiento')) clean = 'Borja Capponi';
  return clean;
}

// Load batch 3 data and score/filter top 50%
const data = JSON.parse(readFileSync("batch3_channels.json", "utf-8"));

const scored = data.map(ch => {
  let score = 0;
  const title = ch.title.toLowerCase();
  const email = ch.emails.toLowerCase();
  if (ch.subscribers >= 50000 && ch.subscribers <= 10000000) score += 30;
  else if (ch.subscribers >= 10000 && ch.subscribers < 50000) score += 15;
  else if (ch.subscribers > 10000000) score += 20;
  const goodNiches = ['podcast','vlog','review','react','entrevista','lifestyle',
    'comedia','humor','cocina','receta','fitness','gym','deport','basket','futbol',
    'gaming','tutorial','barbero','barber','maquillaje','belleza','decorar',
    'unbox','opinion','reseña','storytime','nutrici','doctor','abogad',
    'fotograf','audiovisual','film','produc','surf','moto','tattoo','tatuaje',
    'adiestramiento','yoga','crossfit','boxeo','mma','tenis','golf','ajedrez',
    'chess','poker','café','barista','repostería','panadería'];
  if (goodNiches.some(n => title.includes(n))) score += 15;
  const badNiches = ['bitcoin','cripto','crypto','inmobili','bienes raices','realtor',
    'real estate','casa en','comprar casa','chistosos','viral short','shorts 2024',
    'beats','instrumental','en español)','unbox random'];
  if (badNiches.some(n => title.includes(n))) score -= 25;
  if (ch.subscribers < 1000) score -= 20;
  if (ch.videoCount > 500) score += 20;
  else if (ch.videoCount > 100) score += 15;
  else if (ch.videoCount > 30) score += 10;
  if (!email.includes('gmail.com') && !email.includes('hotmail') && !email.includes('outlook') && !email.includes('yahoo')) score += 10;
  const latam = ['MX','AR','CO','CL','PE','EC','PR','GT','UY','VE','DO','PA','CR','ES'];
  if (latam.includes(ch.country)) score += 10;
  return { ...ch, score };
});

const sorted = scored.sort((a, b) => b.score - a.score);
const top = sorted.slice(0, Math.ceil(sorted.length / 2));

// Send
const results = [];
let sent = 0, failed = 0;

for (const ch of top) {
  const name = cleanName(ch.title);
  const emails = ch.emails.split(";").map(e => e.trim()).filter(Boolean);

  for (const email of emails) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from: "Gonzalo Orsi <g@clipzi.dev>",
          to: [email],
          subject: `${name} x Clipzi`,
          html: `<p>Hola equipo de ${name},</p><p>Clipzi (https://clipzi.app/) convierte videos largos en clips para TikTok, Reels y Shorts. Suben el video, la IA elige los mejores momentos, y ustedes los ajustan en un editor visual antes de publicar.</p><p>La herramienta es gratuita para todos, y mejorada para suscriptores. Si les interesa, podemos hacer algo específico para ${name}.</p><p>Gonzalo Orsi<br/>Co-founder &amp; CEO, Clipzi</p>`,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        sent++;
        console.log(`✅ ${String(sent).padStart(3)}. ${name.padEnd(40)} -> ${email}`);
        results.push({ channel: ch.title, cleanName: name, email, status: "sent", id: d.id });
      } else {
        failed++;
        console.log(`❌ ${name} -> ${email} (${d.message})`);
        results.push({ channel: ch.title, cleanName: name, email, status: "failed", error: d.message });
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      failed++;
      console.log(`❌ ${name} -> ${email} (${err.message})`);
      results.push({ channel: ch.title, cleanName: name, email, status: "error", error: err.message });
    }
  }
}

writeFileSync("send_results_batch3.json", JSON.stringify(results, null, 2));

// Append to main results
try {
  const prev = JSON.parse(readFileSync("send_results.json", "utf-8"));
  writeFileSync("send_results.json", JSON.stringify([...prev, ...results.filter(r => r.status === "sent")], null, 2));
} catch (e) {}

console.log(`\n=== BATCH 3 COMPLETE ===`);
console.log(`Sent: ${sent}`);
console.log(`Failed: ${failed}`);
