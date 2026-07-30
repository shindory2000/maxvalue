import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const ADMIN_CODE = process.env.ADMIN_ACCESS_CODE || process.env.ADMIN_CODE || "";
export const ADMIN_SESSION_COOKIE = "maxvalue_admin_session";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function sessionSecret() {
  return process.env.LINE_CHANNEL_SECRET || ADMIN_CODE;
}

function signSession(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createAdminSessionToken(lineUserId: string) {
  if (!lineUserId || !sessionSecret()) return "";
  const payload = Buffer.from(JSON.stringify({
    lineUserId,
    expiresAt: Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE,
  })).toString("base64url");
  return `${payload}.${signSession(payload)}`;
}

export function getAdminSessionLineUserId(token = "") {
  if (!token || !sessionSecret()) return "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return "";
  const expected = signSession(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return "";
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { lineUserId?: string; expiresAt?: number };
    if (!parsed.lineUserId || Number(parsed.expiresAt || 0) <= Math.floor(Date.now() / 1000)) return "";
    return parsed.lineUserId;
  } catch {
    return "";
  }
}

export async function requireAdmin(request: NextRequest) {
  const lineUserId = request.cookies.get("maxvalue_line_user_id")?.value ||
    getAdminSessionLineUserId(request.cookies.get(ADMIN_SESSION_COOKIE)?.value || "");
  const supabase = getSupabaseServer();
  if (!lineUserId || !supabase) {
    return NextResponse.json({ error: "admin authorization required" }, { status: 401 });
  }
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  const user = Array.isArray(data) ? data[0] : null;
  const raw = (user?.bubble_raw || {}) as Record<string, unknown>;
  const extra = (raw.admin_extra || {}) as Record<string, unknown>;
  const effectiveRole = String(extra.effective_role || user?.role || "");
  if (!user || user.is_deleted || user.deleted_at || effectiveRole !== "admin") {
    return NextResponse.json({ error: "admin authorization required" }, { status: 403 });
  }
  return null;
}

export function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
  if (typeof value === "string") return value.split(/\n|,/).map(item => item.trim()).filter(Boolean);
  return [];
}
