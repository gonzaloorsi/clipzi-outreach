// Lightweight GMass deliverability check. Sends ONE email per configured
// sender to a different seed (round-robin), instead of the full N × 15
// matrix that gmass-inbox-test.mjs produces. Use this for quick spot-checks
// across all senders without burning 240 emails.
//
// Pairs sender i → SEEDS[i % SEEDS.length]. With 18 senders and 15 seeds,
// senders 16-18 wrap to seeds 0-2. Each sender uses a distinct channelName so
// subjects don't collide with the full-matrix script's subjects in GMass UI.

import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = process.env.PROD_URL ?? "https://clipzi-outreach.vercel.app";
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.error("CRON_SECRET not set in .env.local");
  process.exit(1);
}

const SEEDS = [
  "ajaygoel999@gmail.com",
  "test@chromecompete.com",
  "test@ajaygoel.org",
  "me@dropboxslideshow.com",
  "test@wordzen.com",
  "rajgoel8477@gmail.com",
  "rajanderson8477@gmail.com",
  "rajwilson8477@gmail.com",
  "briansmith8477@gmail.com",
  "oliviasmith8477@gmail.com",
  "ashsmith8477@gmail.com",
  "shellysmith8477@gmail.com",
  "ajay@madsciencekidz.com",
  "ajay2@ctopowered.com",
  "ajay@arena.tec.br",
];

// One distinct channelName per sender → one distinct subject per sender.
// Names continue the LATAM streaming/podcast theme used elsewhere but
// avoid colliding with gmass-inbox-test.mjs's set so both scripts can
// coexist in the same GMass dashboard view.
const ASSIGNMENT = [
  { from: "g@clipzi.video",    channelName: "Carajo" },
  { from: "g@clipzi.media",    channelName: "República Z" },
  { from: "g@clipzi.pro",      channelName: "Sería Increíble" },
  { from: "g@clipzi.team",     channelName: "La Casa Streaming" },
  { from: "g@clipzi.net",      channelName: "Picnic Extraterrestre" },
  { from: "g@clipzi.co",       channelName: "Solo Una Vuelta" },
  { from: "g@clipzi.tech",     channelName: "Tendencia Indie" },
  { from: "g@clipzi.agency",   channelName: "Industria Nacional" },
  { from: "g@clipzi.sh",       channelName: "Conoce Más" },
  { from: "g@clipzi.design",   channelName: "Generaciones" },
  { from: "g@clipzi.digital",  channelName: "Hoy Es Lunes" },
  { from: "g@clipzi.engineer", channelName: "Provócame" },
  { from: "g@clipzi.info",     channelName: "Detrás De" },
  { from: "g@clipzi.lat",      channelName: "Buen Lunes" },
  { from: "g@clipzi.live",     channelName: "Mañana Sylvestre" },
  { from: "g@clipzi.one",      channelName: "Por La Mañana" },
  { from: "g@clipzi.online",   channelName: "Paren La Mano" },
  { from: "g@clipzi.page",     channelName: "Ángel Responde" },
];

const onlyFlag = process.argv.find((a) => a.startsWith("--only="));
const onlyEmail = onlyFlag?.split("=")[1]?.trim().toLowerCase();
const targets = onlyEmail
  ? ASSIGNMENT.filter((a) => a.from.toLowerCase() === onlyEmail)
  : ASSIGNMENT;
if (onlyEmail && targets.length === 0) {
  console.error(`--only=${onlyEmail} doesn't match any sender in ASSIGNMENT`);
  process.exit(1);
}

const PACING_MS = 300;

const results = [];
let sent = 0;
let failed = 0;

console.log(
  `\nGMass inbox test (light, 1×1 round-robin) → ${BASE}\n` +
    `Plan: ${targets.length} senders × 1 seed each = ${targets.length} emails\n` +
    `Pacing: ${PACING_MS}ms between sends\n`,
);

// Use the position in ASSIGNMENT (not in targets) so --only=... still
// sends to the same seed it would have during a full run. Keeps the
// sender→seed mapping deterministic across runs.
for (const { from, channelName } of targets) {
  const idx = ASSIGNMENT.findIndex((a) => a.from === from);
  const seed = SEEDS[idx % SEEDS.length];

  const url = new URL(`${BASE}/api/debug/send-test`);
  url.searchParams.set("to", seed);
  url.searchParams.set("from", from);
  url.searchParams.set("kind", "creator");
  url.searchParams.set("lang", "es");
  url.searchParams.set("channelName", channelName);

  const t0 = Date.now();
  let json;
  try {
    const res = await fetch(url, {
      headers: { "x-cron-secret": SECRET },
    });
    json = await res.json();
  } catch (e) {
    json = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const dt = Date.now() - t0;

  const subjectPreview = `${channelName.toLowerCase()} x clipzi`;
  if (json.ok) {
    sent++;
    console.log(
      `   ✓ ${from.padEnd(20)} → ${seed.padEnd(34)} ${dt}ms  "${subjectPreview}"  id=${json.messageId}`,
    );
  } else {
    failed++;
    console.log(
      `   ✗ ${from.padEnd(20)} → ${seed.padEnd(34)} ${dt}ms  ERROR: ${json.error}`,
    );
  }
  results.push({ from, channelName, seed, ok: json.ok, messageId: json.messageId, error: json.error });

  await new Promise((r) => setTimeout(r, PACING_MS));
}

console.log(`\n────────────────────────────────────────`);
console.log(`Done. sent=${sent} failed=${failed}`);
console.log(`\nNow check https://www.gmass.co/inbox — one row per unique subject.`);
