// Lead-reply cron — reads outreach replies in gonzaloorsi@gmail.com, drafts a
// response in Gonza's voice (AI Gateway), and sends via Resend from the correct
// clipzi alias, minting a Stripe trial code when the lead wants to test.
//
// Query params:
//   ?dry=1            dry run: decide + preview, but never send/mint/label/persist
//   ?max=N            cap how many threads to ACT on this run (default 25)
//   ?sinceDays=N      how far back to scan (default 14)
//
// Auth: CRON_SECRET via Authorization: Bearer or x-cron-secret (Vercel injects it).

import { NextRequest, NextResponse } from "next/server";
import { runLeadReplies } from "@/lib/lead-reply";

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
  const max = Number(url.searchParams.get("max")) || undefined;
  const sinceDays = Number(url.searchParams.get("sinceDays")) || undefined;
  const scanCap = Number(url.searchParams.get("scanCap")) || undefined;
  const after = url.searchParams.get("after") || undefined;
  const onlyThreadId = url.searchParams.get("threadId") || undefined;

  try {
    const summary = await runLeadReplies({ dryRun, max, sinceDays, scanCap, after, onlyThreadId });
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[lead-replies] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
