import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, getAdminSessionLineUserId } from "@/lib/admin";
import { getSupabaseServer } from "@/lib/supabase/server";

export function sessionLineUserId(request: NextRequest) {
  return request.cookies.get("maxvalue_line_user_id")?.value ||
    getAdminSessionLineUserId(request.cookies.get(ADMIN_SESSION_COOKIE)?.value || "");
}

export async function getSessionUser(request: NextRequest) {
  const supabase = getSupabaseServer();
  const lineUserId = sessionLineUserId(request);
  if (!supabase || !lineUserId) return { supabase, lineUserId, user: null };
  const { data } = await supabase.from("users").select("id,role,line_user_id,bubble_raw").eq("line_user_id", lineUserId).order("created_at", { ascending: false }).limit(1);
  const user = Array.isArray(data) ? data[0] : null;
  return { supabase, lineUserId, user };
}

export function effectiveRole(user: { role?: unknown; bubble_raw?: unknown } | null) {
  const raw = (user?.bubble_raw || {}) as Record<string, unknown>;
  const extra = (raw.admin_extra || {}) as Record<string, unknown>;
  return String(extra.effective_role || user?.role || "");
}

export async function requireSignedIn(request: NextRequest) {
  const context = await getSessionUser(request);
  if (!context.supabase) return { ...context, error: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 }) };
  if (!context.user) return { ...context, error: NextResponse.json({ error: "LINEログインが必要です" }, { status: 401 }) };
  return { ...context, error: null };
}

export async function requireClubAccess(request: NextRequest, requestedClubId = "") {
  const context = await requireSignedIn(request);
  if (context.error || !context.supabase || !context.user) return { ...context, clubId: "" };
  const role = effectiveRole(context.user);
  const cookieClubId = request.cookies.get("maxvalue_club_id")?.value || "";
  if (role === "admin") {
    const clubId = requestedClubId || cookieClubId;
    if (!clubId) return { ...context, clubId: "", error: NextResponse.json({ error: "店舗を選択してください" }, { status: 400 }) };
    return { ...context, clubId, error: null };
  }
  if (role !== "club_staff") return { ...context, clubId: "", error: NextResponse.json({ error: "店舗権限が必要です" }, { status: 403 }) };
  const { data } = await context.supabase.from("club_staffs").select("club_id,is_active").eq("user_id", context.user.id).limit(1);
  const staff = Array.isArray(data) ? data[0] : null;
  if (!staff?.club_id || staff.is_active === false) return { ...context, clubId: "", error: NextResponse.json({ error: "有効な所属店舗がありません" }, { status: 403 }) };
  if (requestedClubId && requestedClubId !== staff.club_id) return { ...context, clubId: "", error: NextResponse.json({ error: "他店舗のデータは操作できません" }, { status: 403 }) };
  return { ...context, clubId: String(staff.club_id), error: null };
}
