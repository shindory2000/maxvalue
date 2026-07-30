import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_CODE } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!ADMIN_CODE) {
    return NextResponse.json({ error: "管理コードが設定されていません" }, { status: 503 });
  }
  if (String(body.code || "") !== ADMIN_CODE) {
    return NextResponse.json({ error: "管理コードが違います" }, { status: 401 });
  }

  const nonce = randomBytes(24).toString("hex");
  const response = NextResponse.json({
    ok: true,
    loginUrl: "/api/auth/line/start?role=admin&returnTo=%2F%3Fscreen%3DadminUsers",
  });
  response.cookies.set("maxvalue_admin_pending", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return response;
}
