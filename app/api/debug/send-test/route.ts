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
//   ?from=<email>           default SENDER_EMAIL_1   pick which sender (must be in SENDER_EMAIL_1..10)
//   ?kind=<kind>            default creator   creator|agency|standup-individual|standup-org|media-org
//   ?lang=<lang>            default es        es|en|pt|de|fr
//   ?channelName=<name>     default "Demo Channel"
//
// Listing helpers:
//   ?list=1                 returns the configured senders + kinds + langs without sending anything
//
// Returns JSON with the Resend messageId, the template kind/language actually
// used, and the sender + recipient. NO writes to DB.

import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { loadSenderEmails } from "@/lib/sender-pool";

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
  const list = url.searchParams.get("list") === "1";
  const to = url.searchParams.get("to");
  const fromParam = url.searchParams.get("from")?.trim().toLowerCase();
  // bypass=1 skips the configured-senders check so you can test from a domain
  // that's verified in Resend but NOT in SENDER_EMAIL_1..N. Auth still required.
  // Resend itself rejects sends from unverified domains, so this is safe at the
  // sender side. Use only for diagnostics — never send real outreach this way.
  const bypassValidation = url.searchParams.get("bypass") === "1";
  // Diagnostic flags for deliverability testing — affect ONLY this debug call,
  // not the production cron. textOnly=1 sends plain text instead of HTML.
  // lowercaseSubject=1 lowercases the subject before sending.
  // noLink=1 strips "(clipzi.app)" and bare URLs from the body.
  const textOnly = url.searchParams.get("textOnly") === "1";
  const lowercaseSubject = url.searchParams.get("lowercaseSubject") === "1";
  const noLink = url.searchParams.get("noLink") === "1";
  const kind = url.searchParams.get("kind") ?? "creator";
  const lang = url.searchParams.get("lang") ?? "es";
  const channelName = url.searchParams.get("channelName") ?? "Demo Channel";

  // Loading the configured senders helps with both validation AND the ?list=1
  // mode that returns the discovery payload for the operator.
  const configuredSenders = loadSenderEmails();

  if (list) {
    return NextResponse.json({
      ok: true,
      mode: "list",
      senders: configuredSenders,
      defaultSender: configuredSenders[0] ?? null,
      kinds: Object.keys(KIND_TO_DISCOVERED_VIA),
      langs: [...VALID_LANGS],
    });
  }

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

  if (configuredSenders.length === 0 && !(bypassValidation && fromParam)) {
    return NextResponse.json(
      {
        ok: false,
        error: "no SENDER_EMAIL_1..10 / SENDER_EMAIL configured in env",
      },
      { status: 500 },
    );
  }
  // Pick sender: explicit ?from= must match one in the configured set unless
  // ?bypass=1 is also set (auth still required). Default to the first
  // configured sender when ?from= isn't given. Validation prevents accidental
  // spoofing; bypass is for diagnostics on test-only domains.
  let fromEmail: string;
  if (fromParam) {
    if (!configuredSenders.includes(fromParam) && !bypassValidation) {
      return NextResponse.json(
        {
          ok: false,
          error: `from="${fromParam}" is not configured. Configured senders: ${configuredSenders.join(", ")}. Pass &bypass=1 to override (test only).`,
        },
        { status: 400 },
      );
    }
    fromEmail = fromParam;
    if (bypassValidation && !configuredSenders.includes(fromParam)) {
      console.warn(
        `[debug/send-test] bypass=1: sending from unconfigured sender ${fromParam}`,
      );
    }
  } else {
    fromEmail = configuredSenders[0];
  }

  const fromName = process.env.SENDER_NAME ?? "Clipzi";
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
    textOnly,
    lowercaseSubject,
    noLink,
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
