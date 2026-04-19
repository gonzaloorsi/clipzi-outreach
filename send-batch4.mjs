import { readFileSync } from "fs";

const data = JSON.parse(readFileSync("batch4_channels.json", "utf-8"));

function cleanName(name) {
  let c = name.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[⭐️🔹🐬✨♠️🏀🌸]/gu, "").trim();
  for (const sep of [" | ", " · ", " - ", " : ", " (", " [", " / "]) {
    const idx = c.indexOf(sep);
    if (idx > 3) { const f = c.substring(0, idx).trim(); if (f.length > 3) c = f; }
  }
  c = c.replace(/[_\-·|:]+$/g, "").trim();
  c = c.replace(/^(El Canal De |EL CANAL DE )/i, "");
  return c;
}

let sent = 0;
for (const ch of data) {
  const name = cleanName(ch.title);
  const emails = ch.emails.split(";").map(e => e.trim()).filter(Boolean);
  for (const email of emails) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer re_ihdDKn5X_7rWKuHs3Lc9khviKtroPmfgA" },
      body: JSON.stringify({
        from: "Gonzalo Orsi <g@clipzi.video>",
        to: [email],
        subject: `${name} x Clipzi`,
        html: `<p>Hola equipo de ${name},</p><p>Clipzi (https://clipzi.app/) convierte videos largos en clips para TikTok, Reels y Shorts. Suben el video, la IA elige los mejores momentos, y ustedes los ajustan en un editor visual antes de publicar.</p><p>La herramienta es gratuita para todos, y mejorada para suscriptores. Si les interesa, podemos hacer algo específico para ${name}.</p><p>Gonzalo Orsi<br/>Co-founder &amp; CEO, Clipzi</p>`,
      }),
    });
    const d = await res.json();
    sent++;
    if (res.ok) console.log(`✅ ${String(sent).padStart(2)}. ${name.padEnd(35)} -> ${email}`);
    else console.log(`❌ ${name.padEnd(35)} -> ${email} (${d.message})`);
    await new Promise(r => setTimeout(r, 200));
  }
}
console.log(`\nDone. ${sent} emails enviados desde g@clipzi.video`);
