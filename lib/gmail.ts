// Gmail API client (headless, via OAuth refresh token) — NOT the MCP.
//
// Used by the lead-reply cron to READ outreach replies and apply labels in
// gonzaloorsi@gmail.com. Sending replies goes through Resend (lib/reply-email.ts),
// so we only need read + label scopes here.
//
// Env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.
// Get the refresh token once via scripts/gmail-get-refresh-token.mjs.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

// Cache the access token across calls within a single invocation (they last ~1h).
let _token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.value;
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error("Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("Gmail token refresh failed: " + JSON.stringify(json));
  }
  _token = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return _token.value;
}

async function gapi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Gmail ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types (minimal subset of the Gmail API we use) ─────────────────────────

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string; // ms since epoch, as string
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
}

export interface GmailThread {
  id: string;
  messages: GmailMessage[];
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** List thread IDs matching a Gmail query (handles pagination up to `cap`). */
export async function searchThreadIds(query: string, cap = 200): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gapi<{
      threads?: Array<{ id: string }>;
      nextPageToken?: string;
    }>(`threads?${params}`);
    for (const t of page.threads ?? []) ids.push(t.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < cap);
  return ids.slice(0, cap);
}

export async function getThread(threadId: string): Promise<GmailThread> {
  return gapi<GmailThread>(`threads/${threadId}?format=full`);
}

// ─── Header / body helpers ──────────────────────────────────────────────────

export function header(msg: GmailMessage, name: string): string | null {
  const h = msg.payload?.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? null;
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Extract the plain-text body of a message, falling back to stripped HTML. */
export function plainTextBody(msg: GmailMessage): string {
  const walk = (part: GmailMessage["payload"]): { text?: string; html?: string } => {
    if (!part) return {};
    const out: { text?: string; html?: string } = {};
    if (part.mimeType === "text/plain" && part.body?.data) out.text = decodeB64Url(part.body.data);
    if (part.mimeType === "text/html" && part.body?.data) out.html = decodeB64Url(part.body.data);
    for (const p of part.parts ?? []) {
      const child = walk(p);
      out.text ??= child.text;
      out.html ??= child.html;
    }
    return out;
  };
  const { text, html } = walk(msg.payload);
  if (text) return text;
  if (html) {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return msg.snippet ?? "";
}

/**
 * Strip quoted reply history so the LLM only sees the lead's new message.
 * Cuts at the first "On <date> ... wrote:" / "El <date> ... escribió:" marker
 * and at leading ">" quote blocks.
 */
export function stripQuotedReply(body: string): string {
  const lines = body.split("\n");
  const cutMarkers = [
    /^On .+ wrote:/i,
    /^El .+ escribió:/i,
    /^Em .+ escreveu:/i,
    /^Le .+ a écrit\s*:/i,
    /^Am .+ schrieb .+:/i,
    /^-{3,} ?Forwarded message/i,
    /^From: .+/i, // Outlook-style quoting header
  ];
  const out: string[] = [];
  for (const line of lines) {
    if (cutMarkers.some((re) => re.test(line.trim()))) break;
    if (line.trim().startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim() || body.trim();
}

// ─── Labels ───────────────────────────────────────────────────────────────

export interface GmailLabel {
  id: string;
  name: string;
}

export async function listLabels(): Promise<GmailLabel[]> {
  const json = await gapi<{ labels?: GmailLabel[] }>("labels");
  return json.labels ?? [];
}

/** Get a label id by display name, creating it if missing. */
export async function ensureLabel(name: string): Promise<string> {
  const labels = await listLabels();
  const found = labels.find((l) => l.name === name);
  if (found) return found.id;
  const created = await gapi<GmailLabel>("labels", {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  return created.id;
}

export async function addThreadLabels(threadId: string, labelIds: string[]): Promise<void> {
  await gapi(`threads/${threadId}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: labelIds }),
  });
}

// ─── Sent mirror ─────────────────────────────────────────────────────────────

/**
 * Insert a copy of an already-sent reply (sent via Resend) into the mailbox with
 * the SENT label, threaded into `threadId`, so it shows up in Gmail's "Enviados"
 * and inline in the conversation. Requires the gmail.modify scope. This does NOT
 * send anything — Resend already delivered it; this is a local mirror for review.
 */
export async function insertToSent(rfc822: string, threadId: string): Promise<string> {
  const raw = Buffer.from(rfc822, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await gapi<{ id: string }>("messages", {
    method: "POST",
    body: JSON.stringify({ raw, threadId, labelIds: ["SENT"] }),
  });
  return res.id;
}
