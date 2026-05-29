// One-time script: obtains a Gmail API refresh token via the OAuth loopback flow.
//
//   node scripts/gmail-get-refresh-token.mjs
//
// Reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from .env.local, opens the browser
// for consent, captures the code on localhost, and writes GMAIL_REFRESH_TOKEN
// straight into .env.local. Scope: gmail.modify (covers read + labels + inserting
// the Sent-folder mirror copy). Sending replies still goes through Resend.

import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";

const envPath = new URL("../.env.local", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const CLIENT_ID = env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = env.GMAIL_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Faltan GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET en .env.local");
  process.exit(1);
}

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"].join(" ");

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    res.end("Error: " + error + ". Volvé a la terminal.");
    console.error("\nAuth cancelada/erróneo:", error);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.end("Esperando el código de Google...");
    return;
  }
  res.end("Listo. Podés cerrar esta pestaña y volver a la terminal.");
  server.close();

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const tok = await r.json();
  if (tok.refresh_token) {
    // Write straight into .env.local so the secret never hits stdout/chat.
    let contents = readFileSync(envPath, "utf8");
    const line = `GMAIL_REFRESH_TOKEN=${tok.refresh_token}`;
    if (/^GMAIL_REFRESH_TOKEN=.*$/m.test(contents)) {
      contents = contents.replace(/^GMAIL_REFRESH_TOKEN=.*$/m, line);
    } else {
      contents = contents.replace(/\n*$/, "\n") + line + "\n";
    }
    writeFileSync(envPath, contents);
    const t = tok.refresh_token;
    const masked = `${t.slice(0, 6)}...${t.slice(-4)} (${t.length} chars)`;
    console.log(`\n✅ GMAIL_REFRESH_TOKEN guardado en .env.local: ${masked}\n`);
  } else {
    console.error("\nNo llegó refresh_token. Respuesta de Google:", tok);
    console.error(
      "Si dice invalid_grant o falta refresh_token, revocá el acceso en " +
        "https://myaccount.google.com/permissions y volvé a correr el script.",
    );
  }
  process.exit(tok.refresh_token ? 0 : 1);
});

server.listen(PORT, () => {
  console.log("\nAbriendo el navegador para autorizar. Si no abre solo, pegá este URL:\n");
  console.log(authUrl + "\n");
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${opener} "${authUrl}"`);
});
