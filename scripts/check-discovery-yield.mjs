import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("\n═══ Last 8 runs PER source ═══");
for (const source of ["trending", "sonar:agency", "sonar:standup"]) {
  console.log(`\n[${source}]`);
  const runs = await sql`
    SELECT id,
      TO_CHAR(started_at, 'YY-MM-DD HH24:MI') AS started,
      CASE WHEN ended_at IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (ended_at - started_at))::numeric, 1)
        ELSE NULL
      END AS dur_s,
      channels_seen AS seen,
      channels_new AS new_,
      qualified_new AS qualif,
      CASE WHEN error IS NOT NULL THEN LEFT(error, 60) ELSE '' END AS err
    FROM discovery_runs
    WHERE source = ${source}
    ORDER BY id DESC LIMIT 8
  `;
  console.table(runs);
}

console.log("\n═══ trending freshness trend (last 4 days) ═══");
const sat = await sql`
  SELECT
    TO_CHAR(started_at, 'MM-DD HH24:MI') AS run_at,
    channels_seen AS seen,
    channels_new AS new_,
    ROUND(100.0 * channels_new / NULLIF(channels_seen, 0), 1) AS fresh_pct,
    qualified_new AS qualif,
    ROUND(100.0 * qualified_new / NULLIF(channels_new, 0), 1) AS pass_pct,
    quota_used AS quota
  FROM discovery_runs
  WHERE source = 'trending' AND started_at > NOW() - INTERVAL '4 days'
  ORDER BY id DESC
`;
console.table(sat);

console.log("\n═══ Last 90 min — what was actually inserted? ═══");
const recent = await sql`
  SELECT discovered_via, COUNT(*)::int AS rows_inserted
  FROM channels
  WHERE created_at > NOW() - INTERVAL '90 minutes'
  GROUP BY discovered_via
  ORDER BY rows_inserted DESC
  LIMIT 25
`;
console.table(recent);
