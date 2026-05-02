// Login endpoint. Accepts POST with form-encoded `password` field.
// On success: sets HttpOnly cookie and redirects to ?next=... (default /dashboard).
// On failure: redirects back to /login with ?error=invalid.

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "clipzi_dash_auth";

export const runtime = "edge";

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = String(formData.get("password") ?? "");
  const nextRaw = String(formData.get("next") ?? "/dashboard");

  // Only allow same-origin paths as `next` to prevent open redirect.
  const safeNext = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/dashboard";

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || password !== expected) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "invalid");
    if (safeNext !== "/dashboard") url.searchParams.set("next", safeNext);
    return NextResponse.redirect(url, 303);
  }

  const hash = await sha256Hex(expected);
  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  res.cookies.set(COOKIE_NAME, hash, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
