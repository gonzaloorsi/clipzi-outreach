-- "Most replayed" enrich for the YouTube v2 cold email (lib/heatmap.ts,
-- app/api/cron/hot-moments). Nullable columns, safe to apply live.
-- NOTE: applied directly to Neon (drizzle journal is desynced, see 0005/0006).
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_video_id" text;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_video_title" text;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_video_duration_s" integer;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_published_at" timestamp with time zone;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_start_s" integer;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_start_2_s" integer;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_label" text;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_source" text;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_per_month" integer;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_avg_minutes" integer;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "hot_checked_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "channels_hot_checked_idx" ON "channels" ("hot_checked_at");

-- Two-touch follow-up sequence (bump + close) for the YouTube v2 emails.
ALTER TABLE "followups" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'bump';
DROP INDEX IF EXISTS "followups_send_id_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "followups_send_id_kind_uq" ON "followups" ("send_id", "kind");
