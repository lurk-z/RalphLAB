import { randomUUID } from "node:crypto";
import { decode, encode } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { createBackendAuthToken } from "@/lib/backend-auth-token";
import { loginEnabled } from "@/lib/login-mode";

const cookieName = "ralphguard-guest";
const maxAge = 365 * 24 * 60 * 60;

export async function POST(request: NextRequest) {
  if (loginEnabled) return new Response(null, { status: 404 });
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ detail: "Guest sessions are not configured" }, { status: 503 });
  const guestSecret = `${secret}:ralphguard-guest`;
  const cookie = request.cookies.get(cookieName)?.value;
  const guest = cookie ? await decode({ token: cookie, secret: guestSecret }).catch(() => null) : null;
  const id = guest?.sub ?? `guest:${randomUUID()}`;
  const response = NextResponse.json({ backendToken: createBackendAuthToken(id) }, { headers: { "Cache-Control": "no-store" } });
  if (!guest?.sub) {
    response.cookies.set(cookieName, await encode({ token: { sub: id }, secret: guestSecret, maxAge }), {
      httpOnly: true, sameSite: "strict", secure: request.nextUrl.protocol === "https:", path: "/api/guest", maxAge,
    });
  }
  return response;
}
