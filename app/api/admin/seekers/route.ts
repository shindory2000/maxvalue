import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, stringArray } from "@/lib/admin";
import { extractBubbleLineUserId } from "@/lib/bubble-line";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Admin seeker reads and writes intentionally share this route so role and
// profile changes are committed against one authoritative user record.

const profileColumns = new Set([
  "nickname",
  "age",
  "work_experience",
  "desired_region",
  "desired_area",
  "desired_shift",
  "start_timing",
  "current_hourly_range",
  "current_monthly_sales_range",
  "photo_1_url",
  "photo_2_url",
  "full_body_photo_url",
]);

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

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const [{ data: profiles, error }, usersResult, { data: clubs }, { data: tickets }, { data: staffRows }, { data: offers }, { data: responses }] = await Promise.all([
    supabase
      .from("seeker_profiles")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("users").select("*"),
    supabase.from("clubs").select("id,display_name,logo_url"),
    supabase.from("gacha_tickets").select("id,user_id,used_at"),
    supabase.from("club_staffs").select("user_id,club_id"),
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const users = usersResult.data;

  const clubNames = new Map((clubs || []).map(club => [club.id, club.display_name]));
  const clubsById = new Map((clubs || []).map(club => [club.id, club]));
  const usersById = new Map((users || []).map(user => [user.id, user]));
  const restoredLineUsers: { id: string; line_user_id: string }[] = [];
  const ticketCounts = new Map<string, number>();
  for (const ticket of tickets || []) {
    if (!ticket.used_at) ticketCounts.set(ticket.user_id, (ticketCounts.get(ticket.user_id) || 0) + 1);
  }
  const staffByUser = new Map<string, { club_id: string; club_name: string }>();
  for (const row of staffRows || []) {
    staffByUser.set(row.user_id, { club_id: row.club_id, club_name: String(clubNames.get(row.club_id) || "") });
  }
  const responsesByOffer = new Map<string, Record<string, unknown>>();
  for (const response of responses || []) {
    if (response.offer_id && !responsesByOffer.has(String(response.offer_id))) {
      responsesByOffer.set(String(response.offer_id), response as Record<string, unknown>);
    }
  }
  const offersBySeeker = new Map<string, Record<string, unknown>[]>();
  for (const offer of offers || []) {
    if (!offer.seeker_id) continue;
    const response = responsesByOffer.get(String(offer.id));
    const payload = ((response?.line_payload || {}) as Record<string, unknown>);
    const responseValue = String(response?.response || offer.status || "");
    const list = offersBySeeker.get(offer.seeker_id) || [];
    list.push({
      id: offer.id,
      club_id: offer.club_id || null,
      club_name: offer.club_id ? String(clubNames.get(offer.club_id) || "") : "",
      club_logo_url: offer.club_id ? ((clubsById.get(offer.club_id) as Record<string, unknown> | undefined)?.logo_url as string | null) || null : null,
      created_at: offer.created_at,
      hourly_wage: offer.hourly_wage || 0,
      guarantee_period: offer.guarantee_period || "",
      comment: offer.comment || null,
      status: responseValue === "interested" || responseValue === "rejected" ? responseValue : "no_response",
      response_status: String(payload.response_status || "") || null,
      next_action: String(payload.next_action || "") || null,
      selected_date: String(payload.selected_date || "") || null,
      offered_hourly_wage: Number(payload.offered_hourly_wage || offer.hourly_wage || 0),
      response_source: String(payload.source || "") || null,
    });
    offersBySeeker.set(offer.seeker_id, list);
  }

  const rows = (profiles || []).flatMap(profile => {
    const user = usersById.get(profile.user_id) as Record<string, unknown> | undefined;
    const userRaw = (user?.bubble_raw || {}) as Record<string, unknown>;
    const deleted = Boolean(user?.is_deleted || user?.deleted_at || (userRaw?.admin_deleted && (userRaw.admin_deleted as Record<string, unknown>).is_deleted));
    if (!user || deleted) return [];
    const userExtra = ((user?.bubble_raw as Record<string, unknown> | undefined)?.admin_extra || {}) as Record<string, unknown>;
    const effectiveRole = String(userExtra.effective_role || user?.role || "seeker");
    if (effectiveRole !== "seeker") return [];
    const profileExtra = ((profile.bubble_raw as Record<string, unknown> | undefined)?.admin_extra || {}) as Record<string, unknown>;
    const restoredLineUserId = String(user?.line_user_id || "") || extractBubbleLineUserId(userRaw) || extractBubbleLineUserId(profile.bubble_raw) || "";
    if (!user?.line_user_id && restoredLineUserId) {
      restoredLineUsers.push({ id: String(user.id), line_user_id: restoredLineUserId });
    }
    return [{
      id: profile.id,
      user_id: profile.user_id,
      line_user_id: restoredLineUserId || null,
      line_picture_url: user?.line_picture_url || null,
      role: effectiveRole,
      staff_club_id: staffByUser.get(String(user?.id))?.club_id || null,
      staff_club_name: staffByUser.get(String(user?.id))?.club_name || null,
      nickname: profile.nickname,
      age: profile.age,
      region: profile.desired_region,
      area: profile.desired_area,
      experience: profile.work_experience,
      desired_shift: profile.desired_shift,
      start_timing: profile.start_timing,
      current_club: clubNames.get(profile.current_club_id) || profileExtra.current_club || null,
      blocked_clubs: stringArray(profileExtra.blocked_clubs),
      current_hourly_range: profile.current_hourly_range,
      current_monthly_sales_range: profile.current_monthly_sales_range,
      photo_1_url: profile.photo_1_url,
      photo_2_url: profile.photo_2_url,
      full_body_photo_url: profile.full_body_photo_url,
      created_at: profile.created_at,
      gacha_ticket_count: ticketCounts.get(profile.user_id) || 0,
      rank: userExtra.rank || userRaw.rank || userRaw["ランク"] || profileExtra.rank || profileExtra["ランク"] || null,
      offer_count: (offersBySeeker.get(profile.id) || []).length,
      last_call_cast: isLastCallCast(userRaw, profile.bubble_raw, userExtra.last_call_cast, profileExtra.last_call_cast),
      past_offers: offersBySeeker.get(profile.id) || [],
    }];
  });

  if (restoredLineUsers.length) {
    await Promise.all(restoredLineUsers.slice(0, 100).map(item =>
      supabase.from("users").update({ line_user_id: item.line_user_id }).eq("id", item.id).then(() => null),
    ));
  }

  return NextResponse.json(rows);
}

export async function PATCH(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const body = await request.json();
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data: profile, error: profileError } = await supabase
    .from("seeker_profiles")
    .select("user_id,bubble_raw")
    .eq("id", id)
    .maybeSingle();
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  if (!profile?.user_id) return NextResponse.json({ error: "profile not found" }, { status: 404 });

  const updates = (body.updates || {}) as Record<string, unknown>;
  const profileUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(updates)) {
    if (profileColumns.has(key)) profileUpdate[key] = key === "age" ? Number(value) : (value === "" ? null : value);
  }

  const profileExtra = {
    ...(((profile.bubble_raw as Record<string, unknown> | null)?.admin_extra || {}) as Record<string, unknown>),
    current_club: updates.current_club || undefined,
    blocked_clubs: updates.blocked_clubs !== undefined ? stringArray(updates.blocked_clubs) : undefined,
  };
  profileUpdate.bubble_raw = { ...((profile.bubble_raw || {}) as Record<string, unknown>), admin_extra: profileExtra };

  const { error } = await supabase.from("seeker_profiles").update(profileUpdate).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (updates.rank !== undefined || updates.last_call_cast !== undefined) {
    const { data: user } = await supabase.from("users").select("bubble_raw").eq("id", profile.user_id).maybeSingle();
    const userRaw = (user?.bubble_raw || {}) as Record<string, unknown>;
    const adminExtra = { ...((userRaw.admin_extra || {}) as Record<string, unknown>) };
    if (updates.rank !== undefined) adminExtra.rank = updates.rank;
    if (updates.last_call_cast !== undefined) adminExtra.last_call_cast = String(updates.last_call_cast) === "true";
    await supabase.from("users").update({
      bubble_raw: { ...userRaw, admin_extra: adminExtra },
    }).eq("id", profile.user_id);
  }

  if (updates.line_user_id !== undefined) {
    await supabase.from("users").update({
      line_user_id: String(updates.line_user_id || "").trim() || null,
    }).eq("id", profile.user_id);
  }

  if (updates.role !== undefined) {
    const role = String(updates.role || "seeker");
    if (["seeker", "club_staff", "ambassador", "admin"].includes(role)) {
      const { data: user } = await supabase.from("users").select("bubble_raw").eq("id", profile.user_id).maybeSingle();
      const userRaw = (user?.bubble_raw || {}) as Record<string, unknown>;
      const adminExtra = (userRaw.admin_extra || {}) as Record<string, unknown>;
      await supabase.from("users").update({
        role: role === "ambassador" ? "seeker" : role,
        bubble_raw: { ...userRaw, admin_extra: { ...adminExtra, effective_role: role } },
      }).eq("id", profile.user_id);
    }
  }

  if (updates.staff_club_id !== undefined) {
    const clubId = String(updates.staff_club_id || "");
    await supabase.from("club_staffs").delete().eq("user_id", profile.user_id);
    if (clubId) {
      await supabase.from("club_staffs").insert({
        user_id: profile.user_id,
        club_id: clubId,
        staff_name: String(updates.nickname || "店舗スタッフ"),
      });
      await supabase.from("users").update({ role: "club_staff" }).eq("id", profile.user_id);
    }
  }

  if (updates.gacha_ticket_count !== undefined && Number.isFinite(Number(updates.gacha_ticket_count))) {
    const target = Math.max(0, Number(updates.gacha_ticket_count));
    const { data: currentTickets } = await supabase
      .from("gacha_tickets")
      .select("id")
      .eq("user_id", profile.user_id)
      .is("used_at", null)
      .order("created_at", { ascending: false });
    const current = currentTickets?.length || 0;
    if (target > current) {
      await supabase.from("gacha_tickets").insert(Array.from({ length: target - current }, () => ({
        user_id: profile.user_id,
        ticket_type: "registration_invite",
        source: "admin_grant",
      })));
    }
    if (target < current) {
      const ids = (currentTickets || []).slice(0, current - target).map(ticket => ticket.id);
      if (ids.length) await supabase.from("gacha_tickets").delete().in("id", ids);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || request.nextUrl.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data: profile, error: profileError } = await supabase
    .from("seeker_profiles")
    .select("id,user_id,photo_1_url,photo_2_url,full_body_photo_url")
    .eq("id", id)
    .maybeSingle();
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  if (!profile?.user_id) return NextResponse.json({ error: "profile not found" }, { status: 404 });

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("id", profile.user_id)
    .maybeSingle();
  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });
  const userRaw = (user?.bubble_raw || {}) as Record<string, unknown>;
  const userExtra = (userRaw.admin_extra || {}) as Record<string, unknown>;
  const effectiveRole = String(userExtra.effective_role || user?.role || "seeker");
  const preserveUserRecord = effectiveRole !== "seeker" || String(body.mode || "") === "reset_seeker";

  const { data: staffRows } = await supabase.from("club_staffs").select("id").eq("user_id", profile.user_id);
  const staffIds = (staffRows || []).map(row => row.id);

  try {
    for (const table of ["sales_receipts", "sales_result_people", "sales_visit_results", "sales_leads", "sales_visits"]) {
      await supabase.from(table).delete().eq("seeker_id", profile.id);
      await supabase.from(table).update({ assigned_staff_id: null }).eq("assigned_staff_id", profile.user_id);
    }
    if (staffIds.length) await supabase.from("offers").delete().in("staff_id", staffIds);
    await supabase.from("offers").delete().eq("seeker_id", profile.id);
    await supabase.from("gacha_results").delete().eq("user_id", profile.user_id);
    await supabase.from("gacha_tickets").delete().eq("user_id", profile.user_id);
    await supabase.from("seeker_profiles").update({ invited_by_user_id: null }).eq("invited_by_user_id", profile.user_id);
    await supabase.from("seeker_profiles").delete().eq("id", profile.id);

    const imagePaths = [profile.photo_1_url, profile.photo_2_url, profile.full_body_photo_url]
      .map(url => String(url || ""))
      .map(url => url.includes("/user-images/") ? decodeURIComponent(url.split("/user-images/")[1].split("?")[0]) : "")
      .filter(Boolean);
    if (imagePaths.length) await supabase.storage.from("user-images").remove(imagePaths);

    if (preserveUserRecord) {
      const nextRaw = {
        ...userRaw,
        seeker_registration_reset: {
          reset_at: new Date().toISOString(),
          previous_profile_id: profile.id,
        },
        admin_extra: {
          ...userExtra,
          effective_role: effectiveRole,
        },
      };
      const { error: resetUserError } = await supabase.from("users").update({
        bubble_raw: nextRaw,
      }).eq("id", profile.user_id);
      if (resetUserError) throw resetUserError;

      const isCurrentSession = request.cookies.get("maxvalue_line_user_id")?.value === user?.line_user_id;
      const sessionCleared = isCurrentSession && effectiveRole === "seeker";
      const response = NextResponse.json({
        ok: true,
        resetOnly: true,
        preservedRole: effectiveRole,
        deletedUserId: profile.user_id,
        sessionCleared,
      });
      if (sessionCleared) {
        ["maxvalue_role", "maxvalue_db_role", "maxvalue_club_id", "maxvalue_club_name"].forEach(name => response.cookies.delete(name));
      }
      return response;
    }

    await supabase.from("club_staffs").delete().eq("user_id", profile.user_id);
    const { error: deleteError } = await supabase.from("users").delete().eq("id", profile.user_id);
    if (deleteError) throw deleteError;
    if (user?.auth_user_id) await supabase.auth.admin.deleteUser(user.auth_user_id).catch(() => undefined);

    const sessionCleared = request.cookies.get("maxvalue_line_user_id")?.value === user?.line_user_id;
    const response = NextResponse.json({ ok: true, deletedUserId: profile.user_id, sessionCleared });
    if (sessionCleared) {
      ["maxvalue_line_user_id", "maxvalue_line_name", "maxvalue_line_display_name", "maxvalue_line_picture_url", "maxvalue_role", "maxvalue_db_role", "maxvalue_club_id", "maxvalue_club_name"].forEach(name => response.cookies.delete(name));
    }
    return response;
  } catch (error) {
    console.error("[admin-seekers] complete delete failed", {
      profileId: profile.id,
      userId: profile.user_id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "完全削除に失敗しました" }, { status: 500 });
  }
}
