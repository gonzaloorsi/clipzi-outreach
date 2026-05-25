// One-off: tests deliverability of every configured sender via the GMass
// seed list. Fires the prod /api/debug/send-test endpoint once per
// (sender × seed) pair, with a unique channelName per sender so GMass groups
// results by sender (each sender ends up with its own "campaign" in their UI).
//
// Not committed-as-default tooling: rerun by hand whenever you want a fresh
// reputation snapshot. Delete or rebuild for next test.

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

// One unique channelName per sender → one unique subject per sender.
// All use creator-es (most representative of real outreach traffic).
const ASSIGNMENT = [
  { from: "g@clipzi.video",  channelName: "Migue Granados" },
  { from: "g@clipzi.media",  channelName: "Olga" },
  { from: "g@clipzi.pro",    channelName: "Luzu" },
  { from: "g@clipzi.team",   channelName: "Vorterix" },
  { from: "g@clipzi.net",    channelName: "Gelatina" },
  { from: "g@clipzi.co",     channelName: "Blender" },
  { from: "g@clipzi.tech",   channelName: "Casimiro" },
  { from: "g@clipzi.agency", channelName: "Bondi Live" },
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
  `\nGMass inbox test → ${BASE}\n` +
    `Plan: ${targets.length} senders × ${SEEDS.length} seeds = ${targets.length * SEEDS.length} emails\n` +
    `Pacing: ${PACING_MS}ms between sends\n`,
);

for (const { from, channelName } of targets) {
  console.log(`\n── from=${from} subject="${channelName.toLowerCase()} x clipzi"`);
  for (const seed of SEEDS) {
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

    if (json.ok) {
      sent++;
      console.log(`   ✓ ${seed.padEnd(34)} ${dt}ms  id=${json.messageId}`);
    } else {
      failed++;
      console.log(`   ✗ ${seed.padEnd(34)} ${dt}ms  ERROR: ${json.error}`);
    }
    results.push({ from, channelName, seed, ok: json.ok, messageId: json.messageId, error: json.error });

    await new Promise((r) => setTimeout(r, PACING_MS));
  }
}

console.log(`\n────────────────────────────────────────`);
console.log(`Done. sent=${sent} failed=${failed}`);
console.log(`\nNow check https://www.gmass.co/inbox — results group by subject.`);
