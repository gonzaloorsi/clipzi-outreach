import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Senders:");
const senders = await sql`
  SELECT id, email, daily_limit, sent_total, last_used_at, state
  FROM senders ORDER BY id
`;
console.table(senders);

console.log("\nLast 10 sends:");
const recent = await sql`
  SELECT s.id, s.email, s.sender_id, snd.email AS sender_email, s.status, s.esp_message_id, s.sent_at
  FROM sends s
  LEFT JOIN senders snd ON snd.id = s.sender_id
  ORDER BY s.sent_at DESC NULLS LAST, s.created_at DESC
  LIMIT 10
`;
console.table(recent);

console.log("\nSends counts in last 24h per sender:");
const lastDay = await sql`
  SELECT snd.email AS sender, COUNT(*)::int AS sends_24h
  FROM sends s
  LEFT JOIN senders snd ON snd.id = s.sender_id
  WHERE s.sent_at > NOW() - INTERVAL '24 hours' AND s.status = 'sent'
  GROUP BY snd.email
  ORDER BY sends_24h DESC
`;
console.table(lastDay);

console.log("\nChannels by status (top 5):");
const status = await sql`
  SELECT status, COUNT(*)::int AS cnt FROM channels GROUP BY status ORDER BY cnt DESC
`;
console.table(status);
