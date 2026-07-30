import { NextRequest, NextResponse } from "next/server";
import { extractBubbleLineUserId } from "@/lib/bubble-line";
import { buildOfferFlexMessage, sendLinePushMessage } from "@/lib/line";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function decodeCookie(value = "") {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const seekerId = String(body.seekerId || "");
  const lineUserIdFromBody = String(body.lineUserId || "");
  const supabase = getSupabaseServer();
  let to = lineUserIdFromBody;
  let offerId = "";
  let resolvedClubName = decodeCookie(String(body.clubName || request.cookies.get("maxvalue_club_name")?.value || ""));
  let resolvedStaffName = String(body.staffName || "");
  let resolvedClubId = decodeCookie(String(body.clubId || request.cookies.get("maxvalue_club_id")?.value || ""));
  let resolvedStaffId = String(body.staffId || "");
  let resolvedClubLogoUrl: string | null = null;
  const hourlyWage = Number(body.hourlyWage || 0);
  const guaranteePeriod = String(body.guaranteePeriod || "").trim();
  const comment = String(body.comment || "").trim();
  const options = Array.isArray(body.options) ? body.options.map((value: unknown) => String(value)).filter(Boolean) : [];

  if (!seekerId) return NextResponse.json({ ok: false, error: "seekerId is required" }, { status: 400 });
  if (!Number.isFinite(hourlyWage) || hourlyWage <= 0) return NextResponse.json({ ok: false, error: "想定時給を入力してください" }, { status: 400 });
  if (!guaranteePeriod) return NextResponse.json({ ok: false, error: "保証期間を入力してください" }, { status: 400 });
  if (!comment) return NextResponse.json({ ok: false, error: "コメントを入力してください" }, { status: 400 });

  if (!to && supabase && seekerId) {
    const { data } = await supabase
      .from("seeker_profiles")
      .select("user_id,bubble_raw")
      .eq("id", seekerId)
      .maybeSingle();
    if (data?.user_id) {
      const { data: user } = await supabase
        .from("users")
        .select("id,line_user_id,bubble_raw")
        .eq("id", data.user_id)
        .maybeSingle();
      const restoredLineUserId = user?.line_user_id || extractBubbleLineUserId(user?.bubble_raw) || extractBubbleLineUserId(data.bubble_raw) || "";
      to = restoredLineUserId;
      if (!user?.line_user_id && restoredLineUserId && user?.id) {
        await supabase.from("users").update({ line_user_id: restoredLineUserId }).eq("id", user.id);
      }
    }
  }

  const payload = {
    clubName: resolvedClubName || "店舗未設定",
    staffName: resolvedStaffName || "店舗スタッフ",
    hourlyWage,
    guaranteePeriod,
    comment,
    options,
  };

  if (supabase) {
    const [{ data: club }, { data: staff }] = await Promise.all([
      resolvedClubId
        ? supabase.from("clubs").select("id,display_name,logo_url").eq("id", resolvedClubId).maybeSingle()
        : Promise.resolve({ data: null }),
      resolvedStaffId
        ? supabase.from("club_staffs").select("id,staff_name").eq("id", resolvedStaffId).maybeSingle()
        : resolvedClubId
          ? supabase.from("club_staffs").select("id,staff_name").eq("club_id", resolvedClubId).limit(1).maybeSingle()
          : supabase.from("club_staffs").select("id,staff_name").limit(1).maybeSingle(),
    ]);
    resolvedClubId = club?.id || resolvedClubId;
    resolvedStaffId = staff?.id || resolvedStaffId;
    resolvedClubLogoUrl = club?.logo_url || null;
    payload.clubName = resolvedClubName || club?.display_name || payload.clubName;
    payload.staffName = resolvedStaffName || staff?.staff_name || payload.staffName;
    if (!resolvedClubId || !club?.id) {
      return NextResponse.json({ ok: false, error: "送信元の店舗を特定できません。店舗へ再ログインしてください。" }, { status: 400 });
    }
    if (!resolvedStaffId && resolvedClubId) {
      const sessionLineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
      const { data: sessionUser } = sessionLineUserId
        ? await supabase.from("users").select("id,line_name").eq("line_user_id", sessionLineUserId).maybeSingle()
        : { data: null };
      if (sessionUser?.id) {
        const { data: existingStaff } = await supabase.from("club_staffs").select("id").eq("user_id", sessionUser.id).maybeSingle();
        if (existingStaff?.id) {
          const { data: updatedStaff } = await supabase.from("club_staffs").update({ club_id: resolvedClubId, staff_name: sessionUser.line_name || "店舗スタッフ", is_active: true }).eq("id", existingStaff.id).select("id,staff_name").single();
          resolvedStaffId = updatedStaff?.id || "";
          payload.staffName = updatedStaff?.staff_name || payload.staffName;
        } else {
          const { data: createdStaff } = await supabase.from("club_staffs").insert({ user_id: sessionUser.id, club_id: resolvedClubId, staff_name: sessionUser.line_name || "店舗スタッフ", is_active: true }).select("id,staff_name").single();
          resolvedStaffId = createdStaff?.id || "";
          payload.staffName = createdStaff?.staff_name || payload.staffName;
        }
      }
    }
    if (!resolvedStaffId) {
      return NextResponse.json({ ok: false, error: "店舗スタッフ情報を特定できません。所属店舗の設定を確認してください。" }, { status: 400 });
    }
    if (seekerId && resolvedClubId && resolvedStaffId) {
      const { data: offer, error: offerError } = await supabase.from("offers").insert({
        seeker_id: seekerId,
        club_id: resolvedClubId,
        staff_id: resolvedStaffId,
        hourly_wage: payload.hourlyWage,
        guarantee_period: payload.guaranteePeriod,
        comment: payload.comment,
        status: "sent",
        bubble_raw: {
          options,
          workflow: { status: "unread", store_action_required: false, updated_at: new Date().toISOString() },
        },
      }).select("id").single();
      if (offerError || !offer?.id) {
        return NextResponse.json({
          ok: false,
          error: "オファーを保存できませんでした。入力内容を確認して再送してください。",
          detail: offerError?.message || "offer id was not returned",
        }, { status: 500 });
      }
      offerId = offer?.id || "";
    }
  }

  if (!to || to.startsWith("temp_")) {
    if (supabase && offerId) {
      await supabase.from("offers").update({
        bubble_raw: {
          options,
          workflow: { status: "unread", store_action_required: false },
          line_push: {
            sent: false,
            reason: "target_line_user_id_missing",
            at: new Date().toISOString(),
          },
        },
      }).eq("id", offerId);
    }
    return NextResponse.json({
      ok: true,
      sent: false,
      offerId,
      clubName: payload.clubName,
      clubLogoUrl: resolvedClubLogoUrl,
      reason: "target_line_user_id_missing",
    });
  }

  try {
    await sendLinePushMessage(to, [buildOfferFlexMessage({ ...payload, offerId })]);
    if (supabase && offerId) {
      await supabase.from("offers").update({
        bubble_raw: {
          options,
          workflow: { status: "unread", store_action_required: false },
          line_push: {
            sent: true,
            to,
            at: new Date().toISOString(),
          },
        },
      }).eq("id", offerId);
    }
    return NextResponse.json({
      ok: true,
      sent: true,
      offerId,
      clubName: payload.clubName,
      clubLogoUrl: resolvedClubLogoUrl,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "LINE push failed";
    const reason = detail.includes("LINE_CHANNEL_ACCESS_TOKEN") ? "line_access_token_missing" : "line_push_failed";
    if (supabase && offerId) {
      await supabase.from("offers").update({
        bubble_raw: {
          options,
          workflow: { status: "unread", store_action_required: false },
          line_push: {
            sent: false,
            reason,
            detail,
            at: new Date().toISOString(),
          },
        },
      }).eq("id", offerId);
    }
    return NextResponse.json({
      ok: true,
      sent: false,
      offerId,
      clubName: payload.clubName,
      clubLogoUrl: resolvedClubLogoUrl,
      reason,
      detail,
    });
  }
}
