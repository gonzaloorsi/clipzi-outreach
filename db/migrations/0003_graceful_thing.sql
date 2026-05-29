CREATE TABLE "email_validations" (
	"email" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"score" integer,
	"raw" jsonb,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_threads" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"lead_email" text,
	"channel_name" text,
	"alias" text,
	"action" text NOT NULL,
	"code" text,
	"last_message_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_validations_status_idx" ON "email_validations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_validations_verified_at_idx" ON "email_validations" USING btree ("verified_at");--> statement-breakpoint
CREATE INDEX "processed_threads_action_idx" ON "processed_threads" USING btree ("action");--> statement-breakpoint
CREATE INDEX "processed_threads_created_at_idx" ON "processed_threads" USING btree ("created_at");