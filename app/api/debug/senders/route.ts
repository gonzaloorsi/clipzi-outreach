// Debug: inspect the configured sender inboxes from env (runs on Vercel, so it
// reads the real production SENDER_EMAIL_* vars). Shows every raw slot, the
// deduped/loaded set the pool actually uses, and flags blanks/duplicates — so a
// "31 in Vercel but 30 loaded" mismatch is easy to spot.
//
// Auth: CRON_SECRET via Authorization: Bearer or x-cron-secret.

import { NextRequest, NextResponse } from "next/server";
import { loadSenderEmails } from "@/lib/sender-pool";

export const runtime = "nodejs";
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

  // Every raw SENDER_EMAIL_<n> slot (+ legacy SENDER_EMAIL), in numeric order.
  const slots: Array<{ key: string; value: string }> = [];
  if (process.env.SENDER_EMAIL !== undefined) {
    slots.push({ key: "SENDER_EMAIL", value: process.env.SENDER_EMAIL ?? "" });
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (/^SENDER_EMAIL_\d+$/.test(key)) slots.push({ key, value: value ?? "" });
  }
  slots.sort((a, b) => {
    const na = Number(a.key.split("_").pop()) || 0;
    const nb = Number(b.key.split("_").pop()) || 0;
    return na - nb;
  });

  // Blanks and duplicates (case-insensitive), so the extra slot is obvious.
  const blanks = slots.filter((s) => !s.value.trim()).map((s) => s.key);
  const seen = new Set<string>();
  const duplicates: Array<{ key: string; email: string }> = [];
  for (const s of slots) {
    const e = s.value.trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) duplicates.push({ key: s.key, email: e });
    else seen.add(e);
  }

  const loaded = loadSenderEmails(); // deduped, non-empty — what the pool uses

  return NextResponse.json({
    rawSlotCount: slots.length,
    loadedCount: loaded.length,
    blanks,
    duplicates,
    loaded,
    slots,
  });
}
