// refine-channels.mjs
// Reads the raw data, filters strictly to AR, and tries to fill gaps

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
const BASE = "https://www.googleapis.com/youtube/v3";

async function ytGet(endpoint, params) {
  const url = new URL(`${BASE}/${endpoint}`);
  params.key = API_KEY;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${await res.text()}`);
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractEmails(text) {
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(re) || [])];
}

async function searchChannels(query) {
  const ids = new Map();
  let pageToken = "";
  for (let page = 0; page < 2; page++) {
    const params = { part: "snippet", q: query, type: "channel", maxResults: "50", order: "relevance" };
    if (pageToken) params.pageToken = pageToken;
    const data = await ytGet("search", params);
    for (const item of data.items || []) ids.set(item.id.channelId, item.snippet.title);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    await sleep(200);
  }
  return ids;
}

async function getChannelDetails(channelIds) {
  const results = [];
  const arr = [...channelIds];
  for (let i = 0; i < arr.length; i += 50) {
    const batch = arr.slice(i, i + 50);
    const data = await ytGet("channels", {
      part: "snippet,statistics,brandingSettings",
      id: batch.join(","),
    });
    for (const ch of data.items || []) {
      const desc = ch.snippet?.description || "";
      results.push({
        channelId: ch.id,
        title: ch.snippet.title,
        country: ch.snippet?.country || "",
        subscribers: parseInt(ch.statistics?.subscriberCount || "0"),
        viewCount: parseInt(ch.statistics?.viewCount || "0"),
        videoCount: parseInt(ch.statistics?.videoCount || "0"),
        description: desc.replace(/\n/g, " ").slice(0, 500),
        emails: extractEmails(desc).join("; "),
        url: `https://youtube.com/channel/${ch.id}`,
      });
    }
    await sleep(300);
  }
  return results;
}

async function main() {
  // Read existing CSV and parse
  const csv = fs.readFileSync("top100_argentina_youtube.csv", "utf-8");
  const lines = csv.split("\n").slice(1).filter(l => l.trim());
  
  // Parse country from CSV (field index 3)
  // Let's just re-fetch all channels we already have and strictly filter by AR
  // But first, let me count how many AR channels we already have
  
  const existingAR = [];
  const existingOther = [];
  
  for (const line of lines) {
    // Simple CSV parse - country is 4th field (index 3)
    const match = line.match(/^\d+,"[^"]*",([^,]+),([^,]*),/);
    if (match) {
      const channelId = match[1];
      const country = match[2];
      if (country === "AR") {
        existingAR.push(channelId);
      } else {
        existingOther.push({ channelId, country });
      }
    }
  }
  
  console.log(`Canales existentes con country=AR: ${existingAR.length}`);
  console.log(`Canales de otros países: ${existingOther.length}`);
  
  // We need more AR channels. Let's do additional targeted searches
  const extraQueries = [
    "canal argentino youtube entretenimiento",
    "youtuber de buenos aires",
    "influencer argentino youtube",
    "argentina canal youtube suscriptores",
    "canal youtube cordoba argentina",
    "canal youtube rosario argentina", 
    "youtuber mendoza argentina",
    "animacion argentina youtube",
    "futbol argentino youtube canal",
    "trap argentino youtube canal",
    "rock argentino youtube canal",
    "noticias argentina youtube",
    "viajes argentina youtuber",
    "maquillaje argentina youtuber",
    "canal infantil argentino youtube",
    "comedia stand up argentina youtube",
    "ciencia argentina youtube",
    "historia argentina youtube canal",
    "emprendedor argentino youtube",
    "finanzas argentina youtube",
  ];

  // Known Argentine creator channel IDs (manually curated)
  const knownARChannelIds = [
    "UCnmE2tiDnmYWD0FDMCl-kiA", // El Demente
    "UC8hiDnhwE7ieY1atgDE_yUg", // Gonzok - check if AR
    "UCHt2IzH_lqcDFy24OeGlZJQ", // Coscu
    "UCd_OHI16jPGXx7DXBY3Jzzg", // Momo
    "UCGGhM6XCSJFQ6DTRffnKRIw", // Bizarrap Music Sessions
    "UC5dX3jmQJnVnF-AuN5N1W_A", // Te lo resumo
    "UCYiGq8XF7YQD00x7wAd62Zg", // JuegaGerman (CL actually)
    "UCXInOFOBGMz0huICdt4Zf4A", // Kevsho
    "UC4KSHlkQP01uYcfAFkkaRaQ", // Damirock
  ];
  
  const allChannelIds = new Set(existingAR);
  
  // Search more
  for (const q of extraQueries) {
    console.log(`Buscando: "${q}"...`);
    try {
      const found = await searchChannels(q);
      for (const [id] of found) allChannelIds.add(id);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
    await sleep(100);
  }
  
  for (const id of knownARChannelIds) allChannelIds.add(id);
  
  console.log(`\nTotal IDs a verificar: ${allChannelIds.size}`);
  
  // Get details for ALL collected channels
  const allDetails = await getChannelDetails([...allChannelIds]);
  
  // STRICT filter: only country=AR
  const arChannels = allDetails
    .filter(ch => ch.country === "AR")
    .sort((a, b) => b.subscribers - a.subscribers)
    .slice(0, 100);
  
  console.log(`\nCanales estrictamente argentinos (country=AR): ${arChannels.length}`);
  
  // Output CSV
  const header = "rank,title,channelId,country,subscribers,viewCount,videoCount,emails,url,description";
  const rows = arChannels.map((ch, i) => {
    const esc = s => `"${String(s).replace(/"/g, '""')}"`;
    return [i + 1, esc(ch.title), ch.channelId, ch.country, ch.subscribers, ch.viewCount, ch.videoCount, esc(ch.emails), ch.url, esc(ch.description)].join(",");
  });
  
  fs.writeFileSync("top100_argentina_youtube.csv", [header, ...rows].join("\n"));
  
  // Also save a clean JSON for later use
  fs.writeFileSync("top100_argentina_youtube.json", JSON.stringify(arChannels, null, 2));
  
  const withEmail = arChannels.filter(ch => ch.emails.length > 0);
  console.log(`\n=== RESUMEN FINAL ===`);
  console.log(`Total canales AR en CSV: ${arChannels.length}`);
  console.log(`Con email: ${withEmail.length}`);
  console.log(`Sin email: ${arChannels.length - withEmail.length}`);
  console.log(`\nTop 20:`);
  arChannels.slice(0, 20).forEach((ch, i) => {
    console.log(`  ${i + 1}. ${ch.title} - ${(ch.subscribers / 1e6).toFixed(2)}M subs - Email: ${ch.emails || "❌"}`);
  });
  console.log(`\n--- Canales CON email ---`);
  withEmail.forEach((ch, i) => {
    console.log(`  ${i + 1}. ${ch.title} (${(ch.subscribers / 1e6).toFixed(2)}M) -> ${ch.emails}`);
  });
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
