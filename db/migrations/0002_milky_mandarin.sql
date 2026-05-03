CREATE TABLE "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX "email_templates_key_idx" ON "email_templates" USING btree ("key");