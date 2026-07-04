// Welcome-reply cron — reads replies to the 5-min-after-signup welcome email
// (subject "Re: Clipzi"), drafts a response in Gonza's voice (AI Gateway), and
// auto-sends the easy categories / escalates the sensitive ones. Onboarding +
// support, NOT sales. Never mints discount codes.
//
// Query params:
//   ?dry=1            dry run: decide + preview, never send/draft/label/persist
//   ?max=N            cap how many threads to ACT on this run (default 25)
//   ?sinceDays=N      how far back to scan (default 14)
//   ?scanCap=N        max threads to fetch/inspect
//   ?after=YYYY-MM-DD scan threads after this date (backlog)
//   ?threadId=ID      act on a single thread (manual one-off)
//   ?force=1          run live even if WELCOME_REPLIES_ENABLED is not "true"
//
// Activation gate: live (non-dry) runs are a no-op unless WELCOME_REPLIES_ENABLED
// === "true" (or ?force=1). This lets us deploy + validate in dry-run before the
// agent emails real customers. Dry runs always run.
//
// Auth: CRON_SECRET via Authorization: Bearer or x-cron-secret (Vercel injects it).

import { NextRequest, NextResponse } from "next/server";
import { runWelcomeReplies } from "@/lib/welcome-reply";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force") === "1";
  const enabled = process.env.WELCOME_REPLIES_ENABLED === "true";

  // Safety: don't send for real until explicitly enabled.
  if (!dryRun && !enabled && !force) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "disabled",
      hint: "set WELCOME_REPLIES_ENABLED=true to activate, or use ?dry=1 / ?force=1",
    });
  }

  const max = Number(url.searchParams.get("max")) || undefined;
  const sinceDays = Number(url.searchParams.get("sinceDays")) || undefined;
  const scanCap = Number(url.searchParams.get("scanCap")) || undefined;
  const after = url.searchParams.get("after") || undefined;
  const onlyThreadId = url.searchParams.get("threadId") || undefined;

  try {
    const summary = await runWelcomeReplies({ dryRun, max, sinceDays, scanCap, after, onlyThreadId });
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[welcome-replies] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
