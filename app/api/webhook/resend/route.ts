// Resend webhook — hard bounces and spam complaints on outreach sends.
// Until now `sends` never learned about either (158k sends, zero bounces
// recorded): the send cron was flying blind on deliverability. Subscribe ONLY
// to: email.bounced, email.complained. The event carries the Resend email id,
// which we stored as sends.esp_message_id (and followups.esp_message_id).
//
// Effects: sends.status + bounced_at/complained_at, channels.status
// ('bounced' | 'complained', both excluded from every candidate query), and a
// complaint also lands in `unsubscribes` so no vertical ever mails them again.
//
// Svix signature verification without the svix dependency (same as the
// clipzi app): signed_content = "{svix-id}.{svix-timestamp}.{body}",
// HMAC-SHA256 with the base64 part of the whsec_ secret.
// Env: RESEND_WEBHOOK_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { channels, sends, followups, unsubscribes } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifySvix(body: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  return signature.split(" ").some((part) => {
    const sig = part.split(",")[1];
    if (!sig) return false;
    try {
      return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!verifySvix(body, request.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type?: string; data?: { email_id?: string; to?: string[] | string } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = event.type;
  if (type !== "email.bounced" && type !== "email.complained") {
    return NextResponse.json({ ok: true, ignored: type ?? null });
  }
  const espId = event.data?.email_id;
  const toList = Array.isArray(event.data?.to) ? event.data?.to : event.data?.to ? [event.data.to] : [];
  const status = type === "email.bounced" ? "bounced" : "complained";
  const now = new Date();

  try {
    // Resolve the send: by Resend id on the original, then on a follow-up,
    // then by recipient address (older sends predate esp ids in some paths).
    let sendRow: { id: string; email: string; channelId: string } | null = null;
    if (espId) {
      const [bySend] = await db
        .select({ id: sends.id, email: sends.email, channelId: sends.channelId })
        .from(sends)
        .where(eq(sends.espMessageId, espId))
        .limit(1);
      sendRow = bySend ?? null;
      if (!sendRow) {
        const [byFollowup] = await db
          .select({ id: sends.id, email: sends.email, channelId: sends.channelId })
          .from(followups)
          .innerJoin(sends, eq(sends.id, followups.sendId))
          .where(eq(followups.espMessageId, espId))
          .limit(1);
        sendRow = byFollowup ?? null;
      }
    }
    if (!sendRow && toList.length > 0) {
      const [byEmail] = await db
        .select({ id: sends.id, email: sends.email, channelId: sends.channelId })
        .from(sends)
        .where(sql`lower(${sends.email}) = ${toList[0].toLowerCase()}`)
        .limit(1);
      sendRow = byEmail ?? null;
    }

    if (sendRow) {
      await db
        .update(sends)
        .set(status === "bounced" ? { status: "bounced", bouncedAt: now } : { status: "complained", complainedAt: now })
        .where(eq(sends.id, sendRow.id));
      await db
        .update(channels)
        .set({ status, updatedAt: now })
        .where(eq(channels.id, sendRow.channelId));
    }

    // A complaint is a permanent opt-out for the address, whatever the vertical.
    const email = (sendRow?.email ?? toList[0] ?? "").toLowerCase();
    if (status === "complained" && email) {
      await db
        .insert(unsubscribes)
        .values({ email, channelId: sendRow?.channelId ?? null, reason: "spam complaint", source: "resend-webhook" })
        .onConflictDoNothing();
    }

    console.log(`[resend-webhook] ${type} email_id=${espId ?? "?"} to=${email || "?"} matched=${Boolean(sendRow)}`);
    return NextResponse.json({ ok: true, matched: Boolean(sendRow), status });
  } catch (e) {
    console.error("[resend-webhook] failed:", e);
    // 500 makes Resend retry, which is what we want for a transient DB error.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
