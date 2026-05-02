// Outreach report email — sent after each cron run that produced sends.
// Replaces the daily report the legacy GHA cron used to email at 7:47 AM.
//
// Recipient defaults to gonzaloorsi@gmail.com (override with REPORT_EMAIL).
// From address must be on a Resend-verified domain — uses REPORT_FROM_EMAIL
// or falls back to the first configured sender (already verified for outreach).

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

export interface ReportInput {
  runStartedAt: Date;
  runDurationMs: number;
  sent: number;
  failed: number;
  results: ReportSendResult[];
  // Pipeline / context
  totalDailyCapacity: number;
  queuedRemaining: number;
  totalSentAllTime: number;
  // Window info
  window: {
    bypassed: boolean;
    hours: string;
    activeCountries: number | null;
  };
  // Per-sender 24h count for sender pool visibility
  senderStats: Array<{
    email: string;
    sent24h: number;
    dailyLimit: number;
  }>;
  // What committed this code (helps debugging)
  version: string;
}

function fmtSubs(n: number | null): string {
  if (n === null || n === undefined) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReportHtml(input: ReportInput): string {
  const date = input.runStartedAt.toISOString().replace("T", " ").slice(0, 19);
  const durationS = (input.runDurationMs / 1000).toFixed(1);

  const rows = input.results
    .map((r) => {
      const statusBadge =
        r.status === "sent"
          ? `<span style="color:#0a7d2c;font-weight:600;">✓ sent</span>`
          : r.status === "sent_db_failed"
            ? `<span style="color:#b58105;font-weight:600;">⚠ DB write failed</span>`
            : `<span style="color:#b00020;font-weight:600;">✗ failed</span>`;
      const errorCell = r.error
        ? `<div style="color:#666;font-size:11px;margin-top:2px;">${escapeHtml(r.error.slice(0, 200))}</div>`
        : "";
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(r.cleanName || r.channelTitle)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmtSubs(r.subscribers)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(r.country ?? "-")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(r.language)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(r.email)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#444;font-size:11px;">${escapeHtml(r.senderEmail)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${statusBadge}${errorCell}</td>
      </tr>`;
    })
    .join("");

  const senderRows = input.senderStats
    .map(
      (s) =>
        `<tr><td style="padding:4px 8px;">${escapeHtml(s.email)}</td><td style="padding:4px 8px;text-align:right;">${s.sent24h}/${s.dailyLimit}</td></tr>`,
    )
    .join("");

  return `<div style="font-family:system-ui,-apple-system,sans-serif;color:#222;max-width:900px;">
    <h2 style="margin:0 0 4px 0;">Outreach run: ${escapeHtml(date)} UTC</h2>
    <p style="margin:0 0 16px 0;color:#666;font-size:13px;">
      Sent ${input.sent} · Failed ${input.failed} · Duration ${durationS}s · Version ${escapeHtml(input.version)}
    </p>

    <div style="display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
      <div style="background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:13px;">
        <strong>Pipeline</strong><br/>
        Queued: ${input.queuedRemaining}<br/>
        Sent all-time: ${input.totalSentAllTime}<br/>
        Daily capacity: ${input.totalDailyCapacity}
      </div>
      <div style="background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:13px;">
        <strong>Window</strong><br/>
        Hours: ${escapeHtml(input.window.hours)}${input.window.bypassed ? " (BYPASSED)" : ""}<br/>
        Active countries: ${input.window.activeCountries ?? "n/a"}
      </div>
      <div style="background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:13px;">
        <strong>Senders (24h)</strong>
        <table style="border-collapse:collapse;font-size:12px;margin-top:4px;">${senderRows}</table>
      </div>
    </div>

    ${
      input.results.length === 0
        ? `<p style="color:#888;font-style:italic;">(no per-channel results to show)</p>`
        : `<table style="border-collapse:collapse;width:100%;font-size:13px;">
            <thead>
              <tr style="background:#fafafa;text-align:left;">
                <th style="padding:8px;border-bottom:2px solid #ddd;">Channel</th>
                <th style="padding:8px;border-bottom:2px solid #ddd;text-align:right;">Subs</th>
                <th style="padding:8px;border-bottom:2px solid #ddd;text-align:center;">Country</th>
                <th style="padding:8px;border-bottom:2px solid #ddd;text-align:center;">Lang</th>
                <th style="padding:8px;border-bottom:2px solid #ddd;">Email</th>
                <th style="padding:8px;border-bottom:2px solid #ddd;">Sender</th>
                <th style="padding:8px;border-bottom:2px solid #ddd;">Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`
    }
  </div>`;
}

export async function sendOutreachReport(input: ReportInput): Promise<{
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
  const fromName = process.env.SENDER_NAME || "Clipzi Outreach Bot";

  if (!fromEmail) {
    return { ok: false, error: "no REPORT_FROM_EMAIL or SENDER_EMAIL_1 configured" };
  }

  const date = input.runStartedAt.toISOString().slice(0, 10);
  const subject = `Outreach ${date} ${input.runStartedAt
    .toISOString()
    .slice(11, 16)}Z — sent ${input.sent}, failed ${input.failed}`;

  try {
    const { data, error } = await client().emails.send({
      from: `Clipzi Outreach Bot <${fromEmail}>`,
      to: [recipient],
      replyTo: fromEmail,
      subject,
      html: buildReportHtml(input),
    });
    if (error) {
      return { ok: false, error: error.message ?? JSON.stringify(error) };
    }
    return { ok: true, messageId: data?.id };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
