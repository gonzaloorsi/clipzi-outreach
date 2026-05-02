// Logout — clears the auth cookie and redirects to /login.

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "clipzi_dash_auth";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}

// Allow GET so a plain link works as logout (no JS needed).
export const GET = POST;
