// Debug endpoint to send a single test email through the production sender.
// Bypasses the send cron / DB pipeline — fires sendEmail() directly so the
// recipient sees the same template + sender + DKIM that real outreach uses.
// Intended for Mail-Tester runs and manual deliverability checks.
//
// Auth: Bearer / x-cron-secret against CRON_SECRET (same pattern as the crons).
// In non-production NODE_ENV the auth gate is bypassed so local dev still works.
//
// Query params:
//   ?to=<email>             (required)  destinatario
//   ?kind=<kind>            default creator   creator|agency|standup-individual|standup-org|media-org
//   ?lang=<lang>            default es        es|en|pt|de|fr
//   ?channelName=<name>     default "Demo Channel"
//
// Returns JSON with the Resend messageId, the template kind/language actually
// used, and the sender + recipient. NO writes to DB.

import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

const KIND_TO_DISCOVERED_VIA: Record<string, string> = {
  creator: "trending",
  agency: "sonar:agency:AR:marketing",
  "standup-individual": "sonar:standup-individual:AR:comedian",
  "standup-org": "sonar:standup-org:AR:club",
  "media-org": "sonar:media-org:AR:streaming-tv",
};

const VALID_LANGS = new Set(["es", "en", "pt", "de", "fr"]);

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  const kind = url.searchParams.get("kind") ?? "creator";
  const lang = url.searchParams.get("lang") ?? "es";
  const channelName = url.searchParams.get("channelName") ?? "Demo Channel";

  if (!to) {
    return NextResponse.json(
      { ok: false, error: "missing required query param: to" },
      { status: 400 },
    );
  }
  if (!KIND_TO_DISCOVERED_VIA[kind]) {
    return NextResponse.json(
      {
        ok: false,
        error: `unknown kind="${kind}", expected one of: ${Object.keys(KIND_TO_DISCOVERED_VIA).join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (!VALID_LANGS.has(lang)) {
    return NextResponse.json(
      { ok: false, error: `unknown lang="${lang}", expected one of: es, en, pt, de, fr` },
      { status: 400 },
    );
  }

  const fromEmail = process.env.SENDER_EMAIL_1 ?? process.env.SENDER_EMAIL ?? "";
  const fromName = process.env.SENDER_NAME ?? "Clipzi";
  if (!fromEmail) {
    return NextResponse.json(
      { ok: false, error: "SENDER_EMAIL_1 / SENDER_EMAIL not configured" },
      { status: 500 },
    );
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "RESEND_API_KEY not configured" },
      { status: 500 },
    );
  }

  const discoveredVia = KIND_TO_DISCOVERED_VIA[kind];
  // Country defaults to AR for the discoveredVia mapping; only matters for
  // language fallback chain in pickTemplateFromDb. The explicit `language` we
  // pass takes priority over country-based detection anyway.
  const country = "AR";

  const result = await sendEmail({
    to,
    channelName,
    fromEmail,
    fromName,
    country,
    language: lang,
    discoveredVia,
  });

  return NextResponse.json({
    ok: result.ok,
    messageId: result.messageId,
    error: result.error,
    kind: result.kind,
    language: result.language,
    fromEmail,
    fromName,
    sentTo: to,
    channelName,
    requestedKind: kind,
    requestedLang: lang,
  });
}
