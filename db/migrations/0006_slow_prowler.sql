ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "video_email_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN IF NOT EXISTS "rfc_message_id" text;
