import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireSignedIn } from "@/lib/authz";

export const dynamic = "force-dynamic";

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export async function GET(request: NextRequest) {
  const access = await requireSignedIn(request);
  if (access.error) return access.error;
  const lineUserId = access.lineUserId;
  const requested = text(request.nextUrl.searchParams.get("lineUserId"));
  if (requested && requested !== lineUserId) return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });
  const supabase = access.supabase || getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: user } = await supabase.from("users").select("id,line_name,line_picture_url,bubble_raw").eq("line_user_id", lineUserId).maybeSingle();
  if (!user?.id) return NextResponse.json({ error: "user not found" }, { status: 404 });
  const raw = (user.bubble_raw || {}) as Record<string, unknown>;
  const profile = (raw.ambassador_profile || {}) as Record<string, unknown>;
  const { data: users } = await supabase.from("users").select("id,line_name,line_picture_url,bubble_raw");
  const referrals = (users || []).filter(row => String(((row.bubble_raw || {}) as Record<string, unknown>).invited_by_user_id || "") === user.id);
  const referralIds = referrals.map(row => row.id);
  const { data: seekerProfiles } = referralIds.length ? await supabase.from("seeker_profiles").select("user_id,nickname,photo_1_url,bubble_raw").in("user_id", referralIds) : { data: [] };
  const profileByUser = new Map((seekerProfiles || []).map(row => [row.user_id, row]));
  const referred = referrals.map(row => ({ id: row.id, name: profileByUser.get(row.id)?.nickname || row.line_name || "紹介ユーザー", photo_url: profileByUser.get(row.id)?.photo_1_url || row.line_picture_url || null, hired: Boolean((((profileByUser.get(row.id)?.bubble_raw || {}) as Record<string, unknown>).hired)) }));
  return NextResponse.json({ id: user.id, name: profile.name || user.line_name || "", region: profile.region || "", photo_url: profile.photo_url || user.line_picture_url || "", invite_code: profile.invite_code || `AMB-${user.id.replaceAll("-", "").slice(0, 8).toUpperCase()}`, referrals: referred, referral_count: referred.length, hired_count: referred.filter(item => item.hired).length });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const access = await requireSignedIn(request);
  if (access.error) return access.error;
  const lineUserId = access.lineUserId;
  if (body.lineUserId && text(body.lineUserId) !== lineUserId) return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });
  const name = text(body.name);
  const region = text(body.region);
  const photoUrl = text(body.photoUrl);
  if (!lineUserId || !name || !region || !photoUrl) return NextResponse.json({ error: "名前・地域・顔写真は必須です" }, { status: 400 });
  const supabase = access.supabase || getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: user } = await supabase.from("users").select("id,bubble_raw").eq("line_user_id", lineUserId).maybeSingle();
  if (!user?.id) return NextResponse.json({ error: "user not found" }, { status: 404 });
  const raw = (user.bubble_raw || {}) as Record<string, unknown>;
  const extra = (raw.admin_extra || {}) as Record<string, unknown>;
  const profile = { name, region, photo_url: photoUrl, invite_code: `AMB-${user.id.replaceAll("-", "").slice(0, 8).toUpperCase()}`, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("users").update({ line_name: name, line_picture_url: photoUrl, role: "seeker", bubble_raw: { ...raw, admin_extra: { ...extra, effective_role: "ambassador" }, ambassador_profile: profile } }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, profile });
}
