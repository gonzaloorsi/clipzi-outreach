// Smoke test: confirms the Gmail refresh token actually reads the inbox via the
// Gmail API (not the MCP). Exchanges the refresh token for an access token, lists
// labels, and counts threads matching the outreach subject pattern.
//
//   node scripts/verify-gmail.mjs

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("No access_token: " + JSON.stringify(j));
  return j.access_token;
}

async function gapi(token, path) {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const token = await accessToken();
console.log("✅ access token OK");

const profile = await gapi(token, "profile");
console.log("✅ inbox:", profile.emailAddress, "| total msgs:", profile.messagesTotal);

const labels = await gapi(token, "labels");
console.log("✅ labels:", labels.labels.length, "encontrados");

const q = encodeURIComponent('subject:"x Clipzi" newer_than:30d');
const threads = await gapi(token, `threads?q=${q}&maxResults=100`);
console.log(`✅ hilos "x Clipzi" (30d):`, threads.threads?.length ?? 0);
