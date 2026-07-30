import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clubId = request.nextUrl.searchParams.get("clubId") || "";
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!clubId) return NextResponse.json([]);
  const { data: profiles, error } = await supabase.from("seeker_profiles").select("id,user_id,nickname,age,desired_region,desired_area,work_experience,desired_shift,start_timing,photo_1_url,photo_2_url,full_body_photo_url,bubble_raw,created_at,users(line_picture_url)").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (profiles || []).filter(profile => {
    const raw = (profile.bubble_raw || {}) as Record<string, unknown>;
    return (Array.isArray(raw.desired_club_ids) ? raw.desired_club_ids.map(String) : []).includes(clubId);
  });
  return NextResponse.json(rows.map(profile => {
    const raw = (profile.bubble_raw || {}) as Record<string, unknown>;
    const decisions = (raw.club_interest_responses || {}) as Record<string, unknown>;
    const user = Array.isArray(profile.users) ? profile.users[0] : profile.users;
    return { id: profile.id, user_id: profile.user_id, nickname: profile.nickname, age: profile.age, region: profile.desired_region, area: profile.desired_area, experience: profile.work_experience, desired_shift: profile.desired_shift, start_timing: profile.start_timing, photo_1_url: profile.photo_1_url, photo_2_url: profile.photo_2_url, full_body_photo_url: profile.full_body_photo_url, line_picture_url: user?.line_picture_url || null, created_at: profile.created_at, interest_status: String(decisions[clubId] || "pending") };
  }));
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const seekerId = String(body.seekerId || ""); const clubId = String(body.clubId || ""); const status = String(body.status || "");
  if (!seekerId || !clubId || !["accepted", "rejected"].includes(status)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: profile, error } = await supabase.from("seeker_profiles").select("bubble_raw").eq("id", seekerId).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const raw = (profile.bubble_raw || {}) as Record<string, unknown>;
  const decisions = (raw.club_interest_responses || {}) as Record<string, unknown>;
  const { error: updateError } = await supabase.from("seeker_profiles").update({ bubble_raw: { ...raw, club_interest_responses: { ...decisions, [clubId]: status }, club_interest_updated_at: new Date().toISOString() } }).eq("id", seekerId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ ok: true, status });
}
