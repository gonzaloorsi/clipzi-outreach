import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const au = await sql`
  SELECT id, title, clean_name, country, language, primary_email, score, subscribers
  FROM channels
  WHERE status = 'queued' AND country = 'AU' AND primary_email IS NOT NULL
  ORDER BY score DESC, subscribers DESC
  LIMIT 10
`;
console.log(`AU queued candidates: ${au.length}`);
console.table(au);
