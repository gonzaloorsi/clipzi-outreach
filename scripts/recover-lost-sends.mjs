// Recovery for the 3 emails that went out via Resend but failed to write to
// sends table due to neon-http transaction limitation. Inserts the sends rows
// manually so the next cron tick filters them out.

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const LOST_SENDS = [
  {
    channelId: "UCs-w7E2HZWwXmjt9RTvBB_A",
    email: "settled@clovertalent.gg",
    senderEmail: "g@clipzi.video",
  },
  {
    channelId: "UCcnci5vbpLJ-rh_V9yXwawg",
    email: "martincitopantsagent@jagged.biz",
    senderEmail: "g@clipzi.video",
  },
  {
    channelId: "UC_443VsqmWIzafMrmDHIpbw",
    email: "gio@sunandskyentertainment.com",
    senderEmail: "g@clipzi.video",
  },
];

console.log(`Recovering ${LOST_SENDS.length} lost sends...`);

for (const r of LOST_SENDS) {
  // Look up sender_id
  const senderRow = await sql`SELECT id FROM senders WHERE email = ${r.senderEmail} LIMIT 1`;
  const senderId = senderRow[0]?.id;
  if (!senderId) {
    console.error(`❌ sender ${r.senderEmail} not in senders table`);
    continue;
  }

  // Insert send + update channel atomically (sequential)
  const inserted = await sql`
    INSERT INTO sends (channel_id, email, sender_id, status, sent_at, language, template_id, error_message)
    VALUES (${r.channelId}, ${r.email}, ${senderId}, 'sent', NOW(), 'en', 'v1_en', 'recovery: db write failed in original cron run')
    ON CONFLICT DO NOTHING
    RETURNING id
  `;

  if (inserted.length > 0) {
    await sql`UPDATE channels SET status = 'sent', updated_at = NOW() WHERE id = ${r.channelId}`;
    console.log(`✅ ${r.email} (channel ${r.channelId}) → sender ${r.senderEmail} recovered`);
  } else {
    console.log(`⏭️  ${r.email} already in sends (no-op)`);
  }
}

const total = await sql`SELECT COUNT(*)::int AS c FROM sends`;
console.log(`\nTotal sends now: ${total[0].c}`);
