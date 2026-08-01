import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { buildAdminMessageFlexMessage, sendLinePushMessage } from "@/lib/line";

export const dynamic = "force-dynamic";

type SupabaseServer = NonNullable<ReturnType<typeof getSupabaseServer>>;

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

function inviteCodeFor(userId: string) {
  return `MV-${userId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function buildValidationErrors(body: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const age = Number(body.age);
  if (!asString(body.lineUserId)) errors.lineUserId = "LINEユーザーIDが見つかりません";
  if (!asString(body.nickname)) errors.nickname = "ニックネームを入力してください";
  if (!Number.isFinite(age) || age < 19 || age > 35) errors.age = "年齢を選択してください";
  if (!asString(body.workExperience)) errors.workExperience = "ナイトワーク経験を選択してください";
  if (!asString(body.desiredRegion)) errors.desiredRegion = "希望地域を選択してください";
  if (!asString(body.desiredArea)) errors.desiredArea = "希望エリアを選択してください";
  if (!asString(body.desiredShift)) errors.desiredShift = "希望シフトを選択してください";
  if (!asString(body.startTiming)) errors.startTiming = "勤務開始予定を選択してください";
  if (!asString(body.currentHourlyRange)) errors.currentHourlyRange = "現在時給を選択してください";
  if (!asString(body.currentMonthlySalesRange)) errors.currentMonthlySalesRange = "現在月売を選択してください";
  if (!asString(body.photo1Url)) errors.photo1 = "1枚目のプロフィール写真を登録してください";
  return errors;
}

async function findUserByLineId(supabase: SupabaseServer, lineUserId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id,role,line_user_id,line_name,line_picture_url,bubble_raw")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`users lookup failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : null;
}

async function ensureUser(supabase: SupabaseServer, body: Record<string, unknown>) {
  const lineUserId = asString(body.lineUserId);
  const nickname = asString(body.nickname) || "LINEユーザー";
  const existing = await findUserByLineId(supabase, lineUserId);
  const role = existing?.role === "admin" || existing?.role === "club_staff" ? existing.role : "seeker";
  const payload = {
    line_user_id: lineUserId,
    line_name: asString(body.lineDisplayName) || existing?.line_name || nickname,
    line_picture_url: asString(body.linePictureUrl) || existing?.line_picture_url || null,
    role,
    last_login_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from("users")
      .update(payload)
      .eq("id", existing.id)
      .select("id,role,line_user_id,bubble_raw")
      .single();
    if (error) throw new Error(`users update failed: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase
    .from("users")
    .insert(payload)
    .select("id,role,line_user_id,bubble_raw")
    .single();
  if (error) throw new Error(`users insert failed: ${error.message}`);
  return data;
}

async function findProfileByUserId(supabase: SupabaseServer, userId: string) {
  const { data, error } = await supabase
    .from("seeker_profiles")
    .select("id,invite_code,bubble_raw")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw new Error(`seeker profile lookup failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : null;
}

async function grantInitialTickets(supabase: SupabaseServer, userId: string) {
  const { data: existingTickets } = await supabase
    .from("gacha_tickets")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (Array.isArray(existingTickets) && existingTickets.length) return;

  const { error } = await supabase.from("gacha_tickets").insert(
    { user_id: userId, ticket_type: "registration_invite", source: "registration" },
  );
  if (error) throw new Error(`initial ticket grant failed: ${error.message}`);
}

async function applyReferral(supabase: SupabaseServer, user: Record<string, unknown>, referralCode: string) {
  if (!referralCode || !user.id) return { rank: "", inviterId: "" };
  const { data: seekerInviterProfile } = await supabase
    .from("seeker_profiles")
    .select("user_id")
    .eq("invite_code", referralCode)
    .maybeSingle();
  let inviterUserId = seekerInviterProfile?.user_id || "";
  if (!inviterUserId) {
    const { data: possibleAmbassadors } = await supabase.from("users").select("id,bubble_raw");
    const matches = (possibleAmbassadors || []).filter(candidate => {
      const raw = (candidate.bubble_raw || {}) as Record<string, unknown>;
      const profile = (raw.ambassador_profile || {}) as Record<string, unknown>;
      return String(profile.invite_code || "") === referralCode;
    });
    if (matches.length === 1) inviterUserId = matches[0].id;
  }
  if (!inviterUserId || inviterUserId === user.id) return { rank: "", inviterId: "" };

  const { data: inviter } = await supabase
    .from("users")
    .select("id,bubble_raw")
    .eq("id", inviterUserId)
    .maybeSingle();
  const inviterRaw = (inviter?.bubble_raw || {}) as Record<string, unknown>;
  const inviterExtra = (inviterRaw.admin_extra || {}) as Record<string, unknown>;
  const rank = String(inviterExtra.rank || "A");
  const currentRaw = (user.bubble_raw || {}) as Record<string, unknown>;
  await supabase.from("users").update({
    bubble_raw: {
      ...currentRaw,
      invited_by_user_id: inviterUserId,
      referral_code: referralCode,
      admin_extra: { ...((currentRaw.admin_extra || {}) as Record<string, unknown>), rank, rank_review_required: true },
    },
  }).eq("id", user.id);

  const { data: reward } = await supabase
    .from("gacha_tickets")
    .select("id")
    .eq("user_id", inviterUserId)
    .eq("source", `referral:${String(user.id)}`)
    .limit(1);
  if (!Array.isArray(reward) || !reward.length) {
    await supabase.from("gacha_tickets").insert({
      user_id: inviterUserId,
      ticket_type: "registration_invite",
      source: `referral:${String(user.id)}`,
    });
  }
  return { rank, inviterId: String(inviterUserId) };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const authenticatedLineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
  if (!authenticatedLineUserId) {
    return NextResponse.json({ error: "LINEログインが必要です" }, { status: 401 });
  }
  if (asString(body.lineUserId) !== authenticatedLineUserId) {
    return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });
  }

  const errors = buildValidationErrors(body);
  if (Object.keys(errors).length) {
    return NextResponse.json({ error: "必須項目が未入力です", errors }, { status: 400 });
  }

  try {
    const user = await ensureUser(supabase, body);
    if (!user?.id) throw new Error("users save did not return id");

    const existingProfile = await findProfileByUserId(supabase, user.id);
    const currentClubId = asString(body.currentClubId);
    const desiredClubIds = [...new Set(asStringArray(body.desiredClubIds))]
      .filter(id => id !== currentClubId);
    const blockedClubIds = [...new Set(asStringArray(body.blockedClubIds))]
      .filter(id => id !== currentClubId && !desiredClubIds.includes(id));
    const existingRaw = (existingProfile?.bubble_raw || {}) as Record<string, unknown>;
    const profilePayload = {
      user_id: user.id,
      nickname: asString(body.nickname),
      age: Number(body.age),
      work_experience: asString(body.workExperience),
      desired_region: asString(body.desiredRegion),
      desired_area: asString(body.desiredArea),
      desired_shift: asString(body.desiredShift),
      start_timing: asString(body.startTiming),
      current_region: null,
      current_area: null,
      current_club_id: currentClubId || null,
      blocked_club_ids: blockedClubIds,
      current_hourly_range: asString(body.currentHourlyRange) || null,
      current_monthly_sales_range: asString(body.currentMonthlySalesRange) || null,
      photo_1_url: asString(body.photo1Url),
      photo_2_url: asString(body.photo2Url) || null,
      full_body_photo_url: asString(body.photo3Url) || null,
      setup_completed: true,
      bubble_raw: {
        ...existingRaw,
        full_name: "",
        desired_club_ids: desiredClubIds,
        profile_updated_at: new Date().toISOString(),
        rank_review_required: true,
      },
      updated_at: new Date().toISOString(),
    };

    if (existingProfile?.id) {
      const { error } = await supabase
        .from("seeker_profiles")
        .update(profilePayload)
        .eq("id", existingProfile.id);
      if (error) throw new Error(`seeker profile update failed: ${error.message}`);
    } else {
      const { error } = await supabase
        .from("seeker_profiles")
        .insert({
          ...profilePayload,
          invite_code: inviteCodeFor(user.id),
        });
      if (error) throw new Error(`seeker profile insert failed: ${error.message}`);
      const referral = await applyReferral(supabase, user as Record<string, unknown>, asString(body.referralCode));
      await sendLinePushMessage(asString(body.lineUserId), [buildAdminMessageFlexMessage({
        title: "ご登録ありがとうございます",
        message: "ご登録情報によって、届くオファーやご案内できるサービスが異なります。写真や勤務状況などに変化があった際は、プロフィールを随時更新してください。",
      })]).catch(error => console.warn("[seeker-profile] welcome LINE skipped", error instanceof Error ? error.message : error));
    }

    // Backfill users whose first registration completed while ticket creation failed.
    // The helper is idempotent and never grants more than one initial ticket.
    await grantInitialTickets(supabase, user.id);

    return NextResponse.json({ ok: true, userId: user.id, profileId: existingProfile?.id || null, ticketGranted: !existingProfile?.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[seeker-profile] save failed", {
      message,
      lineUserId: asString(body.lineUserId),
      hasPhoto1: Boolean(asString(body.photo1Url)),
    });
    return NextResponse.json({ error: "プロフィール保存に失敗しました", detail: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const lineUserId = asString(request.nextUrl.searchParams.get("lineUserId"));
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!lineUserId) return NextResponse.json({ error: "lineUserId is required" }, { status: 400 });
  const authenticatedLineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
  if (!authenticatedLineUserId) return NextResponse.json({ error: "LINEログインが必要です" }, { status: 401 });
  if (lineUserId !== authenticatedLineUserId) return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });
  const { data: userRows } = await supabase.from("users").select("id").eq("line_user_id", lineUserId).order("created_at", { ascending: false }).limit(1);
  const user = Array.isArray(userRows) ? userRows[0] : null;
  if (!user?.id) return NextResponse.json({ error: "profile not found" }, { status: 404 });
  const { data: profileRows, error } = await supabase.from("seeker_profiles").select("*").eq("user_id", user.id).limit(1);
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!profile) return NextResponse.json({ error: "profile not found" }, { status: 404 });
  const raw = (profile.bubble_raw || {}) as Record<string, unknown>;
  const blockedClubIds = asStringArray(profile.blocked_club_ids);
  const clubIds = [asString(profile.current_club_id), ...blockedClubIds].filter(Boolean);
  const { data: clubs } = clubIds.length
    ? await supabase.from("clubs").select("id,display_name").in("id", clubIds)
    : { data: [] as { id: string; display_name: string }[] };
  const clubNames = new Map((clubs || []).map(club => [club.id, club.display_name]));
  return NextResponse.json({
    ...profile,
    full_name: String(raw.full_name || ""),
    desired_club_ids: asStringArray(raw.desired_club_ids),
    current_club: clubNames.get(asString(profile.current_club_id)) || null,
    blocked_clubs: blockedClubIds.map(id => clubNames.get(id)).filter(Boolean),
  });
}
