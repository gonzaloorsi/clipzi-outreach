// Linkbuilding follow-up cron — runs hourly. Sends ONE bump to linkbuilding
// contacts whose original outreach got no reply after 3-10 days. Research
// basis: a single follow-up lifts total replies by ~65% (roughly 40% of all
// replies come from bumps); more than one bump raises complaint risk on the
// sender fleet, so the followups.send_id UNIQUE constraint caps it at one.
//
// Candidates: sends joined to linkbuilding channels, status=sent, sentAt in
// [now-10d, now-3d], no reply/bounce/complaint, no prior followup row.
// Respects the same recipient-timezone window as the send cron. Bumps are sent
// from the SAME alias with subject "re: {original}" so they thread visually
// and the lead-replies agent still matches them (subject contains "x Clipzi").
//
// Note: bumps do NOT insert into sends (sends.email is UNIQUE), so they don't
// count toward per-inbox daily caps. DAILY_BUMP_CAP keeps total bump volume
// small; the slight per-inbox overshoot is accepted.
//
// Query params for testing:
//   ?dry=1     → list candidates, send nothing
//   ?max=3     → limit bumps this run

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db/client";
import { followups } from "@/db/schema";
import { activeCountries, parseSendWindow } from "@/lib/timezone";
import type { SupportedLanguage } from "@/lib/templates";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DAILY_BUMP_CAP = 60;
const PER_RUN_CAP = 8;
const SEND_DELAY_MS = 200;
const MIN_AGE_DAYS = 3;
const MAX_AGE_DAYS = 10;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

// One-liner bump per language, Gonza voice, no em/en dashes.
// Each bump must stand on its own: if the original landed in spam or went
// unread, a context-free "bumping this" reads as gibberish and draws confused
// replies or spam marks (real case: SaaS Argentina, Aug 2026).
const BUMP_BODY: Record<SupportedLanguage, (fromName: string) => string> = {
  en: (n) => `Quick bump in case this got buried: I wrote about mentioning Clipzi (our AI clip tool) on your site, with free full access in exchange. Happy to send the access and the blurb whenever.\n\n${n}`,
  es: (n) => `Te reflote esto por si quedó enterrado: te había escrito por una mención de Clipzi (nuestra herramienta de clips con IA) en tu sitio, con acceso completo gratis a cambio. Cuando quieras te mando el acceso y el blurb.\n\n${n}`,
  pt: (n) => `Só reforçando caso tenha ficado enterrado: escrevi sobre mencionar o Clipzi (nossa ferramenta de clips com IA) no seu site, com acesso completo grátis em troca. Quando quiser, envio o acesso e o blurb.\n\n${n}`,
  de: (n) => `Kurzer Reminder, falls das untergegangen ist: ich hatte wegen einer Erwähnung von Clipzi (unserem KI-Clip-Tool) auf eurer Seite geschrieben, mit kostenlosem Vollzugang als Gegenleistung. Ich schicke euch gern jederzeit den Zugang und den Blurb.\n\n${n}`,
  fr: (n) => `Petit rappel au cas où ce message serait passé inaperçu : je vous avais écrit au sujet d'une mention de Clipzi (notre outil de clips IA) sur votre site, avec un accès complet gratuit en échange. Je peux vous envoyer l'accès et le descriptif quand vous voulez.\n\n${n}`,
};

interface CandidateRow {
  send_id: string;
  email: string;
  language: string | null;
  clean_name: string | null;
  title: string;
  country: string | null;
  sender_email: string | null;
  sent_at: string;
  rfc_message_id: string | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const max = Math.min(PER_RUN_CAP, Number(url.searchParams.get("max")) || PER_RUN_CAP);
  const fromName = process.env.SENDER_NAME;
  const log = (msg: string) =>
    console.log(`[linkbuilding-followup ${new Date().toISOString()}]`, msg);

  if (!fromName || !process.env.RESEND_API_KEY) {
    if (!dryRun) {
      return NextResponse.json(
        { ok: false, error: "SENDER_NAME or RESEND_API_KEY not set" },
        { status: 500 },
      );
    }
  }

  try {
    // Daily cap check first (cheap).
    const capResult = await db.execute<{ cnt: number } & Record<string, unknown>>(sql`
      SELECT COUNT(*)::int AS cnt FROM followups WHERE sent_at > NOW() - INTERVAL '24 hours'
    `);
    const sentLast24h = ((capResult.rows ?? capResult)[0]?.cnt as number) ?? 0;
    if (sentLast24h >= DAILY_BUMP_CAP) {
      return NextResponse.json({ ok: true, skipped: true, reason: "daily_bump_cap", sentLast24h });
    }
    const budget = Math.min(max, DAILY_BUMP_CAP - sentLast24h);

    // Timezone gate: same window as the send cron. null-country rows pass.
    const window = parseSendWindow(process.env.SEND_WINDOW_HOURS);
    const active = activeCountries(window);
    const countryList =
      active.length > 0
        ? sql`(c.country IN (${sql.join(active.map((x) => sql`${x}`), sql`, `)}) OR c.country IS NULL)`
        : sql`c.country IS NULL`;

    const result = await db.execute<CandidateRow & Record<string, unknown>>(sql`
      SELECT
        s.id AS send_id,
        s.email,
        s.language,
        c.clean_name,
        c.title,
        c.country,
        sen.email AS sender_email,
        s.sent_at,
        s.rfc_message_id
      FROM sends s
      JOIN channels c ON c.id = s.channel_id
      LEFT JOIN senders sen ON sen.id = s.sender_id
      WHERE c.discovered_via LIKE 'sonar:linkbuilding-%'
        AND s.status = 'sent'
        AND s.sent_at < NOW() - INTERVAL '${sql.raw(String(MIN_AGE_DAYS))} days'
        AND s.sent_at > NOW() - INTERVAL '${sql.raw(String(MAX_AGE_DAYS))} days'
        AND s.replied_at IS NULL
        AND s.bounced_at IS NULL
        AND s.complained_at IS NULL
        AND s.email NOT IN (SELECT email FROM unsubscribes)
        AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.send_id = s.id)
        AND ${countryList}
      ORDER BY s.sent_at ASC
      LIMIT ${budget}
    `);
    const candidates = (result.rows ?? result) as CandidateRow[];

    log(`candidates: ${candidates.length} (budget ${budget}, sent last 24h ${sentLast24h}, active countries ${active.length})`);

    if (dryRun || candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        dry: dryRun,
        sentLast24h,
        candidates: candidates.map((cd) => ({
          email: cd.email,
          name: cd.clean_name || cd.title,
          country: cd.country,
          language: cd.language,
          sender: cd.sender_email,
          originalSentAt: cd.sent_at,
        })),
      });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    let sent = 0;
    let failed = 0;
    const results: Array<{ email: string; ok: boolean; error?: string }> = [];

    for (const cd of candidates) {
      const alias = cd.sender_email;
      if (!alias) {
        failed++;
        results.push({ email: cd.email, ok: false, error: "no sender alias on original send" });
        continue;
      }
      const name = cd.clean_name || cd.title;
      const lang = (["en", "es", "pt", "de", "fr"].includes(cd.language ?? "")
        ? cd.language
        : "en") as SupportedLanguage;
      // Original subject was `${name} x Clipzi` lowercased by the send path.
      const subject = `re: ${name.toLowerCase()} x clipzi`;
      const body = BUMP_BODY[lang](fromName!);

      try {
        const { data, error } = await resend.emails.send({
          from: `${fromName} <${alias}>`,
          to: [cd.email],
          subject,
          text: body,
          // Thread the bump under the original email. Older sends predate
          // rfc_message_id; those go unthreaded (the bump copy self-explains).
          ...(cd.rfc_message_id
            ? { headers: { "In-Reply-To": cd.rfc_message_id, References: cd.rfc_message_id } }
            : {}),
        });
        if (error) {
          failed++;
          results.push({ email: cd.email, ok: false, error: error.message ?? String(error) });
        } else {
          await db.insert(followups).values({
            sendId: cd.send_id,
            espMessageId: data?.id ?? null,
          }).onConflictDoNothing();
          sent++;
          results.push({ email: cd.email, ok: true });
        }
      } catch (e) {
        failed++;
        results.push({ email: cd.email, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }

    log(`done: ${sent} sent, ${failed} failed`);
    return NextResponse.json({ ok: true, sent, failed, sentLast24h: sentLast24h + sent, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
