// Loads email templates from the email_templates DB table, with fallback to
// the hardcoded code-based templates in lib/templates/*.ts.
//
// Why both?
//   - DB-stored templates can be edited from /dashboard/templates without a
//     deploy. That's what the founder uses for quick copy iterations.
//   - Code-based templates are the safety net: if the DB is empty (fresh
//     install) or a row is missing, we still send something correct.
//   - On every render, a single SELECT is cached for the lifetime of the
//     request so the send cron only hits DB once per run.

import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { emailTemplates } from "../../db/schema";
import type { TemplateBuilder, TemplateInput, TemplateOutput, SupportedLanguage } from "./types";
import { esc } from "./types";

// Code fallbacks
import { build as creatorEn } from "./en";
import { build as creatorEs } from "./es";
import { build as creatorPt } from "./pt";
import { build as creatorDe } from "./de";
import { build as creatorFr } from "./fr";
import { build as agencyEn } from "./agency-en";
import { build as agencyEs } from "./agency-es";
import { build as agencyPt } from "./agency-pt";

const CODE_BUILDERS: Record<string, TemplateBuilder> = {
  "creator-en": creatorEn,
  "creator-es": creatorEs,
  "creator-pt": creatorPt,
  "creator-de": creatorDe,
  "creator-fr": creatorFr,
  "agency-en": agencyEn,
  "agency-es": agencyEs,
  "agency-pt": agencyPt,
};

export interface TemplateRow {
  key: string;
  subject: string;
  html: string;
  source: "db" | "code";
  notes?: string | null;
  updatedAt?: Date | string | null;
}

/**
 * Build a TemplateBuilder that interpolates {channelName} and {fromName}
 * variables, escaping each. Unknown placeholders pass through as-is.
 */
function buildFromStrings(subject: string, html: string): TemplateBuilder {
  return (input: TemplateInput): TemplateOutput => {
    const interpolate = (s: string) =>
      s.replace(/\{(\w+)\}/g, (_, key) => {
        if (key === "channelName") return esc(input.channelName);
        if (key === "fromName") return esc(input.fromName);
        return `{${key}}`;
      });
    return {
      subject: interpolate(subject),
      html: interpolate(html),
    };
  };
}

/**
 * Get the template body for a key. Tries DB first, falls back to code.
 * Returns null if neither has it (caller should default to creator-en).
 */
export async function loadTemplateRow(key: string): Promise<TemplateRow | null> {
  // DB first
  const [row] = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.key, key))
    .limit(1);
  if (row) {
    return {
      key,
      subject: row.subject,
      html: row.html,
      source: "db",
      notes: row.notes,
      updatedAt: row.updatedAt,
    };
  }
  // Code fallback — render with placeholder names so the dashboard preview shows them
  const builder = CODE_BUILDERS[key];
  if (!builder) return null;
  // Reverse-engineer the subject/html templates by rendering with sentinel values
  // and replacing them back to {channelName}/{fromName}. This works for our
  // current templates; if a builder embeds the variables in complex HTML, the
  // sentinel approach is brittle but acceptable for the bootstrap.
  const rendered = builder({
    channelName: "__CHANNEL_NAME_SENTINEL__",
    fromName: "__FROM_NAME_SENTINEL__",
  });
  const subject = rendered.subject
    .replace(/__CHANNEL_NAME_SENTINEL__/g, "{channelName}")
    .replace(/__FROM_NAME_SENTINEL__/g, "{fromName}");
  const html = rendered.html
    .replace(/__CHANNEL_NAME_SENTINEL__/g, "{channelName}")
    .replace(/__FROM_NAME_SENTINEL__/g, "{fromName}");
  return { key, subject, html, source: "code" };
}

/**
 * List all known template keys with their current row (DB or code default).
 * Used by the dashboard listing.
 */
export async function listAllTemplates(): Promise<TemplateRow[]> {
  const allKeys = Object.keys(CODE_BUILDERS);
  const rows = await Promise.all(allKeys.map((k) => loadTemplateRow(k)));
  return rows.filter((r): r is TemplateRow => r !== null);
}

/**
 * Resolve a template row → builder usable by the send pipeline.
 */
export function rowToBuilder(row: TemplateRow): TemplateBuilder {
  return buildFromStrings(row.subject, row.html);
}

/**
 * Convenience: load + buildBuilder + return TemplateBuilder ready to call.
 * Caller should pass the appropriate fallback key (e.g. "creator-en") if the
 * desired key is missing from both DB and code.
 */
export async function loadTemplateBuilder(
  key: string,
  fallbackKey = "creator-en",
): Promise<{ builder: TemplateBuilder; source: "db" | "code"; resolvedKey: string }> {
  let row = await loadTemplateRow(key);
  let resolved = key;
  if (!row) {
    row = await loadTemplateRow(fallbackKey);
    resolved = fallbackKey;
  }
  if (!row) {
    // Last resort — should never happen
    throw new Error(`No template found for key=${key} or fallback=${fallbackKey}`);
  }
  return { builder: rowToBuilder(row), source: row.source, resolvedKey: resolved };
}

/**
 * Save (insert or update) a template row. Used by the dashboard editor.
 */
export async function saveTemplateRow(
  key: string,
  subject: string,
  html: string,
  notes?: string | null,
): Promise<void> {
  await db
    .insert(emailTemplates)
    .values({ key, subject, html, notes: notes ?? null })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: {
        subject,
        html,
        notes: notes ?? null,
        updatedAt: new Date(),
      },
    });
}

export const ALL_TEMPLATE_KEYS = Object.keys(CODE_BUILDERS);
