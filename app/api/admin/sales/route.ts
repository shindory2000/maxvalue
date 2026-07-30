import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OfferRow = {
  id: string;
  status: "sent" | "interested" | "rejected";
  club_id: string | null;
  seeker_id: string | null;
  hourly_wage: number;
  guarantee_period: string;
  comment: string | null;
  bubble_raw: Record<string, unknown> | null;
  created_at: string;
};

type OfferResponseRow = {
  offer_id: string | null;
  response: string | null;
  line_payload: Record<string, unknown> | null;
};

type SalesVisitRow = {
  id: string;
  visit_date: string | null;
  visit_purpose: string | null;
  club_id: string | null;
  seeker_id: string | null;
  assigned_staff_name: string | null;
  budget: number | null;
  result_saved: boolean | null;
};

type SalesLeadRow = {
  id: string;
  club_id: string | null;
  name: string | null;
  age: number | null;
  rank: string | null;
  potential: string | null;
  scout_status: string | null;
  assigned_staff_name: string | null;
  next_action: string | null;
  last_contact_at: string | null;
};

type ClubLite = {
  id: string;
  display_name: string | null;
  area?: string | null;
  region?: string | null;
};

type ProfileLite = {
  id: string;
  user_id: string | null;
  nickname: string | null;
};

type UserLite = {
  id: string;
  line_name: string | null;
  role?: string | null;
};

function inc(map: Map<string, { name: string; interested: number; rejected: number; no_response: number; total: number }>, key: string, status: string) {
  const current = map.get(key) || { name: key, interested: 0, rejected: 0, no_response: 0, total: 0 };
  current.total += 1;
  if (status === "interested") current.interested += 1;
  else if (status === "rejected") current.rejected += 1;
  else current.no_response += 1;
  map.set(key, current);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asText(value: unknown) {
  return String(value || "").trim();
}

async function resolveClubId(supabase: ReturnType<typeof getSupabaseServer>, value: unknown) {
  const query = asText(value);
  if (!supabase || !query) return null;
  if (UUID_PATTERN.test(query)) return query;

  const escaped = query.replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data } = await supabase
    .from("clubs")
    .select("id")
    .or(`display_name.ilike.%${escaped}%,search_name.ilike.%${escaped}%,kana_name.ilike.%${escaped}%,store_code.ilike.%${escaped}%`)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function resolveSeekerId(supabase: ReturnType<typeof getSupabaseServer>, value: unknown) {
  const query = asText(value);
  if (!supabase || !query) return null;
  if (UUID_PATTERN.test(query)) return query;

  const escaped = query.replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data } = await supabase
    .from("seeker_profiles")
    .select("id")
    .ilike("nickname", `%${escaped}%`)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const [{ data, error }, { data: clubs }, { data: profiles }, { data: users }, visitsResult, leadsResult] = await Promise.all([
    supabase
    .from("offers")
    .select("id,status,club_id,seeker_id,hourly_wage,guarantee_period,comment,bubble_raw,created_at")
    .order("created_at", { ascending: false })
    .limit(300),
    supabase.from("clubs").select("id,display_name,area,region"),
    supabase.from("seeker_profiles").select("id,user_id,nickname"),
    supabase.from("users").select("id,line_name,role"),
    supabase.from("sales_visits").select("id,visit_date,visit_purpose,club_id,seeker_id,assigned_staff_name,budget,result_saved").order("visit_date", { ascending: false }).limit(80),
    supabase.from("sales_leads").select("id,club_id,name,age,rank,potential,scout_status,assigned_staff_name,next_action,last_contact_at").order("updated_at", { ascending: false }).limit(80),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const offerIds = ((data || []) as OfferRow[]).map(row => row.id).filter(Boolean);
  const { data: responseRows } = offerIds.length
    ? await supabase
      .from("offer_responses")
      .select("offer_id,response,line_payload")
      .in("offer_id", offerIds)
      .order("created_at", { ascending: false })
    : { data: [] };
  const responsesByOffer = new Map<string, OfferResponseRow>();
  for (const response of (responseRows || []) as OfferResponseRow[]) {
    if (response.offer_id && !responsesByOffer.has(response.offer_id)) responsesByOffer.set(response.offer_id, response);
  }

  const clubsById = new Map<string, ClubLite>(((clubs || []) as ClubLite[]).map(club => [club.id, club]));
  const profilesById = new Map<string, ProfileLite>(((profiles || []) as ProfileLite[]).map(profile => [profile.id, profile]));
  const usersById = new Map<string, UserLite>(((users || []) as UserLite[]).map(user => [user.id, user]));
  const byClub = new Map<string, { name: string; interested: number; rejected: number; no_response: number; total: number }>();
  const byUser = new Map<string, { name: string; interested: number; rejected: number; no_response: number; total: number }>();
  const totals = { interested: 0, rejected: 0, no_response: 0, total: 0 };
  const offers = ((data || []) as OfferRow[]).map(row => {
    const club = row.club_id ? clubsById.get(row.club_id) : undefined;
    const seeker = row.seeker_id ? profilesById.get(row.seeker_id) : undefined;
    const user = seeker?.user_id ? usersById.get(seeker.user_id) : undefined;
    const status = row.status === "interested" || row.status === "rejected" ? row.status : "no_response";
    const response = responsesByOffer.get(row.id);
    const payload = (response?.line_payload || {}) as Record<string, unknown>;
    const offerRaw = (row.bubble_raw || {}) as Record<string, unknown>;
    const workflow = (offerRaw.workflow || {}) as Record<string, unknown>;
    totals.total += 1;
    totals[status] += 1;
    inc(byClub, club?.display_name || "店舗未設定", status);
    inc(byUser, seeker?.nickname || user?.line_name || "ユーザー未設定", status);
    return {
      id: row.id,
      club_name: club?.display_name || "店舗未設定",
      user_name: seeker?.nickname || user?.line_name || "ユーザー未設定",
      area: club?.area || "",
      hourly_wage: row.hourly_wage,
      guarantee_period: row.guarantee_period,
      comment: row.comment,
      status,
      response_status: String(payload.response_status || "") || null,
      next_action: String(payload.next_action || "") || null,
      selected_date: String(payload.selected_date || "") || null,
      offered_hourly_wage: Number(payload.offered_hourly_wage || row.hourly_wage || 0),
      response_source: String(payload.source || "") || null,
      workflow_status: String(workflow.status || "") || null,
      outcome: (workflow.outcome || null) as Record<string, unknown> | null,
      created_at: row.created_at,
    };
  });
  const visits = ((visitsResult.data || []) as SalesVisitRow[]).map(row => {
    const club = row.club_id ? clubsById.get(row.club_id) : undefined;
    const seeker = row.seeker_id ? profilesById.get(row.seeker_id) : undefined;
    return {
      id: row.id,
      visit_date: row.visit_date || "",
      visit_purpose: row.visit_purpose || "訪問目的未設定",
      club_name: club?.display_name || "店舗未設定",
      seeker_name: seeker?.nickname || null,
      assigned_staff_name: row.assigned_staff_name || "担当未設定",
      budget: row.budget || 0,
      result_saved: Boolean(row.result_saved),
    };
  });
  const leads = ((leadsResult.data || []) as SalesLeadRow[]).map(row => {
    const club = row.club_id ? clubsById.get(row.club_id) : undefined;
    return {
      id: row.id,
      club_name: club?.display_name || "在籍店未設定",
      name: row.name || "名前未設定",
      age: row.age || null,
      rank: row.rank || null,
      potential: row.potential || null,
      scout_status: row.scout_status || null,
      assigned_staff_name: row.assigned_staff_name || null,
      next_action: row.next_action || null,
      last_contact_at: row.last_contact_at || null,
    };
  });
  const clubOptions = ((clubs || []) as ClubLite[])
    .filter(club => club.id)
    .map(club => ({ id: club.id, name: club.display_name || "店舗名未設定" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const seekerOptions = ((profiles || []) as ProfileLite[])
    .filter(profile => profile.id)
    .map(profile => {
      const user = profile.user_id ? usersById.get(profile.user_id) : undefined;
      return { id: profile.id, name: profile.nickname || user?.line_name || "名前未設定" };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const adminStaffOptions = ((users || []) as UserLite[])
    .filter(user => user.role === "admin" || user.role === "club_staff")
    .map(user => ({ id: user.id, name: user.line_name || "スタッフ名未設定" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return NextResponse.json({
    totals,
    by_club: Array.from(byClub.values()).sort((a, b) => b.total - a.total),
    by_user: Array.from(byUser.values()).sort((a, b) => b.total - a.total),
    offers,
    visits,
    leads,
    unlinked_visit_count: visits.filter(visit => !visit.seeker_name).length,
    clubs: clubOptions,
    seekers: seekerOptions,
    admin_staff: adminStaffOptions,
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const kind = String(body.kind || "");

  if (kind === "visit") {
    const clubId = await resolveClubId(supabase, body.clubId);
    const seekerId = await resolveSeekerId(supabase, body.seekerId);
    const leadName = asText(body.leadName);
    const { data, error } = await supabase.from("sales_visits").insert({
      visit_purpose: String(body.visitPurpose || ""),
      club_id: clubId,
      seeker_id: seekerId,
      budget: Number(body.budget || 0),
      assigned_staff_name: String(body.assignedStaffName || ""),
      companion_staff_name: String(body.companionStaffName || "") || null,
      visit_date: String(body.visitDate || "") || null,
      memo: String(body.memo || ""),
      created_by: "admin",
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!seekerId && leadName) {
      await supabase.from("sales_leads").insert({
        club_id: clubId,
        seeker_id: null,
        name: leadName,
        assigned_staff_name: String(body.assignedStaffName || ""),
        next_action: "ユーザー未紐付け",
        last_contact_at: String(body.visitDate || "") || new Date().toISOString(),
        bubble_raw: { source: "sales_visit", sales_visit_id: data?.id, memo: String(body.memo || "") },
      });
    }
    return NextResponse.json({ ok: true, id: data?.id });
  }

  if (kind === "result") {
    const visitId = String(body.visitId || "") || null;
    const people = Array.isArray(body.people) ? body.people : [];
    const { data: result, error } = await supabase.from("sales_visit_results").insert({
      sales_visit_id: visitId,
      expected_hires: Number(body.expectedHires || 0),
      actual_cost: Number(body.actualCost || 0),
      is_free_new_sales: Boolean(body.isFreeNewSales),
      follow_up_enabled: Boolean(body.followUpEnabled),
      receipt_url: String(body.receiptUrl || "") || null,
      created_by: "admin",
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (visitId) {
      await supabase.from("sales_visits").update({ result_saved: true }).eq("id", visitId);
    }

    const rows = await Promise.all(people
      .filter((person: Record<string, unknown>) => String(person.name || "").trim())
      .map(async (person: Record<string, unknown>) => ({
        sales_visit_result_id: result?.id,
        club_id: await resolveClubId(supabase, person.clubId),
        seeker_id: await resolveSeekerId(supabase, person.seekerId),
        name: String(person.name || ""),
        age: person.age ? Number(person.age) : null,
        scout_status: String(person.scoutStatus || ""),
        rank: String(person.rank || ""),
        vision: String(person.vision || ""),
        potential: String(person.potential || ""),
        next_action: String(person.nextAction || ""),
        offer_club_id: await resolveClubId(supabase, person.offerClubId),
        guarantee_period: String(person.guaranteePeriod || ""),
        memo: String(person.memo || ""),
        created_by: "admin",
      })));

    if (rows.length) {
      const { error: peopleError } = await supabase.from("sales_result_people").insert(rows);
      if (peopleError) return NextResponse.json({ error: peopleError.message }, { status: 500 });
      await supabase.from("sales_leads").insert(rows.map(row => ({
        club_id: row.club_id,
        seeker_id: row.seeker_id,
        name: row.name,
        age: row.age,
        rank: row.rank,
        potential: row.potential,
        scout_status: row.scout_status,
        assigned_staff_name: String(body.assignedStaffName || ""),
        next_action: row.next_action,
        last_contact_at: new Date().toISOString(),
        bubble_raw: { source: "sales_result", sales_visit_result_id: result?.id },
      })));
    }

    return NextResponse.json({ ok: true, id: result?.id, people: rows.length });
  }

  return NextResponse.json({ error: "Unsupported sales operation" }, { status: 400 });
}
