import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Recent agency-related discovery runs:");
const runs = await sql`
  SELECT id, source, started_at, ended_at,
    CASE WHEN ended_at IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (ended_at - started_at))::numeric, 1)
      ELSE ROUND(EXTRACT(EPOCH FROM (NOW() - started_at))::numeric, 1)
    END AS duration_s,
    channels_seen, channels_new, qualified_new, error,
    CASE WHEN ended_at IS NULL THEN 'RUNNING' ELSE 'finished' END AS status
  FROM discovery_runs
  WHERE source LIKE '%agency%'
  ORDER BY id DESC LIMIT 10
`;
console.table(runs);

console.log("\nAgency channels inserted in last 1h:");
const recent = await sql`
  WITH parsed AS (
    SELECT
      SPLIT_PART(discovered_via, ':', 3) AS country,
      SPLIT_PART(discovered_via, ':', 4) AS category
    FROM channels
    WHERE discovered_via LIKE 'sonar:agency:%' AND created_at > NOW() - INTERVAL '1 hour'
  )
  SELECT country, category, COUNT(*)::int AS cnt
  FROM parsed
  GROUP BY country, category
  ORDER BY cnt DESC
`;
console.table(recent);

const total = await sql`
  SELECT COUNT(*)::int AS cnt FROM channels
  WHERE discovered_via LIKE 'sonar:agency:%' AND created_at > NOW() - INTERVAL '1 hour'
`;
console.log(`\nTotal agency rows inserted last 1h: ${total[0].cnt}`);
