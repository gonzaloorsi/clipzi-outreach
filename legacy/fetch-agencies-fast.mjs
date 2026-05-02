import { readFileSync, writeFileSync } from "fs";

// Load agency list from the previous script's JSON structure
// We'll hardcode the domains and just blast through them fast

const agencies = JSON.parse(readFileSync("agencies_list.json", "utf-8"));

async function fetchEmails(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3000);
    const r = await fetch(`https://${url}`, {
      signal: c.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const html = await r.text();
    const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    return [...new Set((html.match(re) || []))].filter(e =>
      !e.includes("example") && !e.includes("sentry") && !e.includes("webpack") &&
      !e.includes(".png") && !e.includes(".jpg") && !e.endsWith(".js") &&
      !e.includes("schema.org") && !e.includes("wixpress") && e.length < 60
    );
  } catch { return []; }
}

async function tryPages(base) {
  let emails = await fetchEmails(base);
  if (emails.length > 0) return emails;
  for (const p of ["/contacto", "/contact", "/nosotros"]) {
    emails = await fetchEmails(base + p);
    if (emails.length > 0) return emails;
  }
  return [];
}

const CONCURRENCY = 20;
const results = [];
let done = 0;

async function worker(queue) {
  while (queue.length > 0) {
    const ag = queue.shift();
    const emails = await tryPages(ag.web);
    const icon = emails.length > 0 ? "📧" : "❌";
    done++;
    console.log(`${String(done).padStart(3)}/${agencies.length} ${icon} [${ag.country.padEnd(6)}] ${ag.name.padEnd(35)} ${emails.join("; ") || "-"}`);
    results.push({ ...ag, emails: emails.join(";") });
  }
}

const queue = [...agencies];
const workers = Array.from({ length: CONCURRENCY }, () => worker(queue));
await Promise.all(workers);

// Save
writeFileSync("agencies_raw.json", JSON.stringify(results, null, 2));
const header = "country,name,web,emails";
const rows = results.map(r => {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return [r.country, esc(r.name), `https://${r.web}`, esc(r.emails)].join(",");
});
writeFileSync("agencies_raw.csv", [header, ...rows].join("\n"));

// Summary
const byCountry = {};
results.forEach(r => {
  if (!byCountry[r.country]) byCountry[r.country] = { total: 0, withEmail: 0 };
  byCountry[r.country].total++;
  if (r.emails.length > 0) byCountry[r.country].withEmail++;
});
console.log("\n=== RESUMEN ===");
Object.entries(byCountry).forEach(([c, d]) => console.log(`${c}: ${d.withEmail}/${d.total} con email`));
const total = results.filter(r => r.emails.length > 0).length;
console.log(`TOTAL: ${total}/${results.length} con email`);
