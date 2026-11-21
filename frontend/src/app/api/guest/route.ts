import { randomUUID } from "node:crypto";
import { decode, encode } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { createBackendAuthToken } from "@/lib/backend-auth-token";

const cookieName = "ralphguard-guest";
const guestMaxAge = 365 * 24 * 60 * 60;

export async function POST(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ detail: "Guest sessions are not configured" }, { status: 503 });
  }

  const token = request.cookies.get(cookieName)?.value;
  const guestSecret = `${secret}:ralphguard-guest`;
  const guest = token ? await decode({ token, secret: guestSecret }).catch(() => null) : null;
  const guestId = guest?.sub ?? `guest:${randomUUID()}`;
  const response = NextResponse.json(
    { backendToken: createBackendAuthToken(guestId) },
    { headers: { "Cache-Control": "no-store" } },
  );

  if (!guest?.sub) {
    response.cookies.set(cookieName, await encode({ token: { sub: guestId }, secret: guestSecret, maxAge: guestMaxAge }), {
      httpOnly: true,
      sameSite: "strict",
      secure: request.nextUrl.protocol === "https:",
      path: "/api/guest",
      maxAge: guestMaxAge,
    });
  }

  return response;
}
