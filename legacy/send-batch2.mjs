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
const SENDER_EMAIL = process.env.SENDER_EMAIL || "g@clipzi.dev";
const SENDER_NAME = process.env.SENDER_NAME || "Gonzalo Orsi";

const channels = JSON.parse(readFileSync("batch2_new_channels.json", "utf-8"));

// Load already sent to avoid duplicates
let alreadySent = new Set();
try {
  const prev = JSON.parse(readFileSync("send_results.json", "utf-8"));
  prev.forEach((s) => alreadySent.add(s.email.toLowerCase()));
} catch (e) {}

function buildHTML(channelName) {
  return `<p>Hola equipo de ${channelName},</p><p>Clipzi (https://clipzi.app/) convierte videos largos en clips para TikTok, Reels y Shorts. Suben el video, la IA elige los mejores momentos, y ustedes los ajustan en un editor visual antes de publicar.</p><p>La herramienta es gratuita para todos, y mejorada para suscriptores. Si les interesa, podemos hacer algo específico para ${channelName}.</p><p>Gonzalo Orsi<br/>Co-founder &amp; CEO, Clipzi</p>`;
}

const results = [];
let sent = 0, skipped = 0, failed = 0;

for (const ch of channels) {
  const emails = ch.emails.split(";").map((e) => e.trim()).filter(Boolean);

  for (const email of emails) {
    if (alreadySent.has(email.toLowerCase())) {
      console.log(`⏭️  SKIP (already sent): ${ch.title} -> ${email}`);
      skipped++;
      continue;
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
          to: [email],
          subject: `${ch.title} x Clipzi`,
          html: buildHTML(ch.title),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        console.log(`✅ ${String(sent + 1).padStart(3)}. ${ch.title} -> ${email}`);
        results.push({ channel: ch.title, email, status: "sent", id: data.id });
        sent++;
      } else {
        console.log(`❌ FAIL: ${ch.title} -> ${email} (${data.message || res.status})`);
        results.push({ channel: ch.title, email, status: "failed", error: data.message });
        failed++;
      }

      // Rate limit: small delay between sends
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.log(`❌ ERROR: ${ch.title} -> ${email} (${err.message})`);
      results.push({ channel: ch.title, email, status: "error", error: err.message });
      failed++;
    }
  }
}

// Save batch 2 results
writeFileSync("send_results_batch2.json", JSON.stringify(results, null, 2));

// Also append to main send_results
try {
  const prev = JSON.parse(readFileSync("send_results.json", "utf-8"));
  writeFileSync("send_results.json", JSON.stringify([...prev, ...results.filter(r => r.status === "sent")], null, 2));
} catch (e) {
  writeFileSync("send_results.json", JSON.stringify(results.filter(r => r.status === "sent"), null, 2));
}

console.log(`\n=== BATCH 2 COMPLETE ===`);
console.log(`Sent: ${sent}`);
console.log(`Skipped: ${skipped}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${sent + skipped + failed}`);
