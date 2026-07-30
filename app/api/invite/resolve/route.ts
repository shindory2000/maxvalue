import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") || "").trim();
  if (!code) return NextResponse.json({ inviter: null });
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const { data: seeker } = await supabase
    .from("seeker_profiles")
    .select("user_id,nickname,photo_1_url,invite_code")
    .eq("invite_code", code)
    .maybeSingle();
  if (seeker?.user_id) {
    return NextResponse.json({ inviter: { id: seeker.user_id, name: seeker.nickname || "紹介者", photo_url: seeker.photo_1_url || null, code: seeker.invite_code, type: "seeker" } });
  }

  const { data: users } = await supabase.from("users").select("id,line_name,line_picture_url,bubble_raw");
  const matches = (users || []).filter(user => {
    const profile = (((user.bubble_raw || {}) as Record<string, unknown>).ambassador_profile || {}) as Record<string, unknown>;
    return String(profile.invite_code || "") === code;
  });
  if (matches.length === 1) {
    const user = matches[0];
    const profile = (((user.bubble_raw || {}) as Record<string, unknown>).ambassador_profile || {}) as Record<string, unknown>;
    return NextResponse.json({ inviter: { id: user.id, name: String(profile.name || user.line_name || "紹介者"), photo_url: String(profile.photo_url || user.line_picture_url || "") || null, code, type: "ambassador" } });
  }
  return NextResponse.json({ inviter: null });
}
