// daily-outreach.mjs
// Automated daily YouTube outreach for Clipzi
// Searches YouTube for channels with emails, scores them, sends personalized emails via Resend

import { readFileSync, writeFileSync, existsSync } from "fs";

// ─── Config ────────────────────────────────────────────────────────────────
const YOUTUBE_API_KEYS = [
  process.env.YOUTUBE_API_KEY,
  process.env.YOUTUBE_API_KEY_2,
  process.env.YOUTUBE_API_KEY_3,
  process.env.YOUTUBE_API_KEY_4,
].filter(Boolean);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SENDER_NAME = process.env.SENDER_NAME;

// Two sender emails: first 50 from clipzi.video, next 50 from clipzi.media
const SENDERS = [
  { email: process.env.SENDER_EMAIL, limit: 100 },
  { email: process.env.SENDER_EMAIL_2, limit: 100 },
].filter(s => s.email);

const MAX_EMAILS_PER_DAY = SENDERS.reduce((sum, s) => sum + s.limit, 0);
const QUERIES_PER_RUN = 150;
const SEND_DELAY_MS = 200;
const MIN_SUBSCRIBERS = 10_000;

let currentKeyIndex = 0;

function getCurrentApiKey() {
  return YOUTUBE_API_KEYS[currentKeyIndex];
}

function switchToNextKey() {
  if (currentKeyIndex + 1 < YOUTUBE_API_KEYS.length) {
    currentKeyIndex++;
    console.log(`  🔑 Switched to API key ${currentKeyIndex + 1}/${YOUTUBE_API_KEYS.length}`);
    return true;
  }
  return false;
}

if (YOUTUBE_API_KEYS.length === 0) { console.error("❌ Missing YOUTUBE_API_KEY"); process.exit(1); }
if (!RESEND_API_KEY) { console.error("❌ Missing RESEND_API_KEY"); process.exit(1); }
if (SENDERS.length === 0) { console.error("❌ Missing SENDER_EMAIL"); process.exit(1); }
if (!SENDER_NAME) { console.error("❌ Missing SENDER_NAME"); process.exit(1); }

console.log(`🔑 YouTube API keys loaded: ${YOUTUBE_API_KEYS.length}`);
console.log(`📤 Senders: ${SENDERS.map(s => s.email + " (" + s.limit + "/day)").join(", ")}`);

// ─── Topic × Country Search Grid ────────────────────────────────────────────
// Instead of text queries, we systematically search by YouTube topic + country

const TOPICS = [
  { id: "/m/04rlf", name: "Music" },
  { id: "/m/02mscn", name: "Christian music" },
  { id: "/m/0ggq0m", name: "Gaming" },
  { id: "/m/06ntj", name: "Sports" },
  { id: "/m/02wbm", name: "Food" },
  { id: "/m/019_rr", name: "Lifestyle" },
  { id: "/m/032tl", name: "Fashion" },
  { id: "/m/027x7n", name: "Fitness" },
  { id: "/m/07c1v", name: "Technology" },
  { id: "/m/09s1f", name: "Business" },
  { id: "/m/01k8wb", name: "Knowledge" },
  { id: "/m/0kt51", name: "Comedy" },
  { id: "/m/02jjt", name: "Entertainment" },
  { id: "/m/07bxq", name: "Tourism" },
  { id: "/m/0jm_", name: "Education" },
  { id: "/m/098wr", name: "Society" },
  { id: "/m/01h7lh", name: "Pets & Animals" },
  { id: "/m/068hy", name: "Pets" },
  { id: "/m/041xxh", name: "Beauty" },
  { id: "/m/03glg", name: "Hobby" },
  { id: "/m/0bzvm2", name: "Gaming hardware" },
  { id: "/m/02ntfj", name: "Film" },
  { id: "/m/06bvp", name: "Religion" },
  { id: "/m/01ly5m", name: "Health" },
  { id: "/m/0f2f9", name: "Vehicles" },
  { id: "/m/0k4j", name: "Cars" },
  { id: "/m/01jdpf", name: "Motorcycles" },
  { id: "/m/025zzc", name: "Action games" },
  { id: "/m/02mjmr", name: "Role-playing games" },
  { id: "/m/0403l", name: "Home & Garden" },
];

const COUNTRIES = [
  { code: "AR", name: "Argentina" },
  { code: "MX", name: "México" },
  { code: "CO", name: "Colombia" },
  { code: "CL", name: "Chile" },
  { code: "PE", name: "Perú" },
  { code: "ES", name: "España" },
  { code: "EC", name: "Ecuador" },
  { code: "UY", name: "Uruguay" },
  { code: "VE", name: "Venezuela" },
  { code: "BO", name: "Bolivia" },
  { code: "PY", name: "Paraguay" },
  { code: "DO", name: "Rep. Dominicana" },
  { code: "GT", name: "Guatemala" },
  { code: "CR", name: "Costa Rica" },
  { code: "PA", name: "Panamá" },
  { code: "HN", name: "Honduras" },
  { code: "SV", name: "El Salvador" },
  { code: "NI", name: "Nicaragua" },
  { code: "CU", name: "Cuba" },
  { code: "PR", name: "Puerto Rico" },
];

// Build all combinations: 30 topics × 20 countries = 600 combos
const ALL_COMBOS = [];
for (const topic of TOPICS) {
  for (const country of COUNTRIES) {
    ALL_COMBOS.push({ topicId: topic.id, topicName: topic.name, regionCode: country.code, countryName: country.name });
  }
}

console.log(`📋 Search grid: ${TOPICS.length} topics × ${COUNTRIES.length} countries = ${ALL_COMBOS.length} combinations`);

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ytGet(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  params.key = getCurrentApiKey();
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("quota")) {
      // Try switching to next key
      if (switchToNextKey()) {
        return ytGet(endpoint, params); // Retry with new key
      }
      throw new Error("QUOTA_EXCEEDED");
    }
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function extractEmails(text) {
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(re) || [])];
}

function cleanName(name) {
  // Remove emojis
  let clean = name
    .replace(
      /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[\u{2700}-\u{27BF}]|[\u{200D}]|[\u{FE0F}]/gu,
      ""
    )
    .trim();

  // Remove suffixes after separators
  const separators = [" | ", " · ", " - ", " : ", " (", " [", " / "];
  for (const sep of separators) {
    const idx = clean.indexOf(sep);
    if (idx > 3) {
      const first = clean.substring(0, idx).trim();
      if (first.length > 3) clean = first;
    }
  }

  // Remove trailing special chars
  clean = clean.replace(/[_\-·|:]+$/g, "").trim();

  // Remove common prefixes
  clean = clean.replace(/^(El Canal De |EL CANAL DE )/i, "");

  return clean || name;
}

function scoreChannel(ch) {
  let score = 0;
  const title = (ch.title || "").toLowerCase();
  const email = (ch.emails || "").toLowerCase();
  const subs = ch.subscribers || 0;

  // Subscriber sweet spot: 50K-10M
  if (subs >= 50_000 && subs <= 10_000_000) score += 30;
  else if (subs >= 10_000 && subs < 50_000) score += 15;
  else if (subs > 10_000_000) score += 20;

  // Good niches
  const goodNiches = [
    "podcast", "vlog", "review", "react", "entrevista", "lifestyle",
    "comedia", "humor", "cocina", "receta", "fitness", "gym", "deport",
    "basket", "futbol", "gaming", "tutorial", "barbero", "barber",
    "maquillaje", "belleza", "unbox", "opinion", "reseña", "storytime",
    "nutrici", "doctor", "fotograf", "audiovisual", "film", "produc",
    "surf", "moto", "tattoo", "tatuaje", "yoga", "crossfit", "boxeo",
    "mma", "tenis", "ajedrez", "café", "barista", "educaci", "ciencia",
    "historia", "viaje", "travel", "familia", "padre", "madre",
    "challenge", "prank", "mukbang", "haul",
  ];
  if (goodNiches.some((n) => title.includes(n))) score += 15;

  // Bad niches
  const badNiches = [
    "bitcoin", "cripto", "crypto", "inmobili", "bienes raices", "realtor",
    "real estate", "compilacion", "shorts 2024", "beats", "instrumental",
    "lofi mix", "white noise", "ruido blanco", "asmr sleep",
  ];
  if (badNiches.some((n) => title.includes(n))) score -= 25;

  // Too small
  if (subs < 1_000) score -= 20;

  // High video count (more content to clip)
  if (ch.videoCount > 500) score += 20;
  else if (ch.videoCount > 100) score += 15;
  else if (ch.videoCount > 30) score += 10;

  // Professional email domain
  if (
    email &&
    !email.includes("gmail.com") &&
    !email.includes("hotmail") &&
    !email.includes("outlook") &&
    !email.includes("yahoo")
  ) {
    score += 10;
  }

  // Spanish-speaking countries
  const latamCountries = [
    "MX", "AR", "CO", "CL", "PE", "EC", "PR", "GT", "UY", "VE",
    "DO", "PA", "CR", "ES", "BO", "PY", "SV", "HN", "NI", "CU",
  ];
  if (latamCountries.includes(ch.country)) score += 10;

  return score;
}

// ─── Step A: Load State ─────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════");
console.log("  📺 Clipzi Daily YouTube Outreach");
console.log(`  📅 ${new Date().toISOString().split("T")[0]}`);
console.log("═══════════════════════════════════════════════════\n");

// Load send_results.json
let sendResults = [];
try {
  sendResults = JSON.parse(readFileSync("send_results.json", "utf-8"));
  console.log(`📬 Previously sent emails: ${sendResults.length}`);
} catch (e) {
  console.log("📬 No previous send_results.json found, starting fresh");
}

const sentEmails = new Set(
  sendResults
    .filter((s) => s.status === "sent")
    .map((s) => s.email.toLowerCase())
);
const sentChannelIds = new Set(
  sendResults.filter((s) => s.channelId).map((s) => s.channelId)
);

// Load search state
let searchState = { queryIndex: 0, lastRun: null, totalSent: sendResults.length };
try {
  searchState = JSON.parse(readFileSync("search_state.json", "utf-8"));
  console.log(`🔍 Query pool index: ${searchState.queryIndex}/${QUERY_POOL.length}`);
  console.log(`📊 Total sent so far: ${searchState.totalSent}\n`);
} catch (e) {
  console.log("🔍 No search_state.json found, starting from index 0\n");
}

// ─── Step B: Search YouTube ─────────────────────────────────────────────────

console.log("=== STEP 1: Searching YouTube (topics × countries) ===\n");

// Pick next batch of combos (rotating through grid)
let startIdx = searchState.queryIndex % ALL_COMBOS.length;
const combosToRun = [];
for (let i = 0; i < QUERIES_PER_RUN; i++) {
  combosToRun.push(ALL_COMBOS[(startIdx + i) % ALL_COMBOS.length]);
}
const nextQueryIndex = (startIdx + QUERIES_PER_RUN) % ALL_COMBOS.length;

console.log(`Running combos ${startIdx} to ${startIdx + QUERIES_PER_RUN - 1} (of ${ALL_COMBOS.length} total)\n`);

const discoveredChannelIds = new Set();
let quotaUsed = 0;
let quotaExceeded = false;
let combosRun = 0;

for (const combo of combosToRun) {
  if (quotaExceeded) break;

  try {
    const data = await ytGet("search", {
      part: "snippet",
      type: "channel",
      topicId: combo.topicId,
      regionCode: combo.regionCode,
      maxResults: "50",
      relevanceLanguage: "es",
    });
    quotaUsed += 100;
    combosRun++;

    for (const item of data.items || []) {
      const channelId = item.snippet?.channelId || item.id?.channelId;
      if (channelId) {
        discoveredChannelIds.add(channelId);
      }
    }
    console.log(
      `  ✅ ${combo.topicName.padEnd(20)} × ${combo.countryName.padEnd(15)} → ${(data.items || []).length} results (unique: ${discoveredChannelIds.size})`
    );
  } catch (e) {
    if (e.message === "QUOTA_EXCEEDED") {
      console.log(`  ⚠️  Quota exceeded at ${combo.topicName} × ${combo.countryName} — stopping`);
      quotaExceeded = true;
    } else {
      console.log(`  ❌ Error for ${combo.topicName} × ${combo.countryName}: ${e.message}`);
    }
  }

  await sleep(100);
}

console.log(`\nCombos run: ${combosRun}/${combosToRun.length}`);
console.log(`Total unique channel IDs discovered: ${discoveredChannelIds.size}`);
console.log(`Quota used on searches: ~${quotaUsed} units\n`);

if (discoveredChannelIds.size === 0) {
  console.log("⚠️  No channels discovered. Saving state and exiting.");
  searchState.queryIndex = nextQueryIndex;
  searchState.lastRun = new Date().toISOString();
  writeFileSync("search_state.json", JSON.stringify(searchState, null, 2));
  process.exit(0);
}

// ─── Step C: Fetch Channel Details ──────────────────────────────────────────

console.log("=== STEP 2: Fetching channel details ===\n");

const channelIdArray = [...discoveredChannelIds];
const channels = [];
const BATCH_SIZE = 50;

for (let i = 0; i < channelIdArray.length; i += BATCH_SIZE) {
  if (quotaExceeded) break;

  const batch = channelIdArray.slice(i, i + BATCH_SIZE);
  try {
    const data = await ytGet("channels", {
      part: "snippet,statistics",
      id: batch.join(","),
    });
    quotaUsed += 1;

    for (const ch of data.items || []) {
      const desc = ch.snippet?.description || "";
      const emails = extractEmails(desc);

      channels.push({
        title: ch.snippet.title,
        channelId: ch.id,
        country: ch.snippet?.country || "",
        subscribers: parseInt(ch.statistics?.subscriberCount || "0"),
        viewCount: parseInt(ch.statistics?.viewCount || "0"),
        videoCount: parseInt(ch.statistics?.videoCount || "0"),
        emails: emails.join(";"),
        url: `https://youtube.com/channel/${ch.id}`,
      });
    }

    process.stdout.write(
      `  Fetched ${Math.min(i + BATCH_SIZE, channelIdArray.length)}/${channelIdArray.length} channels\r`
    );
  } catch (e) {
    if (e.message === "QUOTA_EXCEEDED") {
      console.log("\n  ⚠️  Quota exceeded during channel fetch");
      quotaExceeded = true;
    } else {
      console.log(`\n  ❌ Error fetching batch: ${e.message}`);
    }
  }

  await sleep(100);
}

console.log(`\nChannels with details: ${channels.length}`);
console.log(`Quota used so far: ~${quotaUsed} units\n`);

// ─── Step D: Filter & Score ─────────────────────────────────────────────────

console.log("=== STEP 3: Filtering & scoring channels ===\n");

// Keep only channels with emails that haven't been contacted
const seenEmails = new Set([...sentEmails]);
const candidates = [];

const withEmail = channels
  .filter((ch) => ch.emails && ch.emails.trim().length > 0)
  .filter((ch) => !sentChannelIds.has(ch.channelId))
  .filter((ch) => ch.subscribers >= MIN_SUBSCRIBERS);

console.log(`Channels with email (≥${MIN_SUBSCRIBERS / 1000}K subs): ${withEmail.length}`);

// Deduplicate by email
for (const ch of withEmail) {
  const emails = ch.emails
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const newEmails = emails.filter((e) => !seenEmails.has(e));

  if (newEmails.length > 0) {
    newEmails.forEach((e) => seenEmails.add(e));
    // Use first new email as the primary contact
    ch.primaryEmail = newEmails[0];
    ch.score = scoreChannel(ch);
    candidates.push(ch);
  }
}

console.log(`Candidates after dedup: ${candidates.length}`);

// Sort by score descending and take top MAX_EMAILS_PER_DAY
candidates.sort((a, b) => b.score - a.score);
const toSend = candidates.slice(0, MAX_EMAILS_PER_DAY);

console.log(`Top candidates to email: ${toSend.length}\n`);

if (toSend.length === 0) {
  console.log("⚠️  No new channels to email today. Saving state.");
  searchState.queryIndex = nextQueryIndex;
  searchState.lastRun = new Date().toISOString();
  writeFileSync("search_state.json", JSON.stringify(searchState, null, 2));
  process.exit(0);
}

// Print candidates
console.log("     Canal                                          Subs     Score  Email");
console.log("     " + "─".repeat(95));
for (let i = 0; i < toSend.length; i++) {
  const ch = toSend[i];
  const name = cleanName(ch.title);
  const subs =
    ch.subscribers >= 1e6
      ? (ch.subscribers / 1e6).toFixed(1) + "M"
      : (ch.subscribers / 1e3).toFixed(0) + "K";
  console.log(
    `${String(i + 1).padStart(3)}. ${name.substring(0, 45).padEnd(45)} ${subs.padStart(8)}  ${String(ch.score).padStart(4)}  ${ch.primaryEmail}`
  );
}

// ─── Step E: Send Emails via Resend ─────────────────────────────────────────

console.log("\n=== STEP 4: Sending emails ===\n");

const newSendResults = [];
let sentCount = 0;
let failedCount = 0;

// Track sends per sender for rotation
const senderSentCount = SENDERS.map(() => 0);

function getSenderForNext() {
  for (let i = 0; i < SENDERS.length; i++) {
    if (senderSentCount[i] < SENDERS[i].limit) return i;
  }
  return -1; // all senders exhausted
}

for (const ch of toSend) {
  const senderIdx = getSenderForNext();
  if (senderIdx === -1) {
    console.log("⚠️  All senders at daily limit — stopping");
    break;
  }

  const senderEmail = SENDERS[senderIdx].email;
  const name = cleanName(ch.title);
  const email = ch.primaryEmail;

  const htmlBody = `<p>Hola equipo de ${name},</p><p>Clipzi (https://clipzi.app/) convierte videos largos en clips para TikTok, Reels y Shorts. Suben el video, la IA encuentra los mejores momentos, y luego los ajustan en un editor visual.</p><p>Damos 2 videos gratis por mes para probar el flujo. Si después necesitan más uso o más funciones, hay planes pagos.</p><p>Si les interesa, podemos hacer algo específico para ${name}.</p><p>${SENDER_NAME}<br/>Co-founder &amp; CEO, Clipzi</p>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${SENDER_NAME} <${senderEmail}>`,
        to: [email],
        subject: `${name} x Clipzi`,
        html: htmlBody,
      }),
    });

    const data = await res.json();

    if (res.ok) {
      sentCount++;
      senderSentCount[senderIdx]++;
      console.log(`✅ ${String(sentCount).padStart(3)}. [${senderEmail}] ${name.padEnd(35)} → ${email}`);
      newSendResults.push({
        channel: ch.title,
        cleanName: name,
        email,
        sentFrom: senderEmail,
        channelId: ch.channelId,
        subscribers: ch.subscribers,
        score: ch.score,
        status: "sent",
        id: data.id,
        date: new Date().toISOString(),
      });
    } else {
      failedCount++;
      console.log(`❌ ${name.padEnd(40)} → ${email} (${data.message || data.statusCode || "unknown error"})`);
      newSendResults.push({
        channel: ch.title,
        cleanName: name,
        email,
        channelId: ch.channelId,
        status: "failed",
        error: data.message || JSON.stringify(data),
        date: new Date().toISOString(),
      });
    }
  } catch (err) {
    failedCount++;
    console.log(`❌ ${name.padEnd(40)} → ${email} (${err.message})`);
    newSendResults.push({
      channel: ch.title,
      cleanName: name,
      email,
      channelId: ch.channelId,
      status: "error",
      error: err.message,
      date: new Date().toISOString(),
    });
  }

  await sleep(SEND_DELAY_MS);
}

// ─── Step F: Save State ─────────────────────────────────────────────────────

console.log("\n=== STEP 5: Saving state ===\n");

// Append successful sends to send_results.json
const successfulSends = newSendResults.filter((r) => r.status === "sent");
const updatedSendResults = [...sendResults, ...successfulSends];
writeFileSync("send_results.json", JSON.stringify(updatedSendResults, null, 2));
console.log(`📝 Updated send_results.json: ${sendResults.length} → ${updatedSendResults.length} entries`);

// Update search state
searchState.queryIndex = nextQueryIndex;
searchState.lastRun = new Date().toISOString();
searchState.totalSent = updatedSendResults.length;
writeFileSync("search_state.json", JSON.stringify(searchState, null, 2));
console.log(`📝 Updated search_state.json: next query index = ${nextQueryIndex}`);

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  📊 DAILY OUTREACH SUMMARY");
console.log("═══════════════════════════════════════════════════");
console.log(`  🔍 Combos run: ${combosRun}`);
console.log(`  📺 Channels discovered: ${discoveredChannelIds.size}`);
console.log(`  📧 Channels with email: ${withEmail.length}`);
console.log(`  🎯 Candidates (new, deduped): ${candidates.length}`);
console.log(`  ✅ Emails sent: ${sentCount}`);
console.log(`  ❌ Emails failed: ${failedCount}`);
console.log(`  📊 Total emails all-time: ${updatedSendResults.length}`);
console.log(`  ⚡ Quota used: ~${quotaUsed} units`);
console.log(`  🔄 Next query index: ${nextQueryIndex}`);
console.log("═══════════════════════════════════════════════════\n");

// ─── Step G: Send Report Email ──────────────────────────────────────────────

if (newSendResults.length > 0) {
  console.log("=== STEP 6: Sending report to gonzaloorsi@gmail.com ===\n");

  const today = new Date().toISOString().split("T")[0];

  const tableRows = newSendResults.map((r) => {
    const subs = r.subscribers >= 1e6
      ? (r.subscribers / 1e6).toFixed(1) + "M"
      : (r.subscribers / 1e3).toFixed(0) + "K";
    const status = r.status === "sent"
      ? "✅ Enviado"
      : `❌ ${r.error || "Error"}`;
    const from = r.sentFrom || "-";
    return `<tr>
      <td style="padding:8px;border:1px solid #ddd;">${r.cleanName || r.channel}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">${subs}</td>
      <td style="padding:8px;border:1px solid #ddd;">${r.email}</td>
      <td style="padding:8px;border:1px solid #ddd;">${from}</td>
      <td style="padding:8px;border:1px solid #ddd;">${status}</td>
    </tr>`;
  }).join("");

  const reportHtml = `
    <h2>Clipzi Outreach Report — ${today}</h2>
    <p>
      <strong>Combos:</strong> ${combosRun} |
      <strong>Canales descubiertos:</strong> ${discoveredChannelIds.size} |
      <strong>Con email:</strong> ${withEmail.length} |
      <strong>Enviados:</strong> ${sentCount} |
      <strong>Fallidos:</strong> ${failedCount} |
      <strong>Total histórico:</strong> ${updatedSendResults.length}
    </p>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Canal</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:right;">Subs</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Email</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Desde</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Estado</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  try {
    const reportRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `Clipzi Outreach Bot <${SENDER_EMAIL}>`,
        to: ["gonzaloorsi@gmail.com"],
        subject: `Outreach Report ${today} — ${sentCount} enviados, ${updatedSendResults.length} total`,
        html: reportHtml,
      }),
    });
    if (reportRes.ok) {
      console.log("📧 Report sent to gonzaloorsi@gmail.com");
    } else {
      const err = await reportRes.json();
      console.log(`❌ Failed to send report: ${err.message}`);
    }
  } catch (err) {
    console.log(`❌ Failed to send report: ${err.message}`);
  }
} else {
  console.log("📭 No sends today — skipping report email.");
}
