// Middleware-based auth for the dashboard.
// Free alternative to Vercel's "Advanced Deployment Protection" ($150/mo).
//
// Scope: protects /dashboard/* only. Cron API routes are NOT touched by this
// middleware (they have their own CRON_SECRET auth at the route level).
// Public pages like / stay public.
//
// Auth model:
//   - Cookie value = sha256(ADMIN_PASSWORD) (so the password itself never sits
//     in the cookie store, and changing the env password instantly invalidates
//     all existing sessions).
//   - HttpOnly + Secure + SameSite=Lax. 30-day TTL.
//   - Constant-time comparison.

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "clipzi_dash_auth";

let cachedExpectedHash: string | null = null;

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function expectedHash(): Promise<string | null> {
  if (cachedExpectedHash !== null) return cachedExpectedHash;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const hash = await sha256Hex(password);
  cachedExpectedHash = hash;
  return hash;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  const expected = await expectedHash();

  // If ADMIN_PASSWORD isn't set, fail closed: redirect to /login with a
  // visible error. This is safer than silently allowing access.
  if (!expected) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "no_password_set");
    return NextResponse.redirect(url);
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie && timingSafeEqual(cookie, expected)) {
    return NextResponse.next();
  }

  const url = new URL("/login", req.url);
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*"],
};
