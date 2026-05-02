CREATE TYPE "public"."channel_status" AS ENUM('pending', 'enriched', 'queued', 'sent', 'bounced', 'complained', 'opted_out', 'no_email', 'low_quality');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'active', 'paused', 'burned');--> statement-breakpoint
CREATE TYPE "public"."esp" AS ENUM('resend', 'ses', 'postmark', 'instantly', 'smartlead', 'mailgun');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('pending', 'sent', 'failed', 'bounced', 'complained', 'replied', 'opened');--> statement-breakpoint
CREATE TYPE "public"."sender_state" AS ENUM('provisioning', 'warming', 'active', 'paused', 'burned');--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"clean_name" text,
	"country" text,
	"language" text,
	"subscribers" integer,
	"video_count" integer,
	"primary_email" text,
	"all_emails" jsonb,
	"topic_categories" jsonb,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discovered_via" text,
	"last_refreshed_at" timestamp with time zone,
	"status" "channel_status" DEFAULT 'pending' NOT NULL,
	"score" integer,
	"personalized_opener" text,
	"personalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"params" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"quota_used" integer DEFAULT 0 NOT NULL,
	"channels_seen" integer DEFAULT 0 NOT NULL,
	"channels_new" integer DEFAULT 0 NOT NULL,
	"qualified_new" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dkim_ok" boolean DEFAULT false NOT NULL,
	"spf_ok" boolean DEFAULT false NOT NULL,
	"dmarc_ok" boolean DEFAULT false NOT NULL,
	"reputation_tier" text DEFAULT 'unknown' NOT NULL,
	"sender_count" integer DEFAULT 0 NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "query_pool" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"params" jsonb NOT NULL,
	"times_run" integer DEFAULT 0 NOT NULL,
	"avg_yield" real DEFAULT 0 NOT NULL,
	"avg_freshness" real DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"exhausted_until" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"domain_id" integer,
	"esp" "esp" NOT NULL,
	"esp_account_ref" text,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"sent_today" integer DEFAULT 0 NOT NULL,
	"sent_total" integer DEFAULT 0 NOT NULL,
	"state" "sender_state" DEFAULT 'provisioning' NOT NULL,
	"warmup_started_at" timestamp with time zone,
	"warmup_target_date" timestamp with time zone,
	"bounce_rate_7d" real DEFAULT 0 NOT NULL,
	"complaint_rate_7d" real DEFAULT 0 NOT NULL,
	"reply_rate_7d" real DEFAULT 0 NOT NULL,
	"reputation_score" real DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone,
	"paused_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "senders_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"email" text NOT NULL,
	"sender_id" integer,
	"template_id" text,
	"language" text,
	"status" "send_status" DEFAULT 'pending' NOT NULL,
	"esp_message_id" text,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unsubscribes" (
	"email" text PRIMARY KEY NOT NULL,
	"channel_id" text,
	"reason" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_status_idx" ON "channels" USING btree ("status");--> statement-breakpoint
CREATE INDEX "channels_score_idx" ON "channels" USING btree ("score");--> statement-breakpoint
CREATE INDEX "channels_country_idx" ON "channels" USING btree ("country");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_primary_email_uq" ON "channels" USING btree ("primary_email") WHERE "channels"."primary_email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channels_last_refreshed_idx" ON "channels" USING btree ("last_refreshed_at");--> statement-breakpoint
CREATE INDEX "discovery_runs_source_idx" ON "discovery_runs" USING btree ("source");--> statement-breakpoint
CREATE INDEX "discovery_runs_started_at_idx" ON "discovery_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "domains_status_idx" ON "domains" USING btree ("status");--> statement-breakpoint
CREATE INDEX "query_pool_source_type_idx" ON "query_pool" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "query_pool_enabled_idx" ON "query_pool" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "senders_state_idx" ON "senders" USING btree ("state");--> statement-breakpoint
CREATE INDEX "senders_domain_idx" ON "senders" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sends_channel_id_uq" ON "sends" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sends_email_uq" ON "sends" USING btree ("email");--> statement-breakpoint
CREATE INDEX "sends_status_idx" ON "sends" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sends_sent_at_idx" ON "sends" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "sends_sender_idx" ON "sends" USING btree ("sender_id");