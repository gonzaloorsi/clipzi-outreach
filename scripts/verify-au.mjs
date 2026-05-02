import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Most recent AU send (last 5 min):");
const last = await sql`
  SELECT s.email, s.status, s.language, s.template_id, s.esp_message_id, s.sent_at,
         c.title, c.country, c.subscribers, c.score, c.status AS channel_status,
         snd.email AS sender
  FROM sends s
  JOIN channels c ON c.id = s.channel_id
  LEFT JOIN senders snd ON snd.id = s.sender_id
  WHERE c.country = 'AU' AND s.sent_at > NOW() - INTERVAL '5 minutes'
  ORDER BY s.sent_at DESC LIMIT 1
`;
console.table(last);

console.log("\nAll-time language distribution of sends from new system:");
const langs = await sql`
  SELECT language, template_id, COUNT(*)::int AS cnt
  FROM sends
  WHERE template_id IS NOT NULL
  GROUP BY language, template_id
  ORDER BY cnt DESC
`;
console.table(langs);
