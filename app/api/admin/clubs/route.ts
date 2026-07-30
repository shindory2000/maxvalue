import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, stringArray } from "@/lib/admin";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const editableColumns = new Set([
  "display_name",
  "search_name",
  "kana_name",
  "region",
  "area",
  "business_type",
  "store_code",
  "appeal_text",
  "logo_url",
  "instagram_url",
]);
const editableProfileKeys = new Set([
  "permission_code", "trial_perks", "hiring_perks", "wage_range", "backs", "deductions",
  "payday", "daily_pay", "business_hours", "closed_days", "min_weekly_shifts", "ride_fee",
  "ride_area", "customer_base", "average_customer_spend", "store_scale", "average_cast_age",
  "cast_count", "outfit", "required_id", "address",
]);

function normalizeUpdates(updates: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (editableColumns.has(key)) result[key] = value === "" ? null : value;
  }
  if (updates.interior_photo_urls !== undefined) result.interior_photo_urls = stringArray(updates.interior_photo_urls);
  if (result.display_name && !result.search_name) result.search_name = result.display_name;
  result.updated_at = new Date().toISOString();
  return result;
}

function normalizeProfileUpdates(extra: Record<string, unknown>) {
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!editableProfileKeys.has(key)) continue;
    const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    result[key] = normalized || null;
  }
  return result;
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const [{ data: clubs, error }, { data: staffRows }, { data: offers }] = await Promise.all([
    supabase.from("clubs").select("*").order("display_name"),
    supabase.from("club_staffs").select("club_id"),
    supabase.from("offers").select("club_id"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const staffCounts = new Map<string, number>();
  for (const row of staffRows || []) staffCounts.set(row.club_id, (staffCounts.get(row.club_id) || 0) + 1);
  const offerCounts = new Map<string, number>();
  for (const row of offers || []) offerCounts.set(row.club_id, (offerCounts.get(row.club_id) || 0) + 1);

  return NextResponse.json((clubs || []).map(club => ({
    ...club,
    permission_code: (club.profile as Record<string, unknown> | null)?.permission_code || null,
    staff_count: staffCounts.get(club.id) || 0,
    offer_count: offerCounts.get(club.id) || 0,
  })));
}

export async function PATCH(request: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const body = await request.json();
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    const lineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
    const { data: user } = lineUserId
      ? await supabase.from("users").select("id,role").eq("line_user_id", lineUserId).maybeSingle()
      : { data: null };
    const { data: staff } = user?.id
      ? await supabase.from("club_staffs").select("club_id,is_active").eq("user_id", user.id).maybeSingle()
      : { data: null };
    if (user?.role !== "club_staff" || staff?.is_active === false || String(staff?.club_id || "") !== id) {
      return unauthorized;
    }
  }

  const { data: current, error: currentError } = await supabase
    .from("clubs")
    .select("profile")
    .eq("id", id)
    .maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });

  const profile = {
    ...((current?.profile || {}) as Record<string, unknown>),
    ...normalizeProfileUpdates((body.extra || {}) as Record<string, unknown>),
  };
  const updates = { ...normalizeUpdates(body.updates || {}), profile };
  const { data, error } = await supabase
    .from("clubs")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, club: data });
}
