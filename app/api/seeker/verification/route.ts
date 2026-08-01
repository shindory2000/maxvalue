import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireSignedIn } from "@/lib/authz";

export const dynamic = "force-dynamic";

async function findProfile(lineUserId: string) {
  const supabase = getSupabaseServer();
  if (!supabase) return { supabase: null, profile: null };
  const { data: users } = await supabase.from("users").select("id").eq("line_user_id", lineUserId).order("created_at", { ascending: false }).limit(1);
  const user = Array.isArray(users) ? users[0] : null;
  if (!user?.id) return { supabase, profile: null };
  const { data: profiles } = await supabase.from("seeker_profiles").select("id,bubble_raw").eq("user_id", user.id).limit(1);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  return { supabase, profile };
}

export async function GET(request: NextRequest) {
  const access = await requireSignedIn(request);
  if (access.error) return access.error;
  const requested = (request.nextUrl.searchParams.get("lineUserId") || "").trim();
  const lineUserId = access.lineUserId;
  if (requested && requested !== lineUserId) return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });
  const { supabase, profile } = await findProfile(lineUserId);
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!profile) return NextResponse.json({ status: "not_submitted", video_url: null });
  const raw = (profile.bubble_raw || {}) as Record<string, unknown>;
  const verification = (raw.face_verification || {}) as Record<string, unknown>;
  return NextResponse.json({ status: String(verification.status || "not_submitted"), video_url: verification.video_url || null, submitted_at: verification.submitted_at || null });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const access = await requireSignedIn(request);
  if (access.error) return access.error;
  const lineUserId = access.lineUserId;
  if (body.lineUserId && String(body.lineUserId).trim() !== lineUserId) return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });
  const videoUrl = String(body.videoUrl || "").trim();
  if (!lineUserId || !videoUrl) return NextResponse.json({ error: "LINEユーザーと動画URLが必要です" }, { status: 400 });
  const { supabase, profile } = await findProfile(lineUserId);
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!profile) return NextResponse.json({ error: "プロフィールが見つかりません" }, { status: 404 });
  const raw = (profile.bubble_raw || {}) as Record<string, unknown>;
  const verification = { status: "pending", video_url: videoUrl, submitted_at: new Date().toISOString() };
  const { error } = await supabase.from("seeker_profiles").update({ bubble_raw: { ...raw, face_verification: verification } }).eq("id", profile.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...verification });
}
