import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Test 1: trying to insert duplicate (channel_id) into sends...");
const sample = await sql`SELECT channel_id, email FROM sends LIMIT 1`;
if (sample.length === 0) {
  console.log("  no sends in DB to test against");
  process.exit(0);
}
const { channel_id, email } = sample[0];
console.log(`  picked: channel_id=${channel_id}, email=${email}`);

try {
  await sql`
    INSERT INTO sends (channel_id, email, status)
    VALUES (${channel_id}, 'different-email@test.com', 'pending')
  `;
  console.log("  ❌ FAIL: duplicate channel_id was accepted!");
  process.exit(1);
} catch (e) {
  if (e.code === "23505") {
    console.log(`  ✅ PASS: blocked by ${e.constraint}`);
  } else {
    throw e;
  }
}

console.log("\nTest 2: trying to insert duplicate (email) into sends...");
try {
  // need a real channel_id that has no send yet
  const fresh = await sql`
    SELECT id FROM channels WHERE id NOT IN (SELECT channel_id FROM sends) LIMIT 1
  `;
  if (fresh.length === 0) {
    console.log("  skipped (no fresh channels)");
  } else {
    await sql`
      INSERT INTO sends (channel_id, email, status)
      VALUES (${fresh[0].id}, ${email}, 'pending')
    `;
    console.log("  ❌ FAIL: duplicate email was accepted!");
    process.exit(1);
  }
} catch (e) {
  if (e.code === "23505") {
    console.log(`  ✅ PASS: blocked by ${e.constraint}`);
  } else {
    throw e;
  }
}

console.log("\nTest 3: ON CONFLICT DO NOTHING is silent...");
const before = await sql`SELECT COUNT(*)::int AS c FROM sends`;
await sql`
  INSERT INTO sends (channel_id, email, status)
  VALUES (${channel_id}, ${email}, 'pending')
  ON CONFLICT DO NOTHING
`;
const after = await sql`SELECT COUNT(*)::int AS c FROM sends`;
if (before[0].c === after[0].c) {
  console.log(`  ✅ PASS: count unchanged (${before[0].c} → ${after[0].c}), ON CONFLICT silently skipped`);
} else {
  console.log(`  ❌ FAIL: count changed ${before[0].c} → ${after[0].c}`);
  process.exit(1);
}

console.log("\n🎉 All no-repeats guarantees verified.");
