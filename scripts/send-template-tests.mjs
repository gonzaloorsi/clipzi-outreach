// Sends 3 test emails to a fixed address using lib/email.ts directly. Bypasses
// DB and the send cron — just renders the template and ships via Resend so the
// recipient can preview the copy in their inbox.
//
// Usage: npx tsx scripts/send-template-tests.mjs [recipient@email.com]
// Default recipient: gonzaloorsi@gmail.com

import { config } from "dotenv";
config({ path: ".env.local" });

import { sendEmail } from "../lib/email.ts";

const TO = process.argv[2] ?? "gonzaloorsi@gmail.com";
const FROM_EMAIL = process.env.SENDER_EMAIL_1 ?? process.env.SENDER_EMAIL;
const FROM_NAME = process.env.SENDER_NAME ?? "Gonzalo Orsi";

if (!FROM_EMAIL) {
  console.error("❌ SENDER_EMAIL_1 (or SENDER_EMAIL) not set in .env.local");
  process.exit(1);
}
if (!process.env.RESEND_API_KEY) {
  console.error("❌ RESEND_API_KEY not set in .env.local");
  process.exit(1);
}

const cases = [
  {
    label: "creator-es (B2C, sin intro 'founder')",
    channelName: "Migue Granados",
    country: "AR",
    language: "es",
    discoveredVia: "trending",
  },
  {
    label: "standup-org-es (B2B comedy)",
    channelName: "Comedy Zone Buenos Aires",
    country: "AR",
    language: "es",
    discoveredVia: "sonar:standup-org:AR:club",
  },
  {
    label: "media-org-es (B2B streaming-TV)",
    channelName: "Olga",
    country: "AR",
    language: "es",
    discoveredVia: "sonar:media-org:AR:streaming-tv",
  },
];

console.log(`\nSending ${cases.length} test emails to ${TO}`);
console.log(`From: ${FROM_NAME} <${FROM_EMAIL}>\n`);

for (const c of cases) {
  console.log(`→ ${c.label}`);
  console.log(`   channelName: ${c.channelName}`);
  const result = await sendEmail({
    to: TO,
    channelName: c.channelName,
    fromEmail: FROM_EMAIL,
    fromName: FROM_NAME,
    country: c.country,
    language: c.language,
    discoveredVia: c.discoveredVia,
  });
  if (result.ok) {
    console.log(
      `   ✓ sent — kind=${result.kind} lang=${result.language} resend_id=${result.messageId}`,
    );
  } else {
    console.log(`   ✗ failed: ${result.error}`);
  }
  // Small pacing so Resend rate-limit doesn't kick in (10 req/s default)
  await new Promise((r) => setTimeout(r, 300));
}

console.log("\nDone. Check inbox at " + TO);
