import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const tables = await sql`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`;
console.log("Tables in Neon:");
tables.forEach((r) => console.log("  -", r.table_name));

const indexes = await sql`
  SELECT tablename, indexname FROM pg_indexes
  WHERE schemaname = 'public' AND indexname LIKE '%uq%'
  ORDER BY tablename, indexname
`;
console.log("\nUNIQUE indexes (the 'no repeats' guarantees):");
indexes.forEach((r) => console.log("  -", r.tablename + "." + r.indexname));

const enums = await sql`
  SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname
`;
console.log("\nEnums:");
enums.forEach((r) => console.log("  -", r.typname));
