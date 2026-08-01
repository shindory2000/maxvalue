import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireClubAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";

function decodeCookie(value = "") { try { return decodeURIComponent(value); } catch { return value; } }

async function fetchOfferResponses(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  offerIds: string[],
) {
  if (!offerIds.length) return [];
  const direct = await supabase
    .from("offer_responses")
    .select("offer_id,status,response,response_status,next_action,selected_date,offered_hourly_wage,response_source,line_payload,created_at")
    .in("offer_id", offerIds)
    .order("created_at", { ascending: false });
  if (!direct.error) return direct.data || [];
  if (/status|next_action|selected_date|offered_hourly_wage|response_source/i.test(direct.error.message)) {
    const fallback = await supabase
      .from("offer_responses")
      .select("offer_id,response,line_payload,created_at")
      .in("offer_id", offerIds)
      .order("created_at", { ascending: false });
    if (fallback.error) throw fallback.error;
    return fallback.data || [];
  }
  throw direct.error;
}

export async function GET(request: NextRequest) {
  const requestedClubId = request.nextUrl.searchParams.get("clubId") || decodeCookie(request.cookies.get("maxvalue_club_id")?.value || "");
  const access = await requireClubAccess(request, requestedClubId);
  if (access.error) return access.error;
  const supabase = access.supabase || getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const clubId = access.clubId;
  if (!clubId) return NextResponse.json([]);
  try {
    const richOffers = await supabase.from("offers").select("id,seeker_id,hourly_wage,guarantee_period,comment,status,bubble_raw,created_at,updated_at").eq("club_id", clubId).order("created_at", { ascending: false });
    const offersResult = richOffers.error && /bubble_raw|updated_at/i.test(richOffers.error.message)
      ? await supabase.from("offers").select("id,seeker_id,hourly_wage,guarantee_period,comment,status,created_at").eq("club_id", clubId).order("created_at", { ascending: false })
      : richOffers;
    if (offersResult.error) throw offersResult.error;
    const offers = offersResult.data;
    const rows = Array.isArray(offers) ? offers : [];
    const offerIds = rows.map(row => row.id);
    const seekerIds = rows.map(row => row.seeker_id).filter(Boolean);
    const [responses, { data: seekers }] = await Promise.all([
      fetchOfferResponses(supabase, offerIds),
      seekerIds.length ? supabase.from("seeker_profiles").select("id,nickname,photo_1_url").in("id", seekerIds) : Promise.resolve({ data: [] }),
    ]);
    const responseMap = new Map<string, Record<string, unknown>>();
    for (const response of responses) if (!responseMap.has(String(response.offer_id))) responseMap.set(String(response.offer_id), response as Record<string, unknown>);
    const seekerMap = new Map((Array.isArray(seekers) ? seekers : []).map(seeker => [seeker.id, seeker]));
    return NextResponse.json(rows.map(row => {
      const offerRow = row as typeof row & { bubble_raw?: Record<string, unknown> | null };
      const response = responseMap.get(row.id) || {};
      const responsePayload = (response.line_payload || {}) as Record<string, unknown>;
      const seeker = seekerMap.get(row.seeker_id) || null;
      const raw = (offerRow.bubble_raw || {}) as Record<string, unknown>;
      const workflow = (raw.workflow || {}) as Record<string, unknown>;
      const responseStatus = String(response.response_status || responsePayload.response_status || "");
      const responseValue = String(response.status || response.response || responsePayload.status || responsePayload.response || responsePayload.response_type || "");
      const derivedStatus = responseStatus === "canceled" ? "canceled" : responseStatus === "schedule_selected" ? "scheduled" : responseValue === "interested" ? "interested" : responseValue === "rejected" ? "rejected" : "";
      const status = String(derivedStatus || workflow.status || "unread");
      return {
        ...row,
        seeker_name: seeker?.nickname || "",
        seeker_photo_url: seeker?.photo_1_url || "",
        response: { ...responsePayload, ...response },
        workflow,
        workflow_status: status,
        selected_date: String(response.selected_date || responsePayload.selected_date || "") || null,
        next_action: String(response.next_action || responsePayload.next_action || "") || null,
        cancel_reason: String(responsePayload.cancel_reason || "") || null,
        options: Array.isArray(raw.options) ? raw.options : [],
      };
    }));
  } catch (error) { return NextResponse.json({ error: "出したオファーを取得できませんでした", detail: error instanceof Error ? error.message : String((error as { message?: unknown })?.message || "unknown") }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  const access = await requireClubAccess(request, decodeCookie(request.cookies.get("maxvalue_club_id")?.value || ""));
  if (access.error) return access.error;
  const supabase = access.supabase || getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const offerId = String(body.offerId || "");
  if (!offerId) return NextResponse.json({ error: "offerId is required" }, { status: 400 });
  try {
    const { data: offer, error } = await supabase.from("offers").select("bubble_raw,club_id").eq("id", offerId).single();
    if (error) throw error;
    if (String(offer?.club_id || "") !== access.clubId) return NextResponse.json({ error: "他店舗のオファーは操作できません" }, { status: 403 });
    const raw = (offer?.bubble_raw || {}) as Record<string, unknown>;
    const workflow = { ...((raw.workflow || {}) as Record<string, unknown>), status: String(body.workflowStatus || "interviewed"), outcome: body.outcome || null, store_action_required: false, updated_at: new Date().toISOString() };
    const { error: updateError } = await supabase.from("offers").update({ bubble_raw: { ...raw, workflow } }).eq("id", offerId);
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true, workflow });
  } catch (error) { return NextResponse.json({ error: "ステータスを保存できませんでした", detail: error instanceof Error ? error.message : "unknown" }, { status: 500 }); }
}
