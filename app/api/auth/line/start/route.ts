import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildLineAuthorizeUrl, getLineConfig, isLineLoginConfigured } from "@/lib/line";

export const dynamic = "force-dynamic";

const validRoles = new Set(["seeker", "club_staff", "ambassador", "admin"]);

export async function GET(request: NextRequest) {
  if (!isLineLoginConfigured()) {
    return NextResponse.json(
      { error: "LINE Login is not configured yet." },
      { status: 503 },
    );
  }

  const state = randomBytes(32).toString("hex");
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/?screen=offers";
  const role = request.nextUrl.searchParams.get("role") || "seeker";
  const clubCode = request.nextUrl.searchParams.get("clubCode") || "";
  const referralCode = request.nextUrl.searchParams.get("ref") || "";
  const configuredRedirectUri = getLineConfig().redirectUri;
  const redirectUri = process.env.LINE_REDIRECT_URI || (process.env.NEXT_PUBLIC_APP_URL ? configuredRedirectUri : `${request.nextUrl.origin}/api/auth/line/callback`);
  if (role === "admin" && !request.cookies.get("maxvalue_admin_pending")?.value) {
    return NextResponse.json({ error: "管理コードの確認が必要です。" }, { status: 403 });
  }
  const response = NextResponse.redirect(buildLineAuthorizeUrl(state, redirectUri));
  response.cookies.set("line_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  response.cookies.set("line_return_to", returnTo, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  response.cookies.set("line_login_role", validRoles.has(role) ? role : "seeker", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  if (clubCode) {
    response.cookies.set("line_club_code", clubCode, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
  }
  if (referralCode && role === "seeker") {
    response.cookies.set("line_referral_code", referralCode, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
  }
  response.cookies.set("line_redirect_uri", redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return response;
}
