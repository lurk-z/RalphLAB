import { NextRequest, NextResponse } from "next/server";
import { projectAccess, projectCookie } from "@/lib/active-project";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new Response(null, {status: 403});
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, {status: 415});
  const data = await request.json().catch(() => null);
  if (!Number.isSafeInteger(data?.id) || data.id < 1) return new Response(null, {status: 400});
  const status = await projectAccess(data.id).catch(() => 503);
  if (status !== 200) return new Response(null, {status});
  const response = NextResponse.json({id: data.id});
  response.cookies.set(projectCookie, String(data.id), {
    httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/",
  });
  return response;
}
