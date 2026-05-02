// fetch-channels.mjs
// Finds top 100 Argentine YouTube channels and extracts contact emails

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

// --- helpers ---
async function ytGet(endpoint, params) {
  const url = new URL(`${BASE}/${endpoint}`);
  params.key = API_KEY;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Extract emails from text
function extractEmails(text) {
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(re) || [])];
}

// --- Step 1: Collect channel IDs from multiple search queries ---
async function searchChannels(query, maxPages = 2) {
  const ids = new Map(); // channelId -> title
  let pageToken = "";
  for (let page = 0; page < maxPages; page++) {
    const params = {
      part: "snippet",
      q: query,
      type: "channel",
      maxResults: "50",
      order: "relevance",
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await ytGet("search", params);
    for (const item of data.items || []) {
      ids.set(item.id.channelId, item.snippet.title);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    await sleep(200);
  }
  return ids;
}

// --- Step 2: Get channel details in batches of 50 ---
async function getChannelDetails(channelIds) {
  const results = [];
  const batches = [];
  const arr = [...channelIds];
  for (let i = 0; i < arr.length; i += 50) {
    batches.push(arr.slice(i, i + 50));
  }
  for (const batch of batches) {
    const data = await ytGet("channels", {
      part: "snippet,statistics,brandingSettings",
      id: batch.join(","),
    });
    for (const ch of data.items || []) {
      const desc = ch.snippet?.description || "";
      const country = ch.snippet?.country || "";
      const emails = extractEmails(desc);
      results.push({
        channelId: ch.id,
        title: ch.snippet.title,
        country,
        subscribers: parseInt(ch.statistics?.subscriberCount || "0"),
        viewCount: parseInt(ch.statistics?.viewCount || "0"),
        videoCount: parseInt(ch.statistics?.videoCount || "0"),
        description: desc.replace(/\n/g, " ").slice(0, 500),
        emails: emails.join("; "),
        url: `https://youtube.com/channel/${ch.id}`,
      });
    }
    await sleep(300);
  }
  return results;
}

// --- Main ---
async function main() {
  console.log("=== Buscando top canales argentinos de YouTube ===\n");

  // Multiple search queries to maximize coverage of Argentine creators
  const queries = [
    "youtubers argentinos más famosos",
    "top youtubers argentina 2024",
    "canales youtube argentina populares",
    "youtuber argentino gaming",
    "youtuber argentino comedia humor",
    "youtuber argentino vlogs",
    "youtuber argentino música",
    "streamer argentino youtube",
    "creador de contenido argentino",
    "argentina youtube canal grande",
    "mejores youtubers argentina",
    "youtubers argentinos nuevos",
    "podcast argentino youtube",
    "youtuber argentino cocina",
    "youtuber argentino tecnología",
    "youtuber argentino reaccion",
    "youtuber argentino educacion",
    "youtuber argentino fitness deporte",
  ];

  // Also add known top Argentine creators by name to search directly
  const knownCreators = [
    "El Demente youtube",
    "Momo youtube argentina",
    "Coscu youtube",
    "Luquita Rodriguez",
    "La Faraona youtube",
    "DrossRotzank",
    "PedritoVM",
    "Gonzok youtube",
    "Ezzequiel youtube",
    "Mati Spano",
    "Santiago Maratea",
    "Bizarrap",
    "Duki oficial",
    "Tini youtube oficial",
    "Lit Killah youtube",
    "Wos youtube",
    "Paulo Londra youtube",
    "Kevsho youtube",
    "Damirock youtube",
    "Lyna youtube argentina",
    "Robleis youtube",
    "JaviMZN youtube",
    "Marito Baracus youtube",
    "Martina La Peligrosa argentina",
    "Paulettee youtube",
    "Mestman youtube",
    "TheDonato youtube",
    "Cracks youtube argentina",
    "Tomiii11 argentina",
    "Agustin51 youtube",
    "NicoRobin youtube argentina",
    "Exi youtube argentina",
    "Fran Gomez youtube",
    "Sofi Morandi youtube",
    "Julián Serrano youtube",
    "Soy Rada youtube",
    "Mateo Faria youtube",
    "Nadie Sabe Nada youtube argentina",
    "Te Lo Resumo youtube",
    "Damián Kuc youtube",
    "Pilo youtube argentina",
    "Ale Crimi youtube",
    "Grego Rossello youtube",
    "Luzu youtube",
  ];

  const allChannelIds = new Map();

  // Search with general queries
  for (const q of queries) {
    console.log(`Buscando: "${q}"...`);
    try {
      const found = await searchChannels(q, 1);
      for (const [id, title] of found) allChannelIds.set(id, title);
      console.log(`  -> ${found.size} canales (total acumulado: ${allChannelIds.size})`);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
    await sleep(100);
  }

  // Search known creators
  for (const q of knownCreators) {
    console.log(`Buscando creador: "${q}"...`);
    try {
      const found = await searchChannels(q, 1);
      for (const [id, title] of found) allChannelIds.set(id, title);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
    await sleep(100);
  }

  console.log(`\nTotal canales únicos encontrados: ${allChannelIds.size}`);
  console.log("Obteniendo detalles de cada canal...\n");

  // Get details for all channels
  const allDetails = await getChannelDetails([...allChannelIds.keys()]);

  // Filter: keep only channels that are likely Argentine
  // (country=AR, or found via Argentine-specific searches)
  // Then sort by subscriber count
  const argChannels = allDetails
    .filter((ch) => {
      const isAR = ch.country === "AR";
      const descHints = /(argentin|buenos aires|cordoba|rosario|mendoza|tucuman)/i.test(ch.description);
      // Keep if explicitly AR, or description hints, or has high sub count (manual review)
      return isAR || descHints || ch.subscribers > 100000;
    })
    .sort((a, b) => b.subscribers - a.subscribers)
    .slice(0, 100);

  console.log(`Canales argentinos filtrados: ${argChannels.length}`);

  // --- Output CSV ---
  const header = "rank,title,channelId,country,subscribers,viewCount,videoCount,emails,url,description";
  const rows = argChannels.map((ch, i) => {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    return [
      i + 1,
      esc(ch.title),
      ch.channelId,
      ch.country,
      ch.subscribers,
      ch.viewCount,
      ch.videoCount,
      esc(ch.emails),
      ch.url,
      esc(ch.description),
    ].join(",");
  });

  const csv = [header, ...rows].join("\n");
  const fs = await import("fs");
  fs.writeFileSync("top100_argentina_youtube.csv", csv);
  console.log(`\n✓ CSV guardado: top100_argentina_youtube.csv`);

  // Summary
  const withEmail = argChannels.filter((ch) => ch.emails.length > 0);
  console.log(`\n=== RESUMEN ===`);
  console.log(`Total canales en CSV: ${argChannels.length}`);
  console.log(`Con email encontrado: ${withEmail.length}`);
  console.log(`Sin email: ${argChannels.length - withEmail.length}`);
  console.log(`\nTop 10 por suscriptores:`);
  argChannels.slice(0, 10).forEach((ch, i) => {
    console.log(`  ${i + 1}. ${ch.title} - ${(ch.subscribers / 1e6).toFixed(2)}M subs - Email: ${ch.emails || "N/A"}`);
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
