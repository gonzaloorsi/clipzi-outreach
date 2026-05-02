import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Queued candidates by country (top 20):");
const byCountry = await sql`
  SELECT country, COUNT(*)::int AS cnt
  FROM channels
  WHERE status = 'queued' AND primary_email IS NOT NULL
  GROUP BY country
  ORDER BY cnt DESC
  LIMIT 20
`;
console.table(byCountry);

const total = await sql`SELECT COUNT(*)::int AS cnt FROM channels WHERE status = 'queued' AND primary_email IS NOT NULL`;
const noCountry = await sql`SELECT COUNT(*)::int AS cnt FROM channels WHERE status = 'queued' AND primary_email IS NOT NULL AND (country IS NULL OR country = '')`;
console.log(`\nTotal queued: ${total[0].cnt}, of which no country: ${noCountry[0].cnt}`);

console.log("\nQueued by declared language (channel.defaultLanguage):");
const byLang = await sql`
  SELECT language, COUNT(*)::int AS cnt
  FROM channels
  WHERE status = 'queued' AND primary_email IS NOT NULL AND language IS NOT NULL
  GROUP BY language
  ORDER BY cnt DESC
  LIMIT 15
`;
console.table(byLang);

const noLang = await sql`SELECT COUNT(*)::int AS cnt FROM channels WHERE status = 'queued' AND primary_email IS NOT NULL AND language IS NULL`;
console.log(`Queued with no declared language: ${noLang[0].cnt}`);
