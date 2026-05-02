import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("PIPELINE TOTAL:");
const status = await sql`
  SELECT status, COUNT(*)::int AS cnt
  FROM channels GROUP BY status ORDER BY cnt DESC
`;
console.table(status);

console.log("\nQUEUED → ready to send (filtered: NOT IN sends, NOT IN unsubscribes):");
const sendable = await sql`
  SELECT COUNT(*)::int AS cnt
  FROM channels c
  WHERE c.status = 'queued'
    AND c.primary_email IS NOT NULL
    AND c.primary_email NOT IN (SELECT email FROM sends)
    AND c.primary_email NOT IN (SELECT email FROM unsubscribes)
`;
console.log(`  ${sendable[0].cnt} sendable right now`);

console.log("\nSendable by inferred language (via country):");
const byLang = await sql`
  WITH country_lang AS (
    SELECT id, primary_email, score, country,
      CASE
        WHEN country IN ('AR','MX','CO','CL','PE','EC','VE','UY','PY','BO','CR','PA','DO','GT','ES','NI','SV','HN','CU','PR') THEN 'es'
        WHEN country IN ('BR','PT','AO','MZ') THEN 'pt'
        WHEN country IN ('DE','AT','CH') THEN 'de'
        WHEN country IN ('FR','BE','LU','MC','SN','CI') THEN 'fr'
        WHEN country IN ('US','GB','CA','AU','NZ','IE','IN','ZA','NG','KE','GH','PH','SG','MY','PK') THEN 'en'
        WHEN country IS NULL THEN 'unknown'
        ELSE 'en (fallback)'
      END AS lang_used
    FROM channels
    WHERE status = 'queued'
      AND primary_email IS NOT NULL
      AND primary_email NOT IN (SELECT email FROM sends)
      AND primary_email NOT IN (SELECT email FROM unsubscribes)
  )
  SELECT lang_used, COUNT(*)::int AS cnt
  FROM country_lang
  GROUP BY lang_used
  ORDER BY cnt DESC
`;
console.table(byLang);

console.log("\nSendable by country (top 15):");
const byCountry = await sql`
  SELECT COALESCE(country, '(null)') AS country, COUNT(*)::int AS cnt
  FROM channels
  WHERE status = 'queued' AND primary_email IS NOT NULL
    AND primary_email NOT IN (SELECT email FROM sends)
    AND primary_email NOT IN (SELECT email FROM unsubscribes)
  GROUP BY country
  ORDER BY cnt DESC
  LIMIT 15
`;
console.table(byCountry);

console.log("\nALL-TIME SENDS:");
const sends = await sql`SELECT COUNT(*)::int AS cnt, status FROM sends GROUP BY status`;
console.table(sends);

console.log("\nDOWNSTREAM CAPACITY:");
const sendable_count = sendable[0].cnt;
const at_200_per_day = (sendable_count / 200).toFixed(1);
console.log(`  ${sendable_count} sendable / 200 daily = ${at_200_per_day} días de runway sin discovery extra`);
console.log(`  (discovery sigue agregando ~1-2K queued/día via cron de 6h)`);
