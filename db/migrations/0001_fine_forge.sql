DROP INDEX "channels_primary_email_uq";--> statement-breakpoint
CREATE INDEX "channels_primary_email_idx" ON "channels" USING btree ("primary_email");