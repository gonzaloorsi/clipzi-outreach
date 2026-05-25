// Daily outreach digest — one email per day summarizing the last 24h of sends.
// Fired by /api/cron/daily-report (Vercel Cron at 00:00 UTC = 21:00 ART).
//
// Replaces the old per-tick report that emailed after every hourly send run.
// The send cron still runs hourly and sends outreach; it just no longer emails.
//
// Recipient defaults to gonzaloorsi@gmail.com (override with REPORT_EMAIL).
// From address must be on a Resend-verified domain — uses REPORT_FROM_EMAIL
// or falls back to the first configured sender (already verified for outreach).
//
// Style: no em-dashes (—) or en-dashes (–) anywhere, per the project email rule.

import { Resend } from "resend";

let _client: Resend | null = null;
function client(): Resend {
  if (!_client) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set");
    }
    _client = new Resend(process.env.RESEND_API_KEY);
  }
  return _client;
}

// Per-send result shape — still used by the send cron to type its HTTP-response
// `results` array. The daily digest builds its own rows from the DB instead.
export interface ReportSendResult {
  channelId: string;
  channelTitle: string;
  cleanName: string | null;
  email: string;
  senderEmail: string;
  language: string;
  country: string | null;
  subscribers: number | null;
  score: number | null;
  status: "sent" | "failed" | "sent_db_failed";
  messageId?: string;
  error?: string;
}

// ─── Daily digest ──────────────────────────────────────────────────────────

export interface DailyDigestRow {
  status: string; // 'sent' | 'failed'
  email: string;
  senderEmail: string | null;
  language: string | null;
  country: string | null;
  subscribers: number | null;
  channelName: string;
  kind: string; // creator | agency | standup-individual | standup-org | media-org
  error: string | null;
  sentAt: string | null;
}

export interface DailyDigestInput {
  generatedAt: Date;
  windowHours: number;
  rows: DailyDigestRow[];
  pipeline: {
    queuedSendable: number;
    totalSentAllTime: number;
    totalDailyCapacity: number;
  };
  senderStats: Array<{ email: string; sent24h: number; dailyLimit: number }>;
  version: string;
}

const REPORT_TZ = "America/Argentina/Buenos_Aires";

function fmtInTz(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: REPORT_TZ, ...opts }).format(d);
}

const KIND_LABEL: Record<string, string> = {
  creator: "Creadores",
  agency: "Agencias",
  "standup-individual": "Standup (individuos)",
  "standup-org": "Standup (orgs)",
  "media-org": "Medios",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countBy<T>(items: T[], key: (t: T) => string): Array<{ key: string; cnt: number }> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([key, cnt]) => ({ key, cnt }))
    .sort((a, b) => b.cnt - a.cnt);
}

function buildDailyDigestHtml(input: DailyDigestInput): string {
  const dateLabel = fmtInTz(input.generatedAt, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeLabel = fmtInTz(input.generatedAt, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const sentRows = input.rows.filter((r) => r.status === "sent");
  const failedRows = input.rows.filter((r) => r.status === "failed");
  const sent = sentRows.length;
  const failed = failedRows.length;

  // Per-vertical: sent + failed counts
  const verticalKinds = [...new Set(input.rows.map((r) => r.kind))];
  const byVertical = verticalKinds
    .map((kind) => ({
      kind,
      sent: sentRows.filter((r) => r.kind === kind).length,
      failed: failedRows.filter((r) => r.kind === kind).length,
    }))
    .sort((a, b) => b.sent - a.sent);

  const byLanguage = countBy(sentRows, (r) => r.language || "?");
  const byCountry = countBy(sentRows, (r) => r.country || "(null)").slice(0, 15);

  const verticalCards = byVertical
    .map(
      (v) => `<div style="background:#f5f5f5;padding:8px 12px;border-radius:6px;font-size:13px;min-width:120px;">
        <strong>${escapeHtml(KIND_LABEL[v.kind] ?? v.kind)}</strong><br/>
        ${v.sent} enviados${v.failed > 0 ? `, ${v.failed} fallidos` : ""}
      </div>`,
    )
    .join("");

  const langChips = byLanguage
    .map((l) => `<span style="display:inline-block;background:#eef;padding:2px 8px;border-radius:4px;margin:2px;font-size:12px;">${escapeHtml(l.key)}: ${l.cnt}</span>`)
    .join("");

  const countryChips = byCountry
    .map((cc) => `<span style="display:inline-block;background:#efe;padding:2px 8px;border-radius:4px;margin:2px;font-size:12px;">${escapeHtml(cc.key)}: ${cc.cnt}</span>`)
    .join("");

  const senderRows = input.senderStats
    .map(
      (s) =>
        `<tr><td style="padding:4px 8px;">${escapeHtml(s.email)}</td><td style="padding:4px 8px;text-align:right;">${s.sent24h}/${s.dailyLimit}</td></tr>`,
    )
    .join("");

  const failuresBlock =
    failedRows.length === 0
      ? `<p style="color:#0a7d2c;font-size:13px;">Sin fallos en la ventana. 👌</p>`
      : `<table style="border-collapse:collapse;width:100%;font-size:13px;">
          <thead><tr style="background:#fff4f4;text-align:left;">
            <th style="padding:8px;border-bottom:2px solid #f0caca;">Contacto</th>
            <th style="padding:8px;border-bottom:2px solid #f0caca;">Email</th>
            <th style="padding:8px;border-bottom:2px solid #f0caca;">Sender</th>
            <th style="padding:8px;border-bottom:2px solid #f0caca;">Error</th>
          </tr></thead>
          <tbody>${failedRows
            .map(
              (r) => `<tr>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(r.channelName)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(r.email)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#444;font-size:11px;">${escapeHtml(r.senderEmail ?? "-")}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#b00020;font-size:11px;">${escapeHtml((r.error ?? "").slice(0, 200))}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>`;

  return `<div style="font-family:system-ui,-apple-system,sans-serif;color:#222;max-width:900px;">
    <h2 style="margin:0 0 4px 0;">Resumen del día · ${escapeHtml(dateLabel)}</h2>
    <p style="margin:0 0 16px 0;color:#666;font-size:13px;">
      Generado ${escapeHtml(timeLabel)} ART · ventana últimas ${input.windowHours}h · versión ${escapeHtml(input.version)}
    </p>

    <div style="display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
      <div style="background:#e8f5e9;padding:12px 18px;border-radius:6px;">
        <div style="font-size:28px;font-weight:700;line-height:1;">${sent}</div>
        <div style="font-size:12px;color:#555;">enviados</div>
      </div>
      <div style="background:${failed > 0 ? "#ffebee" : "#f5f5f5"};padding:12px 18px;border-radius:6px;">
        <div style="font-size:28px;font-weight:700;line-height:1;">${failed}</div>
        <div style="font-size:12px;color:#555;">fallidos</div>
      </div>
      <div style="background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:13px;">
        <strong>Pipeline</strong><br/>
        En cartera (queued): ${input.pipeline.queuedSendable}<br/>
        Enviados histórico: ${input.pipeline.totalSentAllTime}<br/>
        Capacidad diaria: ${input.pipeline.totalDailyCapacity}
      </div>
      <div style="background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:13px;">
        <strong>Senders (24h)</strong>
        <table style="border-collapse:collapse;font-size:12px;margin-top:4px;">${senderRows}</table>
      </div>
    </div>

    <h3 style="margin:0 0 6px 0;font-size:14px;">Por vertical</h3>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">${verticalCards || '<span style="color:#888;">-</span>'}</div>

    <h3 style="margin:0 0 6px 0;font-size:14px;">Por idioma</h3>
    <div style="margin-bottom:12px;">${langChips || '<span style="color:#888;">-</span>'}</div>

    <h3 style="margin:0 0 6px 0;font-size:14px;">Por país</h3>
    <div style="margin-bottom:18px;">${countryChips || '<span style="color:#888;">-</span>'}</div>

    <h3 style="margin:0 0 6px 0;font-size:14px;">Fallos</h3>
    <div style="margin-bottom:18px;">${failuresBlock}</div>
  </div>`;
}

export async function sendDailyDigest(input: DailyDigestInput): Promise<{
  ok: boolean;
  messageId?: string;
  error?: string;
}> {
  const recipient = process.env.REPORT_EMAIL || "gonzaloorsi@gmail.com";
  const fromEmail =
    process.env.REPORT_FROM_EMAIL ||
    process.env.SENDER_EMAIL_1 ||
    process.env.SENDER_EMAIL ||
    "";

  if (!fromEmail) {
    return { ok: false, error: "no REPORT_FROM_EMAIL or SENDER_EMAIL_1 configured" };
  }

  const sent = input.rows.filter((r) => r.status === "sent").length;
  const failed = input.rows.filter((r) => r.status === "failed").length;
  const dateLabel = fmtInTz(input.generatedAt, {
    day: "2-digit",
    month: "2-digit",
  });
  const subject = `Clipzi · resumen del día ${dateLabel}: ${sent} enviados, ${failed} fallidos`;

  try {
    const { data, error } = await client().emails.send({
      from: `Clipzi Outreach Bot <${fromEmail}>`,
      to: [recipient],
      replyTo: fromEmail,
      subject,
      html: buildDailyDigestHtml(input),
    });
    if (error) {
      return { ok: false, error: error.message ?? JSON.stringify(error) };
    }
    return { ok: true, messageId: data?.id };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
