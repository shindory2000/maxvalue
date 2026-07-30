import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function text(value: unknown) { return typeof value === "string" ? value : ""; }

async function fetchOfferResponses(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  offerIds: string[],
) {
  if (!offerIds.length) return [];
  const direct = await supabase
    .from("offer_responses")
    .select("offer_id,status,response,response_status,next_action,selected_date,response_source,line_payload,created_at")
    .in("offer_id", offerIds)
    .order("created_at", { ascending: false });
  if (!direct.error) return direct.data || [];

  // Production databases that have not received the scheduling migration yet
  // still keep these values in line_payload.
  if (/response_status|next_action|selected_date|response_source/i.test(direct.error.message)) {
    const fallback = await supabase
      .from("offer_responses")
      .select("offer_id,status,response,line_payload,created_at")
      .in("offer_id", offerIds)
      .order("created_at", { ascending: false });
    if (fallback.error) throw fallback.error;
    return fallback.data || [];
  }
  throw direct.error;
}

export async function GET(request: NextRequest) {
  const lineUserId = text(request.nextUrl.searchParams.get("lineUserId"));
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!lineUserId) return NextResponse.json({ error: "lineUserId is required" }, { status: 400 });
  const { data: user, error: userError } = await supabase.from("users").select("id,bubble_raw").eq("line_user_id", lineUserId).maybeSingle();
  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });
  const userRaw = (user?.bubble_raw || {}) as Record<string, unknown>;
  const adminDeleted = (userRaw.admin_deleted || {}) as Record<string, unknown>;
  if (!user?.id || userRaw.is_deleted || adminDeleted.is_deleted) return NextResponse.json([]);
  const { data: profile, error: profileError } = await supabase.from("seeker_profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  if (!profile?.id) return NextResponse.json([]);
  const { data: offers, error: offerError } = await supabase.from("offers").select("id,club_id,hourly_wage,guarantee_period,comment,status,created_at").eq("seeker_id", profile.id).order("created_at", { ascending: false });
  if (offerError) return NextResponse.json({ error: offerError.message }, { status: 500 });
  const offerIds = (offers || []).map(offer => offer.id);
  const clubIds = [...new Set((offers || []).map(offer => offer.club_id).filter(Boolean))];
  const [{ data: clubs }, responses] = await Promise.all([
    clubIds.length ? supabase.from("clubs").select("id,display_name,area,logo_url").in("id", clubIds) : Promise.resolve({ data: [] }),
    fetchOfferResponses(supabase, offerIds),
  ]);
  const clubsById = new Map((clubs || []).map(club => [club.id, club]));
  const latestResponse = new Map<string, Record<string, unknown>>();
  for (const response of responses) if (!latestResponse.has(response.offer_id)) latestResponse.set(response.offer_id, response as Record<string, unknown>);
  return NextResponse.json((offers || []).map(offer => {
    const club = clubsById.get(offer.club_id);
    const response = latestResponse.get(offer.id);
    const payload = (response?.line_payload || {}) as Record<string, unknown>;
    const rawStatus = text(response?.status || response?.response || payload.status || payload.response || payload.response_type || offer.status);
    return {
      id: offer.id, club: club?.display_name || "店舗名未設定", area: club?.area || "", wage: Number(offer.hourly_wage || 0), period: offer.guarantee_period || "", note: offer.comment || "", logo: club?.logo_url || "",
      status: rawStatus === "rejected" ? "rejected" : rawStatus === "interested" ? "interested" : "new",
      response_status: text(response?.response_status || payload.response_status) || null,
      next_action: text(response?.next_action || payload.next_action) || null,
      selected_date: text(response?.selected_date || payload.selected_date) || null,
      response_source: text(response?.response_source || payload.response_source) || null,
      cancel_reason: text(payload.cancel_reason) || null,
    };
  }));
}
