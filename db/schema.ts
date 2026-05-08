import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  serial,
  uuid,
  boolean,
  uniqueIndex,
  index,
  real,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────────────

export const channelStatusEnum = pgEnum("channel_status", [
  "pending", // discovered, not yet enriched
  "enriched", // enriched (channels.list called), no email or low quality
  "queued", // has email + meets threshold, ready to send
  "sent", // already sent
  "bounced", // hard bounce, never retry
  "complained", // spam complaint, never retry
  "opted_out", // unsubscribed
  "no_email", // enriched but no email found
  "low_quality", // enriched but failed score threshold
]);

export const sendStatusEnum = pgEnum("send_status", [
  "pending",
  "sent",
  "failed",
  "bounced",
  "complained",
  "replied",
  "opened",
]);

export const senderStateEnum = pgEnum("sender_state", [
  "provisioning",
  "warming",
  "active",
  "paused",
  "burned",
]);

export const espEnum = pgEnum("esp", [
  "resend",
  "ses",
  "postmark",
  "instantly",
  "smartlead",
  "mailgun",
]);

export const domainStatusEnum = pgEnum("domain_status", [
  "pending",
  "active",
  "paused",
  "burned",
]);

// ─── channels ────────────────────────────────────────────────────────────────

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    cleanName: text("clean_name"),
    country: text("country"),
    language: text("language"),
    subscribers: integer("subscribers"),
    videoCount: integer("video_count"),

    primaryEmail: text("primary_email"),
    allEmails: jsonb("all_emails").$type<string[]>(),

    topicCategories: jsonb("topic_categories").$type<string[]>(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    discoveredVia: text("discovered_via"),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),

    status: channelStatusEnum("status").notNull().default("pending"),
    score: integer("score"),

    personalizedOpener: text("personalized_opener"),
    personalizedAt: timestamp("personalized_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("channels_status_idx").on(t.status),
    scoreIdx: index("channels_score_idx").on(t.score),
    countryIdx: index("channels_country_idx").on(t.country),
    // NOTE: NOT unique. Multiple channels can share the same contact email
    // (manager, MCN, family channels). The "no repeats on send" guarantee
    // lives on sends.email UNIQUE — that's where it belongs.
    primaryEmailIdx: index("channels_primary_email_idx").on(t.primaryEmail),
    lastRefreshedIdx: index("channels_last_refreshed_idx").on(t.lastRefreshedAt),
  }),
);

// ─── domains (declared before senders/sends because they FK to it) ──────────

export const domains = pgTable(
  "domains",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    dkimOk: boolean("dkim_ok").notNull().default(false),
    spfOk: boolean("spf_ok").notNull().default(false),
    dmarcOk: boolean("dmarc_ok").notNull().default(false),
    reputationTier: text("reputation_tier").notNull().default("unknown"),
    senderCount: integer("sender_count").notNull().default(0),
    status: domainStatusEnum("status").notNull().default("pending"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("domains_status_idx").on(t.status),
  }),
);

// ─── senders ────────────────────────────────────────────────────────────────

export const senders = pgTable(
  "senders",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    domainId: integer("domain_id").references(() => domains.id, {
      onDelete: "set null",
    }),
    esp: espEnum("esp").notNull(),
    espAccountRef: text("esp_account_ref"),

    dailyLimit: integer("daily_limit").notNull().default(50),
    sentToday: integer("sent_today").notNull().default(0),
    sentTotal: integer("sent_total").notNull().default(0),

    state: senderStateEnum("state").notNull().default("provisioning"),
    warmupStartedAt: timestamp("warmup_started_at", { withTimezone: true }),
    warmupTargetDate: timestamp("warmup_target_date", { withTimezone: true }),

    bounceRate7d: real("bounce_rate_7d").notNull().default(0),
    complaintRate7d: real("complaint_rate_7d").notNull().default(0),
    replyRate7d: real("reply_rate_7d").notNull().default(0),
    reputationScore: real("reputation_score").notNull().default(1.0),

    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    pausedReason: text("paused_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    stateIdx: index("senders_state_idx").on(t.state),
    domainIdx: index("senders_domain_idx").on(t.domainId),
  }),
);

// ─── sends ──────────────────────────────────────────────────────────────────

export const sends = pgTable(
  "sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    senderId: integer("sender_id").references(() => senders.id, {
      onDelete: "set null",
    }),
    templateId: text("template_id"),
    language: text("language"),

    status: sendStatusEnum("status").notNull().default("pending"),
    espMessageId: text("esp_message_id"),
    errorMessage: text("error_message"),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    complainedAt: timestamp("complained_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // The two constraints that guarantee "no repeats":
    channelUq: uniqueIndex("sends_channel_id_uq").on(t.channelId),
    emailUq: uniqueIndex("sends_email_uq").on(t.email),
    statusIdx: index("sends_status_idx").on(t.status),
    sentAtIdx: index("sends_sent_at_idx").on(t.sentAt),
    senderIdx: index("sends_sender_idx").on(t.senderId),
  }),
);

// ─── unsubscribes ────────────────────────────────────────────────────────────

export const unsubscribes = pgTable("unsubscribes", {
  email: text("email").primaryKey(),
  channelId: text("channel_id"),
  reason: text("reason"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── discovery_runs ──────────────────────────────────────────────────────────

export const discoveryRuns = pgTable(
  "discovery_runs",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    params: jsonb("params"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    quotaUsed: integer("quota_used").notNull().default(0),
    channelsSeen: integer("channels_seen").notNull().default(0),
    channelsNew: integer("channels_new").notNull().default(0),
    qualifiedNew: integer("qualified_new").notNull().default(0),
    error: text("error"),
  },
  (t) => ({
    sourceIdx: index("discovery_runs_source_idx").on(t.source),
    startedAtIdx: index("discovery_runs_started_at_idx").on(t.startedAt),
  }),
);

// ─── query_pool ──────────────────────────────────────────────────────────────

export const queryPool = pgTable(
  "query_pool",
  {
    id: serial("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    params: jsonb("params").notNull(),
    timesRun: integer("times_run").notNull().default(0),
    avgYield: real("avg_yield").notNull().default(0),
    avgFreshness: real("avg_freshness").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    exhaustedUntil: timestamp("exhausted_until", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sourceTypeIdx: index("query_pool_source_type_idx").on(t.sourceType),
    enabledIdx: index("query_pool_enabled_idx").on(t.enabled),
  }),
);

// ─── email_templates ─────────────────────────────────────────────────────
// Editable templates. The send pipeline tries DB first, falls back to the
// hardcoded ones in lib/templates/*.ts if a key is missing.
//
// Key format: "{kind}-{lang}" where kind ∈ {creator, agency} and lang ∈
// {en, es, pt, de, fr}. Examples: creator-en, agency-es, creator-pt.

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull().unique(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    keyIdx: index("email_templates_key_idx").on(t.key),
  }),
);

// ─── email_validations ──────────────────────────────────────────────────
// Cache for Bouncer email-verification results. Key by email so the same
// address used by multiple channels validates once. Re-validate after 90 days.

export const emailValidations = pgTable(
  "email_validations",
  {
    email: text("email").primaryKey(),
    // bouncer status: deliverable | risky | undeliverable | unknown
    status: text("status").notNull(),
    reason: text("reason"),
    score: integer("score"),
    raw: jsonb("raw"),
    verifiedAt: timestamp("verified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("email_validations_status_idx").on(t.status),
    verifiedAtIdx: index("email_validations_verified_at_idx").on(t.verifiedAt),
  }),
);

// ─── Type exports ───────────────────────────────────────────────────────────

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type Send = typeof sends.$inferSelect;
export type NewSend = typeof sends.$inferInsert;
export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;
export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;
export type Unsubscribe = typeof unsubscribes.$inferSelect;
export type DiscoveryRun = typeof discoveryRuns.$inferSelect;
export type NewDiscoveryRun = typeof discoveryRuns.$inferInsert;
export type QueryPoolEntry = typeof queryPool.$inferSelect;
export type NewQueryPoolEntry = typeof queryPool.$inferInsert;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
export type EmailValidation = typeof emailValidations.$inferSelect;
export type NewEmailValidation = typeof emailValidations.$inferInsert;
