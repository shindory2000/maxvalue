import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function findProfile(lineUserId: string) {
  const supabase = getSupabaseServer();
  if (!supabase) return { supabase: null, profile: null };
  const { data: user } = await supabase.from("users").select("id").eq("line_user_id", lineUserId).maybeSingle();
  if (!user?.id) return { supabase, profile: null };
  const { data: profile } = await supabase.from("seeker_profiles").select("id,bubble_raw").eq("user_id", user.id).maybeSingle();
  return { supabase, profile };
}

export async function GET(request: NextRequest) {
  const lineUserId = (request.nextUrl.searchParams.get("lineUserId") || "").trim();
  const { supabase, profile } = await findProfile(lineUserId);
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!profile) return NextResponse.json({ status: "not_submitted", video_url: null });
  const raw = (profile.bubble_raw || {}) as Record<string, unknown>;
  const verification = (raw.face_verification || {}) as Record<string, unknown>;
  return NextResponse.json({ status: String(verification.status || "not_submitted"), video_url: verification.video_url || null, submitted_at: verification.submitted_at || null });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const lineUserId = String(body.lineUserId || "").trim();
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
