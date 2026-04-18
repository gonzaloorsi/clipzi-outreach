import { readFileSync, writeFileSync } from "fs";

// Load .env
try {
  const env = readFileSync(".env", "utf-8");
  env.split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
  });
} catch (e) {}

const API_KEY = process.env.YOUTUBE_API_KEY;

// Load ALL known channels and emails
const allKnownChannelIds = new Set();
const allKnownEmails = new Set();

for (const file of ["top100_latam_youtube_FINAL.json", "batch2_new_channels.json", "batch3_channels.json"]) {
  try {
    const d = JSON.parse(readFileSync(file, "utf-8"));
    d.forEach(ch => {
      allKnownChannelIds.add(ch.channelId);
      if (ch.emails) ch.emails.split(";").forEach(e => allKnownEmails.add(e.trim().toLowerCase()));
    });
  } catch(e) {}
}

try {
  const sent = JSON.parse(readFileSync("send_results.json", "utf-8"));
  sent.forEach(s => allKnownEmails.add(s.email.toLowerCase()));
} catch(e) {}

console.log(`Known channels: ${allKnownChannelIds.size}`);
console.log(`Known emails: ${allKnownEmails.size}\n`);

// Completely new queries - different niches
const queries = [
  "canal español entrevista famosos",
  "canal español late night show",
  "canal español stand up comedy",
  "canal español cortometraje cine",
  "canal español documental independiente",
  "canal español teatro actuación",
  "canal español dj música electrónica",
  "canal español reggaeton urbano",
  "canal español rock band",
  "canal español cantautor acústico",
  "youtuber español viajes mochilero",
  "youtuber latino aventura extrema",
  "canal español pareja travel couple",
  "canal español vanlife camper",
  "canal español expatriado vivir en",
  "canal español mudanza emigrar",
  "canal español emprendedor ecommerce",
  "canal español dropshipping amazon",
  "canal español marketing redes sociales",
  "canal español growth hacking",
  "canal español recursos humanos",
  "canal español oposiciones estudiar",
  "canal español idiomas aprender inglés",
  "canal español matemáticas física",
  "canal español historia geopolítica",
  "canal español filosofía debate",
  "canal español tarot espiritualidad",
  "canal español astrología horóscopo",
  "canal español misterio paranormal investigación",
  "canal español ovni conspiración",
  "canal español true crime caso real",
  "canal español crimen documental",
  "canal español noticias análisis político",
  "canal español periodismo investigación",
  "canal español automóvil detailing",
  "canal español 4x4 offroad",
  "canal español bicicleta ciclismo mtb",
  "canal español triatlón ironman",
  "canal español escalada climbing",
  "canal español snowboard esquí",
  "canal español drone fpv",
  "canal español impresión 3d maker",
  "canal español bricolaje reforma casa",
  "canal español costura moda diseño",
  "canal español joyería artesanía",
  "canal español cerámica alfarería",
  "canal español pintura arte dibujo",
  "canal español ilustración digital procreate",
  "canal español minecraft roleplay",
  "canal español roblox español",
];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    if (t.includes("quota")) return "QUOTA";
    return null;
  }
  return res.json();
}

const newIds = new Set();
let quota = 0;

console.log("=== SEARCHING ===\n");

for (const q of queries) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=50&relevanceLanguage=es&key=${API_KEY}`;
  const data = await fetchJSON(url);
  quota += 100;
  if (data === "QUOTA") { console.log(`⚠️ Quota hit at "${q}"`); break; }
  if (!data || !data.items) continue;
  let added = 0;
  for (const item of data.items) {
    const id = item.snippet?.channelId || item.id?.channelId;
    if (id && !allKnownChannelIds.has(id) && !newIds.has(id)) { newIds.add(id); added++; }
  }
  console.log(`  "${q}" → +${added} (total: ${newIds.size})`);
}

console.log(`\nNew channels: ${newIds.size} | Search quota: ~${quota}\n`);

// Fetch details
console.log("=== FETCHING DETAILS ===\n");
const ids = [...newIds];
const channels = [];

for (let i = 0; i < ids.length; i += 50) {
  const batch = ids.slice(i, i + 50);
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${batch.join(",")}&key=${API_KEY}`;
  const data = await fetchJSON(url);
  quota += 1;
  if (data === "QUOTA" || !data || !data.items) break;
  for (const ch of data.items) {
    const desc = ch.snippet.description || "";
    const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = [...new Set((desc.match(re) || []))];
    channels.push({
      title: ch.snippet.title,
      channelId: ch.id,
      country: ch.snippet.country || "",
      subscribers: parseInt(ch.statistics.subscriberCount || "0"),
      videoCount: parseInt(ch.statistics.videoCount || "0"),
      emails: emails.join(";"),
      url: `https://youtube.com/channel/${ch.id}`,
    });
  }
  process.stdout.write(`  ${Math.min(i + 50, ids.length)}/${ids.length}\r`);
}

// Filter: new emails only, dedupe
const seenEmails = new Set([...allKnownEmails]);
const results = [];
channels
  .filter(ch => ch.emails && ch.emails.trim().length > 0)
  .sort((a, b) => b.subscribers - a.subscribers)
  .forEach(ch => {
    const emails = ch.emails.split(";").map(e => e.trim().toLowerCase());
    const fresh = emails.filter(e => !seenEmails.has(e));
    if (fresh.length > 0) {
      fresh.forEach(e => seenEmails.add(e));
      results.push(ch);
    }
  });

writeFileSync("batch4_channels.json", JSON.stringify(results, null, 2));

// Clean name function
function cleanName(name) {
  let c = name.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[⭐️🔹🐬✨♠️🏀🌸]/gu, '').trim();
  for (const sep of [' | ', ' · ', ' - ', ' : ', ' (', ' [', ' / ']) {
    const idx = c.indexOf(sep);
    if (idx > 3) { const f = c.substring(0, idx).trim(); if (f.length > 3) c = f; }
  }
  c = c.replace(/[_\-·|:]+$/g, '').trim();
  c = c.replace(/^(El Canal De |EL CANAL DE )/i, '');
  return c;
}

console.log(`\n\n=== BATCH 4: ${results.length} CANALES NUEVOS ===\n`);
console.log('     Canal                                          Subs      Email');
console.log('     ' + '-'.repeat(90));
results.forEach((ch, i) => {
  const name = cleanName(ch.title);
  const subs = ch.subscribers >= 1e6 ? (ch.subscribers / 1e6).toFixed(1) + 'M' : (ch.subscribers / 1e3).toFixed(0) + 'K';
  const email = ch.emails.split(';')[0];
  console.log(`${String(i + 1).padStart(3)}. ${name.substring(0,45).padEnd(45)} ${subs.padStart(8)}  ${email}`);
});

console.log(`\nTotal: ${results.length} | Quota usada: ~${quota}`);
