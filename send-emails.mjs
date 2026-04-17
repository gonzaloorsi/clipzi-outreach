import fs from "fs";
import { readFileSync } from 'fs';
// Load .env
try {
  const env = readFileSync('.env', 'utf-8');
  env.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  });
} catch(e) {}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = `${process.env.SENDER_NAME || "Gonzalo Orsi"} <${process.env.SENDER_EMAIL || "g@clipzi.dev"}>`;

const channels = JSON.parse(fs.readFileSync("top100_latam_youtube_FINAL.json", "utf-8"));

// Filter channels with emails
const withEmail = channels.filter(ch => ch.emails && ch.emails.trim().length > 0);

// Expand: some channels have multiple emails separated by ;
const targets = [];
for (const ch of withEmail) {
  const emails = ch.emails.split(";").map(e => e.trim()).filter(Boolean);
  for (const email of emails) {
    targets.push({ ...ch, email });
  }
}

console.log(`Enviando a ${targets.length} destinatarios de ${withEmail.length} canales...\n`);

function buildHTML(channelName) {
  return `<p>Hola equipo de <strong>${channelName}</strong>,</p>
<p>Les escribo desde <a href="https://clipzi.app/">Clipzi</a>. Convertimos videos largos en clips cortos para TikTok, Reels y Shorts.</p>
<p>Suben el video, la IA detecta los mejores momentos, y — a diferencia de otros servicios que dan todo cortado y listo — nosotros damos un editor visual ultra simple para que el corte final quede como ustedes quieren.</p>
<p>Pueden probarla gratis. Y si les interesa podemos hacer algo específico para ${channelName}.</p>
<p>Saludos,<br/>Gonzalo</p>`;
}

const results = [];
let success = 0;
let failed = 0;

for (const target of targets) {
  const subject = `${target.title} x Clipzi`;
  const html = buildHTML(target.title);
  
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [target.email],
        subject,
        html,
      }),
    });
    
    const data = await res.json();
    
    if (res.ok) {
      success++;
      console.log(`✅ ${String(success).padStart(2)}. ${target.title.padEnd(35)} → ${target.email}`);
      results.push({ channel: target.title, email: target.email, status: "sent", id: data.id });
    } else {
      failed++;
      console.log(`❌ FAIL: ${target.title} → ${target.email} | ${JSON.stringify(data)}`);
      results.push({ channel: target.title, email: target.email, status: "failed", error: data });
    }
  } catch (err) {
    failed++;
    console.log(`❌ ERROR: ${target.title} → ${target.email} | ${err.message}`);
    results.push({ channel: target.title, email: target.email, status: "error", error: err.message });
  }
  
  // Small delay between sends to be nice to Resend API
  await new Promise(r => setTimeout(r, 500));
}

console.log(`\n=== RESULTADO ===`);
console.log(`Enviados: ${success}`);
console.log(`Fallidos: ${failed}`);
console.log(`Total: ${targets.length}`);

fs.writeFileSync("send_results.json", JSON.stringify(results, null, 2));
console.log(`\nResultados guardados en send_results.json`);
