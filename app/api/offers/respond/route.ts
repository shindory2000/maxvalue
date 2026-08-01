import { NextRequest, NextResponse } from "next/server";
import { sendLinePushMessage } from "@/lib/line";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OfferResponseStatus = "interested" | "rejected";
type OfferNextAction = "consultation_only" | "trial_shift";

function asStatus(value: unknown): OfferResponseStatus {
  return value === "rejected" ? "rejected" : "interested";
}

function asNextAction(value: unknown): OfferNextAction | null {
  if (value === "trial_shift") return "trial_shift";
  if (value === "consultation_only") return "consultation_only";
  return null;
}

function nextActionLabel(value: OfferNextAction | null) {
  return value === "trial_shift" ? "体験する" : "面接";
}

function confirmationText(nextAction: OfferNextAction | null, selectedDate: string, offeredHourlyWage: number) {
  const wage = Number(offeredHourlyWage || 0).toLocaleString("ja-JP");
  const wageLine = nextAction === "trial_shift" ? `\n体験時給：${wage}円` : "";
  return `日程希望を受け付けました。

内容：
${nextActionLabel(nextAction)}
希望日：${selectedDate.replaceAll("-", "/")}${wageLine}

担当者より追ってご連絡します。`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const offerId = String(body.offerId || "");
  const lineUserId = String(body.lineUserId || "");
  const selectedDate = String(body.selectedDate || "");
  const status = asStatus(body.status);
  const nextAction = asNextAction(body.nextAction);
  const cancel = body.cancel === true;
  const cancelReason = String(body.cancelReason || "").trim();
  const supabase = getSupabaseServer();

  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!offerId) return NextResponse.json({ error: "offerId is required" }, { status: 400 });
  const authenticatedLineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
  if (!authenticatedLineUserId) return NextResponse.json({ error: "LINEログインが必要です" }, { status: 401 });
  if (!lineUserId || lineUserId !== authenticatedLineUserId) return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });

  let userId = "";
  let seekerId = "";
  let targetLineUserId = lineUserId;

  if (lineUserId) {
    const { data: userRows } = await supabase
      .from("users")
      .select("id,line_user_id")
      .eq("line_user_id", lineUserId)
      .order("created_at", { ascending: false })
      .limit(1);
    const user = Array.isArray(userRows) ? userRows[0] : null;
    userId = user?.id || "";
    targetLineUserId = user?.line_user_id || lineUserId;
    if (userId) {
      const { data: profileRows } = await supabase
        .from("seeker_profiles")
        .select("id")
        .eq("user_id", userId)
        .limit(1);
      const profile = Array.isArray(profileRows) ? profileRows[0] : null;
      seekerId = profile?.id || "";
    }
  }

  const { data: offerMeta } = await supabase
    .from("offers")
    .select("seeker_id,club_id,hourly_wage")
    .eq("id", offerId)
    .maybeSingle();
  const offeredHourlyWage = Number(offerMeta?.hourly_wage || 0);
  if (!offerMeta?.seeker_id || !seekerId || offerMeta.seeker_id !== seekerId) {
    return NextResponse.json({ error: "このオファーへ回答する権限がありません" }, { status: 403 });
  }

  if (!seekerId) {
    seekerId = offerMeta?.seeker_id || "";
  }

  const responseStage =
    cancel ? "canceled" :
    status === "rejected" ? "rejected" :
    selectedDate ? "schedule_selected" :
    nextAction ? "action_selected" :
    "interested_clicked";

  const { error: offerError } = await supabase
    .from("offers")
    .update({ status })
    .eq("id", offerId);
  if (offerError) return NextResponse.json({ error: offerError.message }, { status: 500 });

  if (seekerId) {
    const directFields = {
      response_status: responseStage,
      next_action: nextAction,
      selected_date: selectedDate || null,
      offered_hourly_wage: offeredHourlyWage,
      response_source: "app",
    };
    const linePayload = {
      source: "app",
      response_type: status,
      response_status: responseStage,
      next_action: nextAction,
      selected_date: selectedDate || null,
      offered_hourly_wage: offeredHourlyWage,
      line_user_id: targetLineUserId || null,
      created_at: new Date().toISOString(),
      cancel_reason: cancelReason || null,
    };
    const { data: existingRows } = await supabase
      .from("offer_responses")
      .select("id")
      .eq("offer_id", offerId)
      .eq("seeker_id", seekerId)
      .order("created_at", { ascending: false })
      .limit(1);
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    let responseError: { message: string } | null | undefined;
    if (existing?.id) {
      const result = await supabase
        .from("offer_responses")
        .update({ response: status, line_payload: linePayload, ...directFields })
        .eq("id", existing.id);
      responseError = result.error;
      if (responseError && /response_status|next_action|selected_date|offered_hourly_wage|response_source/i.test(responseError.message)) {
        const retry = await supabase
          .from("offer_responses")
          .update({ response: status, line_payload: linePayload })
          .eq("id", existing.id);
        responseError = retry.error;
      }
    } else {
      const result = await supabase
        .from("offer_responses")
        .insert({ offer_id: offerId, seeker_id: seekerId, response: status, line_payload: linePayload, ...directFields });
      responseError = result.error;
      if (responseError && /response_status|next_action|selected_date|offered_hourly_wage|response_source/i.test(responseError.message)) {
        const retry = await supabase
          .from("offer_responses")
          .insert({ offer_id: offerId, seeker_id: seekerId, response: status, line_payload: linePayload });
        responseError = retry.error;
      }
    }
    if (responseError) return NextResponse.json({ error: responseError.message }, { status: 500 });
  }

  let lineSent = false;
  let lineError = "";
  if (targetLineUserId && !targetLineUserId.startsWith("temp_") && (status === "rejected" || responseStage === "schedule_selected")) {
    const text = status === "interested"
      ? confirmationText(nextAction, selectedDate || "日付未選択", offeredHourlyWage)
      : "今回は見送りとして受け付けました。\nまた気になるお店があればいつでも確認できます。";
    try {
      await sendLinePushMessage(targetLineUserId, [{ type: "text", text }]);
      lineSent = true;
    } catch (error) {
      lineError = error instanceof Error ? error.message : "LINE push failed";
    }
  }

  let storeLineSent = false;
  if (offerMeta?.club_id && (responseStage === "schedule_selected" || responseStage === "canceled")) {
    const { data: staffs } = await supabase.from("club_staffs").select("user_id").eq("club_id", offerMeta.club_id).eq("is_active", true);
    const staffUserIds = (staffs || []).map(staff => staff.user_id).filter(Boolean);
    const { data: staffUsers } = staffUserIds.length
      ? await supabase.from("users").select("line_user_id").in("id", staffUserIds)
      : { data: [] as { line_user_id: string | null }[] };
    const notification = responseStage === "canceled"
      ? `【日程キャンセル】\n求職者からキャンセルの連絡がありました。\n事情：${cancelReason || "未記入"}`
      : `【日程${body.previousSelectedDate ? "変更" : "確定"}】\n${nextActionLabel(nextAction)}\n希望日：${selectedDate.replaceAll("-", "/")}\n管理画面で詳細を確認してください。`;
    const results = await Promise.allSettled((staffUsers || []).filter(user => user.line_user_id).map(user => sendLinePushMessage(String(user.line_user_id), [{ type: "text", text: notification }])));
    storeLineSent = results.some(result => result.status === "fulfilled");
  }

  return NextResponse.json({
    ok: true,
    lineSent,
    lineError,
    responseStage,
    nextAction,
    selectedDate: selectedDate || null,
    offeredHourlyWage,
    storeLineSent,
  });
}
