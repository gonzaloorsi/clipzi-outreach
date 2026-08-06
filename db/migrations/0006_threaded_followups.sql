-- Custom RFC Message-ID per outgoing send so follow-up bumps can thread
-- under the original email (In-Reply-To / References headers).
-- NOTE: applied directly to Neon (drizzle journal is desynced, see 0005).
ALTER TABLE "sends" ADD COLUMN IF NOT EXISTS "rfc_message_id" text;
