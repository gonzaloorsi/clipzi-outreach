import { writeFileSync } from "fs";

// Known LATAM/Spanish Substack publications + journalist newsletters
// We'll also try fetching Substack's explore/leaderboard pages
const knownSubstacks = [
  // Argentina
  { subdomain: "cenital", name: "Cenital" },
  { subdomain: "sebacampanario", name: "Seba Campanario" },
  { subdomain: "pfranco", name: "Pablo Franco" },
  { subdomain: "javierpallero", name: "Javier Pallero" },
  { subdomain: "futurock", name: "Futurock" },
  { subdomain: "revistacrisis", name: "Revista Crisis" },
  { subdomain: "latinta", name: "La Tinta" },
  { subdomain: "juansalatino", name: "Juan Salatino" },
  { subdomain: "ieconomics", name: "iEconomics" },
  { subdomain: "aleberco", name: "Ale Berco" },
  { subdomain: "martinbecerra", name: "Martín Becerra" },
  { subdomain: "nataliazuazo", name: "Natalia Zuazo" },
  { subdomain: "sangrenegra", name: "Sangre Negra" },
  { subdomain: "pablomancini", name: "Pablo Mancini" },
  { subdomain: "eldiarioar", name: "El Diario AR" },
  { subdomain: "jordibustamante", name: "Jordi Bustamante" },
  // Mexico
  { subdomain: "gatopardo", name: "Gatopardo" },
  { subdomain: "lfranco", name: "Luis Franco" },
  { subdomain: "nexos", name: "Nexos" },
  { subdomain: "sopitas", name: "Sopitas" },
  { subdomain: "dariocelis", name: "Darío Celis" },
  { subdomain: "letraslibres", name: "Letras Libres" },
  { subdomain: "animalpolítico", name: "Animal Político" },
  { subdomain: "sinembargo", name: "Sin Embargo" },
  { subdomain: "lasillarota", name: "La Silla Rota" },
  { subdomain: "elpais", name: "El País" },
  { subdomain: "eleconomista", name: "El Economista" },
  // Colombia
  { subdomain: "lasillavacia", name: "La Silla Vacía" },
  { subdomain: "danielsamper", name: "Daniel Samper" },
  { subdomain: "razonpublica", name: "Razón Pública" },
  { subdomain: "cerosetenta", name: "Cerosetenta" },
  { subdomain: "juanitaleón", name: "Juanita León" },
  // Chile
  { subdomain: "ciperchile", name: "CIPER Chile" },
  { subdomain: "pauta", name: "Pauta" },
  { subdomain: "theclinic", name: "The Clinic" },
  { subdomain: "elmostrador", name: "El Mostrador" },
  // Spain
  { subdomain: "elpais", name: "El País" },
  { subdomain: "kloshletter", name: "Kloshletter" },
  { subdomain: "charlysinewan", name: "Charly Sinewan" },
  { subdomain: "jaimegarrido", name: "Jaime Garrido" },
  { subdomain: "miguelcasal", name: "Miguel Casal" },
  // Tech/Startup LATAM
  { subdomain: "platzi", name: "Platzi" },
  { subdomain: "contxto", name: "Contxto" },
  { subdomain: "startupeable", name: "Startupeable" },
  { subdomain: "techcetera", name: "Techcetera" },
  { subdomain: "lfranco", name: "Luis Franco Tech" },
  { subdomain: "soyentrepreneur", name: "Soy Entrepreneur" },
];

// Also try Substack's category/explore pages
async function fetchSubstackCategory(category) {
  try {
    const url = `https://substack.com/api/v1/category/public/${category}/all?page=0&limit=50`;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const res = await fetch(url, { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// Try Substack recommendations API
async function fetchSubstackRecommendations(subdomain) {
  try {
    const url = `https://${subdomain}.substack.com/api/v1/recommendations`;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3000);
    const res = await fetch(url, { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.recommendations || []);
  } catch { return []; }
}

async function fetchEmails(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const res = await fetch(url, { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
    clearTimeout(t);
    if (!res.ok) return [];
    const html = await res.text();
    const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    return [...new Set((html.match(re) || []))].filter(e =>
      !e.includes("example") && !e.includes("sentry") && !e.includes("webpack") &&
      !e.includes(".png") && !e.includes(".jpg") && !e.endsWith(".js") &&
      !e.includes("substackcdn") && !e.includes("substack.com") &&
      !e.includes("cloudflare") && e.length < 60
    );
  } catch { return []; }
}

// Step 1: Try category pages
console.log("=== STEP 1: Substack categories ===\n");
const categories = ["politics", "culture", "technology", "business", "sports", "food", "music", "science", "health", "world"];
const discovered = new Map();

for (const cat of categories) {
  const pubs = await fetchSubstackCategory(cat);
  let added = 0;
  if (Array.isArray(pubs)) {
    for (const p of pubs) {
      const sd = p.subdomain;
      if (sd && !discovered.has(sd)) {
        discovered.set(sd, { subdomain: sd, name: p.name || sd, author: p.author_name || "" });
        added++;
      }
    }
  }
  console.log(`  ${cat}: +${added} (total: ${discovered.size})`);
}

// Step 2: Add known substacks
console.log("\n=== STEP 2: Known LATAM substacks ===\n");
for (const pub of knownSubstacks) {
  if (!discovered.has(pub.subdomain)) {
    discovered.set(pub.subdomain, { subdomain: pub.subdomain, name: pub.name, author: "" });
  }
}
console.log(`Added ${knownSubstacks.length} known publications. Total: ${discovered.size}\n`);

// Step 3: Get recommendations from known LATAM substacks to find more
console.log("=== STEP 3: Following recommendations ===\n");
const latamSeeds = knownSubstacks.slice(0, 15);
for (const seed of latamSeeds) {
  const recs = await fetchSubstackRecommendations(seed.subdomain);
  let added = 0;
  if (Array.isArray(recs)) {
    for (const r of recs) {
      const sd = r.subdomain || r.publication?.subdomain;
      const name = r.name || r.publication?.name || sd;
      if (sd && !discovered.has(sd)) {
        discovered.set(sd, { subdomain: sd, name, author: r.author_name || "" });
        added++;
      }
    }
  }
  if (added > 0) console.log(`  ${seed.name}: +${added} recommendations`);
}
console.log(`\nTotal discovered: ${discovered.size}\n`);

// Step 4: Fetch about pages for emails
console.log("=== STEP 4: Fetching emails ===\n");
const allPubs = [...discovered.values()];
const results = [];
const BATCH = 15;

for (let i = 0; i < allPubs.length; i += BATCH) {
  const batch = allPubs.slice(i, i + BATCH);
  const promises = batch.map(async (pub) => {
    // Try about page and main page
    let emails = await fetchEmails(`https://${pub.subdomain}.substack.com/about`);
    if (emails.length === 0) {
      emails = await fetchEmails(`https://${pub.subdomain}.substack.com`);
    }
    if (emails.length > 0) {
      console.log(`  📧 ${pub.name.substring(0,35).padEnd(35)} ${emails.join("; ")}`);
    }
    return { ...pub, emails: emails.join(";"), url: `https://${pub.subdomain}.substack.com` };
  });
  const batchResults = await Promise.all(promises);
  results.push(...batchResults);
}

const withEmail = results.filter(r => r.emails.length > 0);

writeFileSync("substack_results.json", JSON.stringify(withEmail, null, 2));

console.log(`\n=== RESUMEN ===`);
console.log(`Publicaciones descubiertas: ${discovered.size}`);
console.log(`Con email: ${withEmail.length}`);

if (withEmail.length > 0) {
  console.log(`\n=== LISTA FINAL ===\n`);
  withEmail.forEach((p, i) => {
    const email = p.emails.split(";")[0];
    console.log(`${String(i+1).padStart(3)}. ${p.name.substring(0,40).padEnd(40)} ${email}`);
  });
}
