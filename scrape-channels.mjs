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
if (!API_KEY) {
  console.error("Missing YOUTUBE_API_KEY in .env");
  process.exit(1);
}

// Already sent emails - avoid duplicates
let sentEmails = new Set();
try {
  const sent = JSON.parse(readFileSync("send_results.json", "utf-8"));
  sent.forEach((s) => sentEmails.add(s.email.toLowerCase()));
  console.log(`Already sent: ${sentEmails.size} emails\n`);
} catch (e) {}

// Already known channel IDs from batch 1
let knownChannelIds = new Set();
try {
  const existing = JSON.parse(readFileSync("top100_latam_youtube_FINAL.json", "utf-8"));
  existing.forEach((ch) => knownChannelIds.add(ch.channelId));
  console.log(`Known channels from batch 1: ${knownChannelIds.size}\n`);
} catch (e) {}

const allChannelIds = new Set();

// ============================================================
// STRATEGY 1: Use YouTube search sparingly - targeted high-value queries
// Each search = 100 units, but we'll do fewer, more specific ones
// ============================================================

const searchQueries = [
  // Specific niches that typically have business emails
  "podcast argentina entrevistas",
  "podcast mexico entrevistas",
  "podcast colombia",
  "canal educativo español",
  "marketing digital español",
  "emprendimiento negocios español",
  "productividad español youtube",
  "desarrollo personal español",
  "programacion español tutorial",
  "diseño grafico español",
  "fotografia español tutorial",
  "edicion video tutorial español",
  "filmmaker latino",
  "creador contenido tips español",
  "resumen peliculas español",
  "true crime español",
  "asmr español latino",
  "musica independiente argentina",
  "musica independiente mexico",
  "rap freestyle español",
];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("quota")) {
      console.error("⚠️  QUOTA EXCEEDED - stopping searches");
      return null;
    }
    console.error(`API error: ${res.status}`);
    return null;
  }
  return res.json();
}

// Step 1: Targeted searches (20 queries × 100 units = 2,000 units)
console.log("=== STEP 1: Targeted YouTube searches (20 queries) ===\n");
let quotaUsed = 0;

for (const query of searchQueries) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=50&relevanceLanguage=es&key=${API_KEY}`;
  const data = await fetchJSON(url);
  quotaUsed += 100;
  
  if (!data || !data.items) {
    console.log(`  ⚠️ Quota hit at "${query}" - stopping searches`);
    break;
  }
  
  let newCount = 0;
  for (const item of data.items) {
    const channelId = item.snippet?.channelId || item.id?.channelId;
    if (channelId && !knownChannelIds.has(channelId)) {
      allChannelIds.add(channelId);
      newCount++;
    }
  }
  console.log(`  "${query}" → +${newCount} new (total: ${allChannelIds.size})`);
}

// ============================================================
// STRATEGY 2: Get "related channels" from channels we already know
// Using channelSections or search within specific channels
// This is free - uses channels.list at 1 unit per call
// ============================================================

console.log("\n=== STEP 2: Fetching related/featured channels ===\n");

// Use some of our known channel IDs to find their featured channels
const knownIds = [...knownChannelIds].slice(0, 50);
for (let i = 0; i < knownIds.length; i += 50) {
  const batch = knownIds.slice(i, i + 50);
  const url = `https://www.googleapis.com/youtube/v3/channels?part=brandingSettings&id=${batch.join(",")}&key=${API_KEY}`;
  const data = await fetchJSON(url);
  quotaUsed += 1;
  if (!data || !data.items) continue;
  
  for (const ch of data.items) {
    const featured = ch.brandingSettings?.channel?.featuredChannelsUrls || [];
    featured.forEach((id) => {
      if (!knownChannelIds.has(id)) allChannelIds.add(id);
    });
  }
  console.log(`  Featured channels from batch → total new: ${allChannelIds.size}`);
}

// ============================================================
// STRATEGY 3: Search for specific channel sizes (mid-tier more likely to have emails)
// ============================================================

console.log("\n=== STEP 3: More targeted searches (mid-tier creators) ===\n");

const midTierQueries = [
  "youtuber latino canal 2024",
  "creador contenido latinoamerica",
  "canal youtube español gaming",
  "canal youtube español vlogs 2024",
  "canal youtube recetas cocina latino",
  "canal youtube fitness ejercicio español",
  "canal humor comedia argentina",
  "canal humor comedia mexico",
  "canal tecnologia gadgets español",
  "canal viajes turismo latinoamerica",
  "canal moda belleza latina",
  "canal finanzas personales español",
  "canal historia cultura español",
  "canal ciencia divulgacion español",
  "canal manualidades diy español",
  "canal motivacion autoayuda español",
  "canal deportes futbol latino",
  "canal anime manga español",
  "canal terror misterio español",
  "canal automoviles autos español",
  "canal mascotas animales español",
  "canal jardineria plantas español",
  "streamer latino twitch youtube",
  "canal reaccion react español",
  "canal tops datos curiosos español",
  "canal noticias actualidad latino",
  "canal musica covers español",
  "canal baile danza español",
  "canal carpinteria construccion español",
  "canal electronica arduino español",
];

for (const query of midTierQueries) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=50&relevanceLanguage=es&key=${API_KEY}`;
  const data = await fetchJSON(url);
  quotaUsed += 100;
  
  if (!data || !data.items) {
    console.log(`  ⚠️ Quota hit at "${query}" - stopping`);
    break;
  }
  
  let newCount = 0;
  for (const item of data.items) {
    const channelId = item.snippet?.channelId || item.id?.channelId;
    if (channelId && !knownChannelIds.has(channelId)) {
      allChannelIds.add(channelId);
      newCount++;
    }
  }
  console.log(`  "${query}" → +${newCount} new (total: ${allChannelIds.size})`);
}

console.log(`\n=== SEARCH COMPLETE ===`);
console.log(`Total new unique channel IDs: ${allChannelIds.size}`);
console.log(`Estimated quota used on searches: ~${quotaUsed} units\n`);

// ============================================================
// STEP 4: Fetch details for ALL new channels (1 unit per 50)
// ============================================================

console.log("=== STEP 4: Fetching channel details ===\n");

const channelIdArray = [...allChannelIds];
const BATCH_SIZE = 50;
const channelDetails = [];

for (let i = 0; i < channelIdArray.length; i += BATCH_SIZE) {
  const batch = channelIdArray.slice(i, i + BATCH_SIZE);
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings&id=${batch.join(",")}&key=${API_KEY}`;
  
  const data = await fetchJSON(url);
  quotaUsed += 1;
  if (!data || !data.items) continue;
  
  for (const ch of data.items) {
    const title = ch.snippet.title;
    const desc = ch.snippet.description || "";
    const country = ch.snippet.country || "";
    const subs = parseInt(ch.statistics.subscriberCount || "0");
    const views = parseInt(ch.statistics.viewCount || "0");
    const videos = parseInt(ch.statistics.videoCount || "0");
    
    // Extract emails
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = [...new Set((desc.match(emailRegex) || []))].join(";");
    
    channelDetails.push({
      title, channelId: ch.id, country, subscribers: subs,
      viewCount: views, videoCount: videos, emails,
      url: `https://youtube.com/channel/${ch.id}`,
    });
  }
  
  process.stdout.write(`  ${Math.min(i + BATCH_SIZE, channelIdArray.length)}/${channelIdArray.length} channels fetched\r`);
}

console.log(`\nTotal channels fetched: ${channelDetails.length}`);
console.log(`Estimated total quota used: ~${quotaUsed} units\n`);

// ============================================================
// STEP 5: Filter channels with NEW emails
// ============================================================

const newChannels = channelDetails
  .filter((ch) => {
    if (!ch.emails || ch.emails.trim().length === 0) return false;
    const emails = ch.emails.split(";").map((e) => e.trim().toLowerCase());
    return !emails.some((e) => sentEmails.has(e));
  })
  .sort((a, b) => b.subscribers - a.subscribers);

// Deduplicate
const seenEmails = new Set([...sentEmails]);
const dedupedChannels = [];
for (const ch of newChannels) {
  const emails = ch.emails.split(";").map((e) => e.trim().toLowerCase());
  const newEmails = emails.filter((e) => !seenEmails.has(e));
  if (newEmails.length > 0) {
    newEmails.forEach((e) => seenEmails.add(e));
    dedupedChannels.push(ch);
  }
}

// Save
const header = "rank,title,channelId,country,subscribers,viewCount,videoCount,emails,url";
const rows = dedupedChannels.map((ch, i) => {
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  return [i + 1, esc(ch.title), ch.channelId, ch.country, ch.subscribers, ch.viewCount, ch.videoCount, esc(ch.emails), ch.url].join(",");
});
writeFileSync("batch2_new_channels.csv", [header, ...rows].join("\n"));
writeFileSync("batch2_new_channels.json", JSON.stringify(dedupedChannels.map((ch, i) => ({
  rank: i + 1, title: ch.title, channelId: ch.channelId, country: ch.country,
  subscribers: ch.subscribers, videoCount: ch.videoCount, emails: ch.emails, url: ch.url,
})), null, 2));

// Print results
console.log("=== NUEVOS CANALES CON EMAIL (BATCH 2) ===\n");
dedupedChannels.forEach((ch, i) => {
  const subs = ch.subscribers >= 1e6 ? `${(ch.subscribers / 1e6).toFixed(1)}M` : `${(ch.subscribers / 1e3).toFixed(0)}K`;
  const flag = ch.country || "??";
  console.log(`${String(i + 1).padStart(3)}. [${flag.padEnd(2)}] ${ch.title.padEnd(40)} ${subs.padStart(8)}  📧 ${ch.emails}`);
});

let totalNewEmails = 0;
dedupedChannels.forEach((ch) => {
  totalNewEmails += ch.emails.split(";").filter((e) => e.trim()).length;
});

console.log(`\n=== RESUMEN BATCH 2 ===`);
console.log(`Canales buscados: ${allChannelIds.size}`);
console.log(`Canales con detalles: ${channelDetails.length}`);
console.log(`Nuevos canales con email (no duplicados): ${dedupedChannels.length}`);
console.log(`Nuevos emails totales: ${totalNewEmails}`);
console.log(`Quota estimada usada: ~${quotaUsed} units (de 10,000)`);
