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

// Load ALL already sent/known emails and channel IDs
const allSentEmails = new Set();
const allKnownChannelIds = new Set();

// Batch 1 sent
try {
  const s1 = JSON.parse(readFileSync("send_results.json", "utf-8"));
  s1.forEach(s => { allSentEmails.add(s.email.toLowerCase()); });
  console.log(`Batch 1+2 sent emails: ${allSentEmails.size}`);
} catch(e) {}

// Batch 2 channels
try {
  const b2 = JSON.parse(readFileSync("batch2_new_channels.json", "utf-8"));
  b2.forEach(ch => { 
    allKnownChannelIds.add(ch.channelId);
    if (ch.emails) ch.emails.split(";").forEach(e => allSentEmails.add(e.trim().toLowerCase()));
  });
  console.log(`Batch 2 known channels: ${b2.length}`);
} catch(e) {}

// Batch 1 channels
try {
  const b1 = JSON.parse(readFileSync("top100_latam_youtube_FINAL.json", "utf-8"));
  b1.forEach(ch => { 
    allKnownChannelIds.add(ch.channelId);
    if (ch.emails) ch.emails.split(";").forEach(e => allSentEmails.add(e.trim().toLowerCase()));
  });
  console.log(`Batch 1 known channels: ${b1.length}`);
} catch(e) {}

console.log(`Total known channel IDs: ${allKnownChannelIds.size}`);
console.log(`Total known emails: ${allSentEmails.size}\n`);

// New search queries - completely different from batch 1 & 2
const queries = [
  // New niches not covered before
  "canal youtube español lifestyle",
  "canal youtube español decoración hogar",
  "canal youtube español nutrición dieta",
  "canal youtube español yoga meditación",
  "canal youtube español running maratón",
  "canal youtube español surf skate",
  "canal youtube español moto motocicleta",
  "canal youtube español pesca caza",
  "canal youtube español tatuaje tattoo",
  "canal youtube español barbería corte",
  "influencer latino lifestyle",
  "influencer mexicano 2024",
  "influencer argentino 2024",
  "influencer colombiano 2024",
  "influencer chileno 2024",
  "influencer peruano 2024",
  "canal review unboxing español",
  "canal reseña opinión español",
  "canal español emprendedor startup",
  "canal español inversión bolsa",
  "canal español criptomonedas bitcoin",
  "canal español inmobiliario bienes raices",
  "canal español psicología salud mental",
  "canal español medicina doctor",
  "canal español abogado derecho",
  "canal español arquitectura diseño interior",
  "canal español fotografía cinematografía",
  "canal español productora audiovisual",
  "canal español wedding bodas",
  "canal español música producción beat",
  "podcast latino entrevista 2024",
  "podcast mexicano popular",
  "podcast argentino popular",
  "podcast colombiano popular",
  "podcast español popular 2024",
  "canal youtube crossfit español",
  "canal youtube calistenia español",
  "canal youtube boxeo mma español",
  "canal youtube basketball español",
  "canal youtube golf español",
  "canal youtube tenis español",
  "canal youtube chess ajedrez español",
  "canal youtube poker español",
  "canal youtube coctelería bartender español",
  "canal youtube café barista español",
  "canal youtube panadería repostería español",
  "canal youtube jardinería huerto español",
  "canal youtube acuario pecera español",
  "canal youtube perros adiestramiento español",
  "canal youtube gatos mascotas español",
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

const newChannelIds = new Set();
let quotaUsed = 0;
let quotaExceeded = false;

console.log("=== SEARCHING ===\n");

for (const q of queries) {
  if (quotaExceeded) break;
  
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=50&relevanceLanguage=es&key=${API_KEY}`;
  const data = await fetchJSON(url);
  quotaUsed += 100;
  
  if (data === "QUOTA") {
    console.log(`⚠️  Quota exceeded at "${q}"`);
    quotaExceeded = true;
    break;
  }
  if (!data || !data.items) continue;
  
  let added = 0;
  for (const item of data.items) {
    const id = item.snippet?.channelId || item.id?.channelId;
    if (id && !allKnownChannelIds.has(id) && !newChannelIds.has(id)) {
      newChannelIds.add(id);
      added++;
    }
  }
  console.log(`  "${q}" → +${added} new (total: ${newChannelIds.size})`);
}

console.log(`\nNew unique channels found: ${newChannelIds.size}`);
console.log(`Quota used on search: ~${quotaUsed}\n`);

// Fetch details
console.log("=== FETCHING DETAILS ===\n");

const ids = [...newChannelIds];
const channels = [];

for (let i = 0; i < ids.length; i += 50) {
  const batch = ids.slice(i, i + 50);
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${batch.join(",")}&key=${API_KEY}`;
  const data = await fetchJSON(url);
  quotaUsed += 1;
  if (data === "QUOTA" || !data || !data.items) break;
  
  for (const ch of data.items) {
    const desc = ch.snippet.description || "";
    const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = [...new Set((desc.match(emailRe) || []))];
    const subs = parseInt(ch.statistics.subscriberCount || "0");
    const videos = parseInt(ch.statistics.videoCount || "0");
    
    channels.push({
      title: ch.snippet.title,
      channelId: ch.id,
      country: ch.snippet.country || "",
      subscribers: subs,
      videoCount: videos,
      emails: emails.join(";"),
      url: `https://youtube.com/channel/${ch.id}`,
    });
  }
  process.stdout.write(`  ${Math.min(i + 50, ids.length)}/${ids.length}\r`);
}

console.log(`\nChannels with details: ${channels.length}`);

// Filter: has email, not already sent, deduplicate
const seenEmails = new Set([...allSentEmails]);
const results = [];

const withEmail = channels
  .filter(ch => ch.emails && ch.emails.trim().length > 0)
  .sort((a, b) => b.subscribers - a.subscribers);

for (const ch of withEmail) {
  const emails = ch.emails.split(";").map(e => e.trim().toLowerCase());
  const newEmails = emails.filter(e => !seenEmails.has(e));
  if (newEmails.length > 0) {
    newEmails.forEach(e => seenEmails.add(e));
    results.push(ch);
  }
}

// Save
writeFileSync("batch3_channels.json", JSON.stringify(results, null, 2));

// Print
console.log(`\n=== BATCH 3: ${results.length} CANALES NUEVOS CON EMAIL ===\n`);
results.forEach((ch, i) => {
  const subs = ch.subscribers >= 1e6 ? `${(ch.subscribers / 1e6).toFixed(1)}M` : `${(ch.subscribers / 1e3).toFixed(0)}K`;
  const flag = ch.country || "??";
  console.log(`${String(i + 1).padStart(3)}. [${flag.padEnd(2)}] ${ch.title.padEnd(45)} ${subs.padStart(8)}  📧 ${ch.emails}`);
});

console.log(`\n=== RESUMEN ===`);
console.log(`Canales buscados: ${newChannelIds.size}`);
console.log(`Con email (nuevos): ${results.length}`);
console.log(`Quota total usada: ~${quotaUsed}`);
