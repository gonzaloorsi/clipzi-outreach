import fs from "fs";

// Parse the CSV properly
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current); current = "";
    } else current += ch;
  }
  fields.push(current);
  return fields;
}

const csv = fs.readFileSync("top100_argentina_youtube.csv", "utf-8");
const lines = csv.split("\n").slice(1).filter(l => l.trim());

const channels = lines.map(line => {
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
}).sort((a, b) => b.subscribers - a.subscribers).slice(0, 100);

// Output final CSV
const header = "rank,title,channelId,country,subscribers,viewCount,videoCount,emails,url";
const rows = channels.map((ch, i) => {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return [i + 1, esc(ch.title), ch.channelId, ch.country, ch.subscribers, ch.viewCount, ch.videoCount, esc(ch.emails), ch.url].join(",");
});
fs.writeFileSync("top100_latam_youtube_FINAL.csv", [header, ...rows].join("\n"));

// JSON for email sending later
const json = channels.map((ch, i) => ({
  rank: i + 1,
  title: ch.title,
  channelId: ch.channelId,
  country: ch.country,
  subscribers: ch.subscribers,
  emails: ch.emails,
  url: ch.url,
}));
fs.writeFileSync("top100_latam_youtube_FINAL.json", JSON.stringify(json, null, 2));

const withEmail = channels.filter(ch => ch.emails && ch.emails.trim().length > 0);
const uniqueEmails = new Set();
withEmail.forEach(ch => ch.emails.split(";").map(e => e.trim()).filter(Boolean).forEach(e => uniqueEmails.add(e)));

console.log("=== TOP 100 CANALES LATAM - FINAL ===\n");
channels.forEach((ch, i) => {
  const subs = ch.subscribers >= 1e6 ? `${(ch.subscribers / 1e6).toFixed(1)}M` : `${(ch.subscribers / 1e3).toFixed(0)}K`;
  const flag = ch.country || "??";
  const email = ch.emails && ch.emails.trim() ? `📧 ${ch.emails}` : "❌";
  console.log(`${String(i+1).padStart(3)}. [${flag.padEnd(2)}] ${ch.title.padEnd(35)} ${subs.padStart(8)}  ${email}`);
});

console.log(`\n=== RESUMEN ===`);
console.log(`Total canales: ${channels.length}`);
console.log(`Con email: ${withEmail.length}`);
console.log(`Emails únicos: ${uniqueEmails.size}`);
console.log(`Sin email: ${channels.length - withEmail.length}`);

console.log(`\n=== LISTA DE EMAILS PARA ENVÍO (${uniqueEmails.size}) ===`);
[...uniqueEmails].forEach((email, i) => {
  const ch = withEmail.find(c => c.emails.includes(email));
  console.log(`${i+1}. ${ch.title} -> ${email}`);
});
