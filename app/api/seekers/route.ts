import { NextRequest, NextResponse } from "next/server";
import { extractBubbleLineUserId } from "@/lib/bubble-line";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireClubAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";

function isLastCallCast(...sources: unknown[]) {
  const matches = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(matches);
    if (!value || typeof value !== "object") return /last\s*call|ラストコール/i.test(String(value || ""));
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
      /last[_\s-]*call|lastcall|ラストコール|出演/i.test(key) && ![false, "false", "", 0, null, undefined].includes(nested as never)
        ? true
        : matches(nested),
    );
  };
  return sources.some(matches);
}

type LooseRow = Record<string, any>;

function isDeletedUser(user: LooseRow | undefined) {
  const raw = (user?.bubble_raw || {}) as LooseRow;
  return Boolean(user?.is_deleted || user?.deleted_at || raw?.admin_deleted?.is_deleted);
}

export async function GET(request: NextRequest) {
  const access = await requireClubAccess(request, request.nextUrl.searchParams.get("clubId") || "");
  if (access.error) return access.error;
  const supabase = access.supabase || getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const selectedClubId = access.clubId;

  const [
    { data: profiles, error: profileError },
    usersResult,
    { data: clubs },
    { data: offers },
    { data: responses },
  ] = await Promise.all([
    supabase.from("seeker_profiles").select("*").order("created_at", { ascending: false }),
    supabase.from("users").select("*"),
    supabase.from("clubs").select("id,display_name,logo_url"),
    supabase
      .from("offers")
      .select("id,seeker_id,club_id,hourly_wage,guarantee_period,comment,status,created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("offer_responses")
      .select("id,offer_id,response,line_payload,created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  const users = usersResult.data;

  const usersById = new Map((users || []).map(user => [user.id, user as LooseRow]));
  const clubsById = new Map((clubs || []).map(club => [club.id, club as LooseRow]));
  const responsesByOffer = new Map<string, LooseRow>();
  for (const response of responses || []) {
    if (response.offer_id && !responsesByOffer.has(String(response.offer_id))) {
      responsesByOffer.set(String(response.offer_id), response as LooseRow);
    }
  }
  const offersBySeeker = new Map<string, LooseRow[]>();
  for (const offer of offers || []) {
    if (!offer.seeker_id) continue;
    if (selectedClubId && offer.club_id !== selectedClubId) continue;
    const club = offer.club_id ? clubsById.get(offer.club_id) : null;
    const response = responsesByOffer.get(String(offer.id));
    const payload = (response?.line_payload || {}) as LooseRow;
    const responseValue = String(response?.response || offer.status || "");
    const list = offersBySeeker.get(offer.seeker_id) || [];
    list.push({
      id: offer.id,
      club_id: offer.club_id || null,
      club_name: club?.display_name || "",
      club_logo_url: club?.logo_url || null,
      created_at: offer.created_at,
      hourly_wage: offer.hourly_wage || 0,
      guarantee_period: offer.guarantee_period || "",
      comment: offer.comment || null,
      status: responseValue === "interested" || responseValue === "rejected" ? responseValue : "no_response",
      response_status: payload.response_status || null,
      next_action: payload.next_action || null,
      selected_date: payload.selected_date || null,
      offered_hourly_wage: Number(payload.offered_hourly_wage || offer.hourly_wage || 0),
      response_source: payload.source || null,
    });
    offersBySeeker.set(offer.seeker_id, list);
  }

  const restoreTargets: { id: string; line_user_id: string }[] = [];
  const rows = (profiles || []).flatMap(profile => {
    const user = usersById.get(profile.user_id);
    if (!user || isDeletedUser(user)) return [];
    if (selectedClubId && Array.isArray(profile.blocked_club_ids) && profile.blocked_club_ids.includes(selectedClubId)) return [];

    const restoredLineUserId =
      String(user.line_user_id || "") ||
      extractBubbleLineUserId(user.bubble_raw) ||
      extractBubbleLineUserId(profile.bubble_raw) ||
      "";

    if (!user.line_user_id && restoredLineUserId) {
      restoreTargets.push({ id: String(user.id), line_user_id: restoredLineUserId });
    }

    return [{
      id: profile.id,
      user_id: profile.user_id,
      line_user_id: restoredLineUserId || null,
      line_picture_url: user.line_picture_url || null,
      nickname: profile.nickname || user.line_name || "求職者",
      age: Number(profile.age || 0),
      region: profile.desired_region || "未設定",
      area: profile.desired_area || "未設定",
      experience: profile.work_experience || "未設定",
      desired_shift: profile.desired_shift || "未設定",
      start_timing: profile.start_timing || "未設定",
      photo_1_url: profile.photo_1_url || null,
      photo_2_url: profile.photo_2_url || null,
      full_body_photo_url: profile.full_body_photo_url || null,
      created_at: profile.created_at,
      offer_count: (offersBySeeker.get(profile.id) || []).length,
      last_call_cast: isLastCallCast(user.bubble_raw, profile.bubble_raw),
      past_offers: offersBySeeker.get(profile.id) || [],
    }];
  });

  if (restoreTargets.length) {
    await Promise.all(restoreTargets.slice(0, 100).map(item =>
      supabase.from("users").update({ line_user_id: item.line_user_id }).eq("id", item.id).then(() => null),
    ));
  }

  return NextResponse.json(rows);
}
