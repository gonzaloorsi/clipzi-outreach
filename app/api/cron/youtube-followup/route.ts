// YouTube v2 follow-up cron — two touches after a v2 cold email that got no
// reply, in the same thread, from the same alias:
//   bump  (day 4 to 10):  restates the hook in one line and repeats the ask.
//   close (day 10 to 20): the break-up line. Taking the offer away is the
//                         single best-performing email of any sequence.
// followups (send_id, kind) UNIQUE caps the sequence at exactly two touches.
// Mirrors linkbuilding-followup: same alias, "re: {subject}", In-Reply-To
// threading, recipient-timezone window, no sends row (so no per-inbox cap).
//
// Query params for testing:
//   ?dry=1     → list candidates, send nothing
//   ?max=5     → limit touches this run
//   ?kind=bump|close → only that touch

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db/client";
import { followups } from "@/db/schema";
import { activeCountries, parseSendWindow } from "@/lib/timezone";
import { formatMmss } from "@/lib/heatmap";
import { fetchFrameAttachment } from "@/lib/frames";
import { filterOutSignedUp } from "@/lib/clipzi-accounts";
import { pickTemplate, type HotInput } from "@/lib/templates";
import { isRoleAddress, signatureFor, usesVoseo } from "@/lib/templates/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DAILY_CAP = 150;
const PER_RUN_CAP = 15;
const SEND_DELAY_MS = 200;
const BUMP_MIN_DAYS = 4;
const BUMP_MAX_DAYS = 10;
const CLOSE_MIN_DAYS = 10;
const CLOSE_MAX_DAYS = 20;
// The clipzi checkout applies the 50% first-month coupon to any address that
// got a v2 email in the last OFFER_DAYS (clipzi lib/billing/outreach-discount.ts).
// The close quotes the same deadline: sent_at + OFFER_DAYS. Keep both in sync.
const OFFER_DAYS = 21;
const offerExpiryDate = (sentAt: Date) => new Date(sentAt.getTime() + OFFER_DAYS * 86_400_000);

type Lang = "es" | "en" | "pt";
type Kind = "bump" | "close";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

interface Row {
  send_id: string;
  email: string;
  language: string | null;
  template_id: string | null;
  channel_id: string;
  clean_name: string | null;
  title: string;
  country: string | null;
  channel_language: string | null;
  discovered_via: string | null;
  sender_email: string | null;
  sent_at: string;
  rfc_message_id: string | null;
  hot_source: string | null;
  hot_video_id: string | null;
  hot_video_title: string | null;
  hot_start_s: number | null;
  hot_start_2_s: number | null;
  hot_label: string | null;
  hot_per_month: number | null;
  hot_avg_minutes: number | null;
}

// The first email's subject, rebuilt with the same builder and the same channel
// data, so the follow-up threads under it in Gmail ("re: minuto 14:29"). A
// different subject can split the conversation and lose the inherited tab.
function originalSubject(r: Row, fromName: string): string {
  const hot: HotInput | null = r.hot_source && r.hot_video_title && ["heatmap", "top_comment", "cadence"].includes(r.hot_source)
    ? {
        source: r.hot_source as HotInput["source"],
        videoTitle: r.hot_video_title,
        mmss: r.hot_start_s != null ? formatMmss(r.hot_start_s) : null,
        mmss2: r.hot_start_2_s != null ? formatMmss(r.hot_start_2_s) : null,
        label: r.hot_label,
        perMonth: r.hot_per_month,
        avgMinutes: r.hot_avg_minutes,
      }
    : null;
  const { builder } = pickTemplate({ id: r.channel_id, country: r.country, language: r.channel_language, discoveredVia: r.discovered_via, hotSource: hot?.source ?? null });
  const { subject } = builder({ channelName: r.clean_name || r.title, fromName, toEmail: r.email, country: r.country, ...(hot ? { hot } : {}) });
  return subject.toLowerCase();
}

// Every touch must stand alone: if the original went to spam, a context-free
// "bumping this" draws confused replies (real case, Aug 2026).
function bodyFor(kind: Kind, lang: Lang, r: Row, firstName: string): string {
  const plural = isRoleAddress(r.email);
  const vos = usesVoseo(r.country);
  const hasHot = r.hot_source === "heatmap" && r.hot_start_s != null && r.hot_video_title;
  const mmss = hasHot ? formatMmss(r.hot_start_s!) : null;
  const title = r.hot_video_title ?? "";

  // Natural register, same as the first email: it is free, the creator does
  // it alone in five minutes. The close names the 50% first month (applied by
  // the clipzi checkout to this address) and its deadline.
  const sig = `${firstName}\nClipzi`;
  const hasGrant = true;
  const deadline = offerExpiryDate(new Date(r.sent_at));
  const fmtDate = (loc: string) => deadline.toLocaleDateString(loc, { day: "numeric", month: "long" });
  if (lang === "es") {
    const llegaste = plural ? "Llegaron" : vos ? "Llegaste" : "Llegaste";
    const tenes = plural ? "tienen" : vos ? "tenés" : "tienes";
    const queres = plural ? "quieren" : vos ? "querés" : "quieres";
    const teLes = plural ? "les" : "te";
    if (kind === "bump") {
      const hook = hasHot ? `¿${llegaste} a ver el ${mmss} de "${title}"?` : `¿${llegaste} a probarlo?`;
      return `${hook} Sigue gratis en clipzi.app: cinco minutos y ${tenes} ${hasHot ? "ese short" : "los shorts"}.\n\n${sig}`;
    }
    const until = hasGrant ? ` Con este mail el primer mes de Starter ${teLes} queda a mitad de precio hasta el ${fmtDate("es-AR")}, ya aplicado.` : "";
    return `Cierro el hilo.${until} Si algún día ${queres} cortar ${hasHot ? "ese minuto" : "un video largo"} en vertical con subtítulos, clipzi.app.\n\n${sig}`;
  }
  if (lang === "pt") {
    if (kind === "bump") {
      const hook = hasHot ? `Chegou a ver o ${mmss} de "${title}"?` : `Chegou a testar?`;
      return `${hook} Continua grátis em clipzi.app: cinco minutos e você tem ${hasHot ? "esse short" : "os shorts"}.\n\n${sig}`;
    }
    const until = hasGrant ? ` Com este e-mail o primeiro mês do Starter fica pela metade do preço até ${fmtDate("pt-BR")}, já aplicado.` : "";
    return `Encerro por aqui.${until} Se um dia quiser cortar ${hasHot ? "esse minuto" : "um vídeo longo"} na vertical com legendas, clipzi.app.\n\n${sig}`;
  }
  if (kind === "bump") {
    const hook = hasHot ? `Did you get to see ${mmss} in "${title}"?` : `Did you get to try it?`;
    return `${hook} Still free at clipzi.app: five minutes and you have ${hasHot ? "that short" : "the shorts"}.\n\n${sig}`;
  }
  const until = hasGrant ? ` With this email your first month of Starter is half price until ${fmtDate("en-US")}, already applied.` : "";
  return `Closing the thread.${until} If you ever want ${hasHot ? "that minute" : "a long video"} cut vertical with captions, clipzi.app.\n\n${sig}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const max = Math.min(PER_RUN_CAP, Number(url.searchParams.get("max")) || PER_RUN_CAP);
  const kindFilter = url.searchParams.get("kind") as Kind | null;
  const fromName = process.env.SENDER_NAME;
  const firstName = signatureFor(fromName ?? "Gonza");
  const log = (msg: string) => console.log(`[youtube-followup ${new Date().toISOString()}]`, msg);

  if ((!fromName || !process.env.RESEND_API_KEY) && !dryRun) {
    return NextResponse.json({ ok: false, error: "SENDER_NAME or RESEND_API_KEY not set" }, { status: 500 });
  }

  try {
    const capResult = await db.execute<{ cnt: number } & Record<string, unknown>>(sql`
      SELECT COUNT(*)::int AS cnt FROM followups f
      JOIN sends s ON s.id = f.send_id
      WHERE f.sent_at > NOW() - INTERVAL '24 hours' AND s.template_id LIKE 'v2_%'
    `);
    const sentLast24h = ((capResult.rows ?? capResult)[0]?.cnt as number) ?? 0;
    if (sentLast24h >= DAILY_CAP) {
      return NextResponse.json({ ok: true, skipped: true, reason: "daily_cap", sentLast24h });
    }
    const budget = Math.min(max, DAILY_CAP - sentLast24h);

    const window = parseSendWindow(process.env.SEND_WINDOW_HOURS);
    const active = activeCountries(window);
    const countryList =
      active.length > 0
        ? sql`(c.country IN (${sql.join(active.map((x) => sql`${x}`), sql`, `)}) OR c.country IS NULL)`
        : sql`c.country IS NULL`;

    const pick = async (kind: Kind, minDays: number, maxDays: number, limit: number): Promise<Array<Row & { kind: Kind }>> => {
      if (limit <= 0) return [];
      // A close only goes out after the bump has been sent.
      const needsBump = kind === "close"
        ? sql`AND EXISTS (SELECT 1 FROM followups fb WHERE fb.send_id = s.id AND fb.kind = 'bump')`
        : sql``;
      const result = await db.execute<Row & Record<string, unknown>>(sql`
        SELECT
          s.id AS send_id, s.email, s.language, s.template_id,
          c.id AS channel_id, c.clean_name, c.title, c.country, c.language AS channel_language, c.discovered_via,
          sen.email AS sender_email, s.sent_at, s.rfc_message_id,
          c.hot_source, c.hot_video_id, c.hot_video_title, c.hot_start_s, c.hot_start_2_s, c.hot_label, c.hot_per_month, c.hot_avg_minutes
        FROM sends s
        JOIN channels c ON c.id = s.channel_id
        LEFT JOIN senders sen ON sen.id = s.sender_id
        WHERE s.template_id LIKE 'v2_%'
          AND s.status = 'sent'
          AND s.sent_at < NOW() - INTERVAL '${sql.raw(String(minDays))} days'
          AND s.sent_at > NOW() - INTERVAL '${sql.raw(String(maxDays))} days'
          AND s.replied_at IS NULL
          AND s.bounced_at IS NULL
          AND s.complained_at IS NULL
          AND s.email NOT IN (SELECT email FROM unsubscribes)
          AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.send_id = s.id AND f.kind = ${kind})
          ${needsBump}
          AND ${countryList}
        ORDER BY s.sent_at ASC
        LIMIT ${limit}
      `);
      return ((result.rows ?? result) as Row[]).map((r) => ({ ...r, kind }));
    };

    const bumps = kindFilter === "close" ? [] : await pick("bump", BUMP_MIN_DAYS, BUMP_MAX_DAYS, budget);
    const closes = kindFilter === "bump" ? [] : await pick("close", CLOSE_MIN_DAYS, CLOSE_MAX_DAYS, budget - bumps.length);
    let candidates = [...bumps, ...closes];
    // Whoever already signed up at Clipzi is out of the cold sequence: the
    // product's own lifecycle takes over from there.
    const accounts = await filterOutSignedUp(candidates.map((r) => r.email));
    if (accounts.signedUp.length > 0) {
      const gone = new Set(accounts.signedUp.map((e) => e.toLowerCase()));
      candidates = candidates.filter((r) => !gone.has(r.email.toLowerCase()));
    }
    log(`candidates: ${bumps.length} bumps + ${closes.length} closes (budget ${budget}, last 24h ${sentLast24h}); signed up and skipped: ${accounts.signedUp.length}${accounts.checked ? "" : " (account check unavailable)"}`);

    if (dryRun || candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        dry: dryRun,
        sentLast24h,
        candidates: candidates.map((r) => ({
          kind: r.kind, email: r.email, name: r.clean_name || r.title, language: r.language,
          sender: r.sender_email, originalSentAt: r.sent_at, hot: r.hot_source,
        })),
      });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    let sent = 0;
    let failed = 0;
    const results: Array<{ kind: Kind; email: string; ok: boolean; error?: string }> = [];

    for (const r of candidates) {
      const alias = r.sender_email;
      if (!alias) {
        failed++;
        results.push({ kind: r.kind, email: r.email, ok: false, error: "no sender alias on original send" });
        continue;
      }
      const lang = (["es", "en", "pt"].includes(r.language ?? "") ? r.language : "en") as Lang;
      const subject = `re: ${originalSubject(r, fromName!)}`;
      const body = bodyFor(r.kind, lang, r, firstName);
      // The bump re-attaches the peak still: in-thread, from a known sender,
      // it is where the image persuades most and risks least.
      const frame = r.kind === "bump" && r.hot_source === "heatmap" && r.hot_video_id && r.hot_start_s != null
        ? await fetchFrameAttachment(r.hot_video_id, r.hot_start_s)
        : null;
      try {
        const { data, error } = await resend.emails.send({
          from: `${fromName} <${alias}>`,
          to: [r.email],
          subject,
          text: body,
          ...(frame ? { attachments: [frame] } : {}),
          ...(r.rfc_message_id
            ? { headers: { "In-Reply-To": r.rfc_message_id, References: r.rfc_message_id } }
            : {}),
        });
        if (error) {
          failed++;
          results.push({ kind: r.kind, email: r.email, ok: false, error: error.message ?? String(error) });
        } else {
          await db.insert(followups).values({ sendId: r.send_id, kind: r.kind, espMessageId: data?.id ?? null }).onConflictDoNothing();
          sent++;
          results.push({ kind: r.kind, email: r.email, ok: true });
        }
      } catch (e) {
        failed++;
        results.push({ kind: r.kind, email: r.email, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      await new Promise((res) => setTimeout(res, SEND_DELAY_MS));
    }

    log(`done: ${sent} sent, ${failed} failed`);
    return NextResponse.json({ ok: true, sent, failed, sentLast24h: sentLast24h + sent, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
