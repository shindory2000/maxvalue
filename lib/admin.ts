import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const ADMIN_CODE = process.env.ADMIN_ACCESS_CODE || process.env.ADMIN_CODE || "";

export async function requireAdmin(request: NextRequest) {
  const lineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
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
