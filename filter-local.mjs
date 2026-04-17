// filter-local.mjs - Works purely with the data we already have
// Filters the 100 channels from the first run, keeping only verified Argentine channels

import fs from "fs";

// Parse the CSV properly (handles quoted fields with commas)
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

const csv = fs.readFileSync("top100_argentina_youtube.csv", "utf-8");
const lines = csv.split("\n");
const header = lines[0];
const dataLines = lines.slice(1).filter(l => l.trim());

const channels = dataLines.map(line => {
  const f = parseCSVLine(line);
  return {
    rank: parseInt(f[0]),
    title: f[1],
    channelId: f[2],
    country: f[3],
    subscribers: parseInt(f[4]),
    viewCount: parseInt(f[5]),
    videoCount: parseInt(f[6]),
    emails: f[7],
    url: f[8],
    description: f[9],
  };
});

// Known Argentine YouTuber channel IDs (verified)
const knownArgentineIds = new Set([
  "UCZs0WwC0Dn_noiQE2BHSTKg", // Alejo Igoa
  "UCaHEdZtk6k7SVP-umnzifmQ", // TheDonato
  "UCmzDf_a7CCFuxos7hspcWRQ", // Ian Lucas
  "UCYydV0b9GawikL_L5b2yt-Q", // benja calero
  "UC-cnbLlplnXA4oc7rR21qzg", // Lyna
  "UCNYW2vfGrUE6R5mIJYzkRyQ", // DrossRotzank (Venezuelan but based in Argentina)
  "UCzI7wZyqk7jpXWT_MILjepw", // Paulo Londra
  "UCmS75G-98QihSusY7NfCZtw", // Bizarrap
  "UC9Bjwt2uBUkspqGHF4MQatw", // Natupuboldi
  "UCG8eSYvOQUpb9HM8zU5d6xg", // RobleisIUTU
  "UCnmE2tiDnmYWD0FDMCl-kiA", // El Demente
  "UCd_OHI16jPGXx7DXBY3Jzzg", // Momo
  "UCHt2IzH_lqcDFy24OeGlZJQ", // Coscu
  "UCXInOFOBGMz0huICdt4Zf4A", // Kevsho  
  "UC4KSHlkQP01uYcfAFkkaRaQ", // Damirock
  "UC5dX3jmQJnVnF-AuN5N1W_A", // Te lo resumo
]);

// Filter: country=AR OR in known list, AND NOT clearly from another country
const nonARCountries = new Set(["MX", "CL", "PR", "CO", "ES", "PE", "VE", "US", "BR", "EC", "UY", "PY", "DO", "CU", "GT", "HN", "SV", "CR", "PA", "NI", "BO"]);

const argChannels = channels.filter(ch => {
  // If explicitly AR, keep
  if (ch.country === "AR") return true;
  // If known Argentine creator, keep
  if (knownArgentineIds.has(ch.channelId)) return true;
  // If explicitly another country, skip
  if (nonARCountries.has(ch.country) && ch.country !== "") return false;
  // If no country set but description hints at Argentina
  const descLower = (ch.description || "").toLowerCase();
  if (/(argentin|buenos aires|\barg\b|🇦🇷)/.test(descLower)) return true;
  return false;
}).sort((a, b) => b.subscribers - a.subscribers);

console.log(`Canales argentinos filtrados: ${argChannels.length}`);

// Generate final CSV
const headerOut = "rank,title,channelId,country,subscribers,viewCount,videoCount,emails,url,description";
const rows = argChannels.map((ch, i) => {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return [
    i + 1,
    esc(ch.title),
    ch.channelId,
    ch.country || "AR*",
    ch.subscribers,
    ch.viewCount,
    ch.videoCount,
    esc(ch.emails),
    ch.url,
    esc(ch.description),
  ].join(",");
});

fs.writeFileSync("top100_argentina_youtube_FINAL.csv", [headerOut, ...rows].join("\n"));

// Save JSON too
fs.writeFileSync("top100_argentina_youtube_FINAL.json", JSON.stringify(argChannels, null, 2));

const withEmail = argChannels.filter(ch => ch.emails && ch.emails.trim().length > 0);
console.log(`\n=== RESULTADO FINAL ===`);
console.log(`Total canales argentinos: ${argChannels.length}`);
console.log(`Con email de contacto: ${withEmail.length}`);
console.log(`Sin email: ${argChannels.length - withEmail.length}`);

console.log(`\n--- RANKING COMPLETO ---`);
argChannels.forEach((ch, i) => {
  const subs = ch.subscribers >= 1e6 ? `${(ch.subscribers / 1e6).toFixed(1)}M` : `${(ch.subscribers / 1e3).toFixed(0)}K`;
  console.log(`${String(i+1).padStart(3)}. ${ch.title.padEnd(35)} ${subs.padStart(8)} subs  Email: ${ch.emails || "❌"}`);
});

console.log(`\n--- CONTACTOS CON EMAIL (${withEmail.length}) ---`);
withEmail.forEach((ch, i) => {
  console.log(`${i+1}. ${ch.title} -> ${ch.emails}`);
});
