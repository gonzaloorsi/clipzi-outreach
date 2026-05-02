// Email sending helpers. Single English template for now — language detection
// + multi-template comes when we wire up Pilar 3 (LLM personalization).
//
// The template is deliberately short and to-the-point: short subject, plain
// HTML, one CTA. At cold-outreach scale, anything longer triggers spam filters
// and gets ignored.

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

export interface SendEmailParams {
  to: string;
  channelName: string;
  fromEmail: string;
  fromName: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export function buildEmail(params: SendEmailParams): {
  subject: string;
  html: string;
} {
  const subject = `${params.channelName} x Clipzi`;
  const html = `<p>Hi ${escape(params.channelName)} team,</p>
<p>I run Clipzi (<a href="https://clipzi.app">clipzi.app</a>) — we turn long-form videos into clips ready for TikTok, Reels and Shorts. Upload the video, the AI finds the best moments, and you fine-tune in a visual editor.</p>
<p>We give 2 free clips per month so you can try the flow. Paid plans for higher volume.</p>
<p>If it sounds useful for ${escape(params.channelName)}, happy to set you up with extra credit.</p>
<p>${escape(params.fromName)}<br/>Co-founder &amp; CEO, Clipzi</p>`;
  return { subject, html };
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { subject, html } = buildEmail(params);
  try {
    const { data, error } = await client().emails.send({
      from: `${params.fromName} <${params.fromEmail}>`,
      to: [params.to],
      subject,
      html,
    });
    if (error) {
      return { ok: false, error: error.message ?? JSON.stringify(error) };
    }
    return { ok: true, messageId: data?.id };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
