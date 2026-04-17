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

const API_KEY = process.env.YOUTUBE_API_KEY;

// Already sent emails - avoid duplicates
const alreadySent = JSON.parse(fs.readFileSync("send_results.json", "utf-8"));
const sentEmails = new Set(alreadySent.map(s => s.email.toLowerCase()));
const sentChannels = new Set(alreadySent.map(s => s.channel));

console.log(`Already sent: ${sentEmails.size} emails to ${sentChannels.size} channels`);

// Search queries targeting LATAM YouTubers across different niches
const searchQueries = [
  // By country
  "youtuber argentina",
  "youtuber mexico",
  "youtuber colombia",
  "youtuber chile",
  "youtuber peru",
  "youtuber uruguay",
  "youtuber venezuela",
  "youtuber ecuador",
  "youtuber dominicana",
  // By niche (Spanish)
  "gaming español latino",
  "vlogs español latino",
  "comedia español youtube",
  "podcast español latino",
  "cocina recetas latino",
  "fitness español youtube",
  "tecnologia español review",
  "musica latina canal",
  "entretenimiento latino youtube",
  "educacion español youtube",
  "react español latino",
  "storytime español",
  "maquillaje tutorial latino",
  "deportes futbol español",
  "animacion español",
  "cripto finanzas español",
  "viajes travel latino",
  "humor comedia latino",
  "minecraft español",
  "fortnite español latino",
];

const allChannelIds = new Set();
const channelDetails = [];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`API error: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error(text.slice(0, 200));
    return null;
  }
  return res.json();
}

// Step 1: Search for channels
console.log("\n=== STEP 1: Searching for channels ===\n");

for (const query of searchQueries) {
  let pageToken = "";
  let pages = 0;
  
  while (pages < 3) { // Up to 3 pages per query (150 results per query)
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=50&relevanceLanguage=es&key=${API_KEY}${pageToken ? "&pageToken=" + pageToken : ""}`;
    
    const data = await fetchJSON(url);
    if (!data || !data.items) break;
    
    for (const item of data.items) {
      const channelId = item.snippet.channelId || item.id.channelId;
      if (channelId) allChannelIds.add(channelId);
    }
    
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
    pages++;
  }
  
  console.log(`"${query}" -> total unique channels so far: ${allChannelIds.size}`);
}

console.log(`\nTotal unique channel IDs found: ${allChannelIds.size}`);

// Step 2: Get channel details in batches of 50
console.log("\n=== STEP 2: Fetching channel details ===\n");

const channelIdArray = [...allChannelIds];
const BATCH_SIZE = 50;

for (let i = 0; i < channelIdArray.length; i += BATCH_SIZE) {
  const batch = channelIdArray.slice(i, i + BATCH_SIZE);
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings&id=${batch.join(",")}&key=${API_KEY}`;
  
  const data = await fetchJSON(url);
  if (!data || !data.items) continue;
  
  for (const ch of data.items) {
    const title = ch.snippet.title;
    const desc = ch.snippet.description || "";
    const country = ch.snippet.country || "";
    const subs = parseInt(ch.statistics.subscriberCount || "0");
    const views = parseInt(ch.statistics.viewCount || "0");
    const videos = parseInt(ch.statistics.videoCount || "0");
    
    // Extract emails from description
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = [...new Set((desc.match(emailRegex) || []))].join(";");
    
    channelDetails.push({
      title,
      channelId: ch.id,
      country,
      subscribers: subs,
      viewCount: views,
      videoCount: videos,
      emails,
      url: `https://youtube.com/channel/${ch.id}`,
      description: desc.slice(0, 200),
    });
  }
  
  process.stdout.write(`  Fetched ${Math.min(i + BATCH_SIZE, channelIdArray.length)}/${channelIdArray.length} channels\r`);
}

console.log(`\nTotal channels with details: ${channelDetails.length}`);

// Step 3: Filter - only channels with emails, not already sent, sorted by subs
const newChannels = channelDetails
  .filter(ch => {
    if (!ch.emails || ch.emails.trim().length === 0) return false;
    // Check if any of their emails were already sent
    const emails = ch.emails.split(";").map(e => e.trim().toLowerCase());
    return !emails.some(e => sentEmails.has(e));
  })
  .sort((a, b) => b.subscribers - a.subscribers);

// Deduplicate by email
const seenEmails = new Set();
const dedupedChannels = [];
for (const ch of newChannels) {
  const emails = ch.emails.split(";").map(e => e.trim().toLowerCase());
  const newEmails = emails.filter(e => !seenEmails.has(e));
  if (newEmails.length > 0) {
    newEmails.forEach(e => seenEmails.add(e));
    dedupedChannels.push(ch);
  }
}

console.log(`\nChannels with NEW emails (not yet sent): ${dedupedChannels.length}`);

// Save results
const header = "rank,title,channelId,country,subscribers,viewCount,videoCount,emails,url";
const rows = dedupedChannels.map((ch, i) => {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return [i + 1, esc(ch.title), ch.channelId, ch.country, ch.subscribers, ch.viewCount, ch.videoCount, esc(ch.emails), ch.url].join(",");
});
fs.writeFileSync("batch2_new_channels.csv", [header, ...rows].join("\n"));
fs.writeFileSync("batch2_new_channels.json", JSON.stringify(dedupedChannels.map((ch, i) => ({
  rank: i + 1,
  title: ch.title,
  channelId: ch.channelId,
  country: ch.country,
  subscribers: ch.subscribers,
  videoCount: ch.videoCount,
  emails: ch.emails,
  url: ch.url,
})), null, 2));

// Print summary
console.log("\n=== NUEVOS CANALES CON EMAIL (NO ENVIADOS AÚN) ===\n");
dedupedChannels.forEach((ch, i) => {
  const subs = ch.subscribers >= 1e6 ? `${(ch.subscribers / 1e6).toFixed(1)}M` : `${(ch.subscribers / 1e3).toFixed(0)}K`;
  const flag = ch.country || "??";
  console.log(`${String(i + 1).padStart(3)}. [${flag.padEnd(2)}] ${ch.title.padEnd(40)} ${subs.padStart(8)}  📧 ${ch.emails}`);
});

// Count total new emails
let totalNewEmails = 0;
dedupedChannels.forEach(ch => {
  totalNewEmails += ch.emails.split(";").filter(e => e.trim()).length;
});

console.log(`\n=== RESUMEN BATCH 2 ===`);
console.log(`Canales buscados: ${allChannelIds.size}`);
console.log(`Canales con detalles: ${channelDetails.length}`);
console.log(`Nuevos canales con email: ${dedupedChannels.length}`);
console.log(`Nuevos emails totales: ${totalNewEmails}`);
console.log(`Archivos: batch2_new_channels.csv, batch2_new_channels.json`);
