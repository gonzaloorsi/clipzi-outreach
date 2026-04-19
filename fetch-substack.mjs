import { writeFileSync } from "fs";

// Substack has a search/discovery feature and individual publication pages
// Strategy: 
// 1. Search Substack for Spanish-language publications
// 2. Fetch each publication's about page to get the author's email
// 3. Substack authors often have their email visible or use their substack email

const searchTerms = [
  "periodismo latino",
  "periodismo argentina",
  "periodismo mexico",
  "periodismo colombia",
  "periodismo chile",
  "periodismo peru",
  "noticias latinoamerica",
  "politica argentina",
  "politica mexico",
  "politica colombia",
  "politica chile",
  "analisis politico español",
  "economia latinoamerica",
  "economia argentina",
  "economia mexico",
  "tecnologia español",
  "tecnologia latinoamerica",
  "cultura latinoamerica",
  "medios comunicacion",
  "opinion editorial español",
  "crónica periodística",
  "investigación periodismo",
  "newsletter español",
  "newsletter argentina",
  "newsletter mexico",
  "startup latinoamerica",
  "emprendimiento latino",
  "fintech latam",
  "marketing digital español",
  "contenido digital español",
  "creador contenido español",
  "video contenido español",
  "entretenimiento latino",
  "deportes futbol español",
  "ciencia español",
  "salud español",
  "educación español",
  "literatura español",
  "feminismo español",
  "medio ambiente español",
];

async function fetchSubstackSearch(query) {
  try {
    const url = `https://substack.com/api/v1/search/publications?query=${encodeURIComponent(query)}&page=0&limit=25`;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const res = await fetch(url, {
      signal: c.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    return data || [];
  } catch(e) {
    return [];
  }
}

async function fetchPublicationPage(subdomain) {
  try {
    const url = `https://${subdomain}.substack.com/about`;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const res = await fetch(url, {
      signal: c.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return { emails: [], bio: "" };
    const html = await res.text();
    
    // Extract emails
    const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = [...new Set((html.match(emailRe) || []))].filter(e =>
      !e.includes("example") && !e.includes("sentry") && !e.includes("webpack") &&
      !e.includes(".png") && !e.includes(".jpg") && !e.endsWith(".js") &&
      !e.includes("substack.com") && !e.includes("substackcdn") &&
      e.length < 60
    );
    
    return { emails };
  } catch(e) {
    return { emails: [] };
  }
}

// Step 1: Search for publications
console.log("=== SEARCHING SUBSTACK ===\n");

const allPubs = new Map(); // subdomain -> publication data

for (const query of searchTerms) {
  const results = await fetchSubstackSearch(query);
  let added = 0;
  
  if (Array.isArray(results)) {
    for (const pub of results) {
      const subdomain = pub.subdomain || pub.custom_domain_optional;
      if (subdomain && !allPubs.has(subdomain)) {
        allPubs.set(subdomain, {
          name: pub.name || "",
          subdomain,
          author: pub.author_name || pub.byline || "",
          description: (pub.description || "").substring(0, 200),
          subscribers: pub.subscriber_count || pub.active_subscription_count || 0,
          url: pub.custom_domain || `https://${subdomain}.substack.com`,
          language: pub.language || "",
        });
        added++;
      }
    }
  }
  
  console.log(`  "${query}" → +${added} (total: ${allPubs.size})`);
}

console.log(`\nTotal publications found: ${allPubs.size}\n`);

// Step 2: Fetch about pages for emails (parallel, batched)
console.log("=== FETCHING EMAILS FROM ABOUT PAGES ===\n");

const pubArray = [...allPubs.values()];
const BATCH = 15;
const results = [];

for (let i = 0; i < pubArray.length; i += BATCH) {
  const batch = pubArray.slice(i, i + BATCH);
  const promises = batch.map(async (pub) => {
    const { emails } = await fetchPublicationPage(pub.subdomain);
    const icon = emails.length > 0 ? "📧" : "❌";
    const emailStr = emails.join(";");
    if (emails.length > 0) {
      console.log(`  ${icon} ${pub.name.substring(0,40).padEnd(40)} by ${(pub.author || "?").substring(0,20).padEnd(20)} ${emailStr}`);
    }
    return { ...pub, emails: emailStr };
  });
  
  const batchResults = await Promise.all(promises);
  results.push(...batchResults);
  process.stdout.write(`  ${Math.min(i + BATCH, pubArray.length)}/${pubArray.length} checked\r`);
}

// Filter those with emails
const withEmail = results.filter(r => r.emails && r.emails.length > 0);

// Save
writeFileSync("substack_all.json", JSON.stringify(results, null, 2));
writeFileSync("substack_with_emails.json", JSON.stringify(withEmail, null, 2));

console.log(`\n\n=== RESULTADOS ===\n`);
withEmail.sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));
withEmail.forEach((pub, i) => {
  const subs = pub.subscribers ? `${(pub.subscribers / 1000).toFixed(0)}K` : "?";
  const email = pub.emails.split(";")[0];
  console.log(`${String(i + 1).padStart(3)}. ${pub.name.substring(0,40).padEnd(40)} ${(pub.author || "").substring(0,25).padEnd(25)} ${subs.padStart(6)}  ${email}`);
});

console.log(`\nTotal publicaciones: ${allPubs.size}`);
console.log(`Con email: ${withEmail.length}`);
