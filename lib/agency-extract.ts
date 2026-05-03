// Email extraction from an agency website. Port of legacy/fetch-agencies.mjs:354
// rewritten for TypeScript and Vercel Edge runtime (uses native fetch).
//
// Strategy: try homepage first, then common contact paths until we find emails.
// Returns deduplicated, lowercased, and placeholder-filtered emails.

import { isPlaceholderEmail } from "./agency-search";

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const CONTACT_PATHS = [
  "",
  "/contacto",
  "/contact",
  "/contactanos",
  "/contact-us",
  "/about",
  "/nosotros",
  "/about-us",
];

const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 200_000; // truncate HTML to avoid spending memory on huge pages

interface FetchOnePageResult {
  ok: boolean;
  status: number;
  emails: string[];
}

async function fetchOnePage(url: string): Promise<FetchOnePageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, emails: [] };
    }
    // Read up to MAX_HTML_BYTES bytes
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return { ok: true, status: res.status, emails: extractEmailsFromText(text) };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});
    const decoder = new TextDecoder("utf-8");
    const text = chunks.map((c) => decoder.decode(c, { stream: true })).join("");
    return { ok: true, status: res.status, emails: extractEmailsFromText(text) };
  } catch {
    return { ok: false, status: 0, emails: [] };
  } finally {
    clearTimeout(timer);
  }
}

function extractEmailsFromText(text: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  const seen = new Set<string>();
  for (const m of matches) {
    const lower = m.toLowerCase();
    // Skip false positives
    if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".webp"))
      continue;
    if (lower.includes("@2x") || lower.includes("@3x")) continue;
    if (isPlaceholderEmail(lower)) continue;
    seen.add(lower);
  }
  return [...seen];
}

export interface AgencyExtractResult {
  domain: string;
  emails: string[];
  pagesVisited: string[];
  status: "found" | "no_emails" | "fetch_failed";
}

/**
 * Try homepage + common contact paths until emails are found.
 * Stops early once any page yields ≥1 valid email.
 */
export async function fetchAgencyEmails(
  domain: string,
): Promise<AgencyExtractResult> {
  const base = `https://${domain}`;
  const visited: string[] = [];

  for (const path of CONTACT_PATHS) {
    const url = base + path;
    visited.push(url);
    const result = await fetchOnePage(url);
    if (result.emails.length > 0) {
      return { domain, emails: result.emails, pagesVisited: visited, status: "found" };
    }
    // If homepage 404'd entirely, give up — domain is probably dead
    if (path === "" && !result.ok && result.status === 0) {
      return { domain, emails: [], pagesVisited: visited, status: "fetch_failed" };
    }
  }
  return {
    domain,
    emails: [],
    pagesVisited: visited,
    status: visited.length > 0 ? "no_emails" : "fetch_failed",
  };
}
