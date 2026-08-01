import { NextRequest, NextResponse } from "next/server";
import {
  buildOfferActionChoiceFlexMessage,
  buildOfferDatePickerFlexMessage,
  fetchLineBotProfile,
  sendLinePushMessage,
  sendLineReplyMessage,
  verifyLineSignature,
} from "@/lib/line";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SupabaseServer = NonNullable<ReturnType<typeof getSupabaseServer>>;

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string; params?: Record<string, string> };
};

type OfferResponseStatus = "interested" | "rejected";
type OfferNextAction = "consultation_only" | "trial_shift";
type OfferResponseStage = "interested_clicked" | "action_selected" | "schedule_selected" | "rejected";

function nextActionLabel(value: string | null | undefined) {
  return value === "trial_shift" ? "体験する" : "面接";
}

function confirmationText(nextAction: string | null | undefined, selectedDate: string, offeredHourlyWage: number) {
  const wage = Number(offeredHourlyWage || 0).toLocaleString("ja-JP");
  const wageLine = nextAction === "trial_shift" ? `\n体験時給：${wage}円` : "";
  return `日程希望を受け付けました。

内容：
${nextActionLabel(nextAction)}
希望日：${selectedDate.replaceAll("-", "/")}${wageLine}

担当者より追ってご連絡します。`;
}

async function replyWithPushFallback(replyToken: string, lineUserId: string, messages: unknown[]) {
  try {
    await sendLineReplyMessage(replyToken, messages);
    return "reply";
  } catch (replyError) {
    console.error("[line-webhook] reply failed; falling back to push", replyError);
    await sendLinePushMessage(lineUserId, messages);
    return "push";
  }
}

function parseOfferStatus(event: LineEvent): {
  status: OfferResponseStatus;
  offerId: string;
  stage: OfferResponseStage;
  nextAction?: OfferNextAction;
  selectedDate?: string;
} | null {
  if (event.type === "postback" && event.postback?.data) {
    const rawData = event.postback.data;
    if (rawData.startsWith("offer_interested_") || rawData === "offer_interested") {
      return { status: "interested" as const, offerId: rawData.replace(/^offer_interested_?/, ""), stage: "interested_clicked" };
    }
    if (rawData.startsWith("offer_skip_") || rawData.startsWith("offer_rejected_") || rawData === "offer_skip") {
      return { status: "rejected" as const, offerId: rawData.replace(/^(offer_skip|offer_rejected)_?/, ""), stage: "rejected" };
    }
    const params = new URLSearchParams(rawData);
    const rawStatus = params.get("status") || params.get("action") || "";
    const status = rawStatus === "offer_skip" ? "rejected" : rawStatus === "offer_interested" ? "interested" : rawStatus;
    const action = params.get("action") || "";
    const nextAction = params.get("next_action") === "trial_shift" ? "trial_shift" : params.get("next_action") === "consultation_only" ? "consultation_only" : undefined;
    if (action === "select_next_action" && nextAction) {
      return {
        status: "interested",
        offerId: params.get("offer_id") || params.get("offerId") || "",
        stage: "action_selected",
        nextAction,
      };
    }
    if (action === "select_date") {
      return {
        status: "interested",
        offerId: params.get("offer_id") || params.get("offerId") || "",
        stage: "schedule_selected",
        nextAction,
        selectedDate: event.postback.params?.date || "",
      };
    }
    if (status === "interested" || status === "rejected") {
      return { status, offerId: params.get("offer_id") || params.get("offerId") || "", stage: status === "interested" ? "interested_clicked" : "rejected" };
    }
  }
  const text = event.message?.text || "";
  if (text.includes("興味あり") || text.includes("飲みに行きます")) return { status: "interested" as const, offerId: "", stage: "interested_clicked" };
  if (text.includes("見送る") || text.includes("今回は見送る")) return { status: "rejected" as const, offerId: "", stage: "rejected" };
  return null;
}

async function ensureLineUser(supabase: SupabaseServer, lineUserId: string) {
  const profile = await fetchLineBotProfile(lineUserId).catch(() => ({ displayName: "", pictureUrl: "" }));
  const lineName = profile.displayName || "LINEユーザー";
  const linePictureUrl = profile.pictureUrl || null;
  const { data: existingRows, error: lookupError } = await supabase
    .from("users")
    .select("id,role")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (lookupError) throw new Error(`users lookup failed: ${lookupError.message}`);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (existing?.id) {
    const { error } = await supabase
      .from("users")
      .update({
        line_name: lineName,
        line_picture_url: linePictureUrl,
        last_login_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(`users update failed: ${error.message}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from("users")
    .insert({
      line_user_id: lineUserId,
      line_name: lineName,
      line_picture_url: linePictureUrl,
      role: "seeker",
      last_login_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`users insert failed: ${error.message}`);
  return data.id as string;
}

async function resolveOffer(supabase: SupabaseServer, lineUserId: string, explicitOfferId: string) {
  // A Messaging API userId can differ from the LINE Login userId when the
  // channels live under different providers. The postback offer id is the
  // authoritative link because the card was pushed for this exact offer. Do
  // this before user sync so postback replies stay fast.
  if (explicitOfferId) {
    const { data: explicitOffer, error: explicitOfferError } = await supabase
      .from("offers")
      .select("id,seeker_id")
      .eq("id", explicitOfferId)
      .maybeSingle();
    if (explicitOfferError) throw new Error(`explicit offer lookup failed: ${explicitOfferError.message}`);
    if (explicitOffer?.seeker_id) return { seekerId: String(explicitOffer.seeker_id), offerId: String(explicitOffer.id) };
  }

  const userId = await ensureLineUser(supabase, lineUserId);
  const { data: seekerRows, error: seekerError } = await supabase
    .from("seeker_profiles")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (seekerError) throw new Error(`seeker lookup failed: ${seekerError.message}`);
  const seekerId = Array.isArray(seekerRows) ? seekerRows[0]?.id || "" : "";
  if (!seekerId) return { seekerId: "", offerId: explicitOfferId };

  const { data: offerRows, error: offerError } = await supabase
    .from("offers")
    .select("id")
    .eq("seeker_id", seekerId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (offerError) throw new Error(`latest offer lookup failed: ${offerError.message}`);
  const offerId = Array.isArray(offerRows) ? offerRows[0]?.id || "" : "";
  return { seekerId, offerId };
}

async function fetchOfferMeta(supabase: SupabaseServer, offerId: string) {
  const { data, error } = await supabase
    .from("offers")
    .select("id,club_id,hourly_wage,status,bubble_raw")
    .eq("id", offerId)
    .maybeSingle();
  if (error) throw new Error(`offer meta lookup failed: ${error.message}`);
  return {
    clubId: String(data?.club_id || ""),
    hourlyWage: Number(data?.hourly_wage || 0),
    bubbleRaw: (data?.bubble_raw || {}) as Record<string, unknown>,
  };
}

async function notifyClubOfSchedule(
  supabase: SupabaseServer,
  clubId: string,
  nextAction: string | null | undefined,
  selectedDate: string,
) {
  if (!clubId || !selectedDate) return false;
  const { data: staffs } = await supabase
    .from("club_staffs")
    .select("user_id")
    .eq("club_id", clubId)
    .eq("is_active", true);
  const staffUserIds = (staffs || []).map(staff => staff.user_id).filter(Boolean);
  if (!staffUserIds.length) return false;
  const { data: staffUsers } = await supabase
    .from("users")
    .select("line_user_id")
    .in("id", staffUserIds);
  const notification = `【日程確定】\n${nextActionLabel(nextAction)}\n希望日：${selectedDate.replaceAll("-", "/")}\n管理画面の「出したオファー」で詳細を確認してください。`;
  const results = await Promise.allSettled(
    (staffUsers || [])
      .filter(user => user.line_user_id)
      .map(user => sendLinePushMessage(String(user.line_user_id), [{ type: "text", text: notification }])),
  );
  return results.some(result => result.status === "fulfilled");
}

async function saveOfferResponse(
  supabase: SupabaseServer,
  event: LineEvent,
  lineUserId: string,
  status: "interested" | "rejected",
  offerId: string,
  seekerId: string,
  extras: {
    stage: OfferResponseStage;
    nextAction?: OfferNextAction;
    selectedDate?: string;
    offeredHourlyWage?: number;
  },
) {
  const directFields = {
    response_status: extras.stage,
    next_action: extras.nextAction || null,
    selected_date: extras.selectedDate || null,
    offered_hourly_wage: extras.offeredHourlyWage || null,
    response_source: "line",
  };
  const linePayload = {
    source: "line",
    response_type: status,
    response_status: extras.stage,
    next_action: extras.nextAction || null,
    selected_date: extras.selectedDate || null,
    offered_hourly_wage: extras.offeredHourlyWage || null,
    eventType: event.type,
    message: event.message || null,
    postback: event.postback || null,
    line_event_source: event.source || null,
    line_user_id: lineUserId,
    received_at: new Date().toISOString(),
  };

  const { data: existingRows } = await supabase
    .from("offer_responses")
    .select("id")
    .eq("offer_id", offerId)
    .eq("seeker_id", seekerId)
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;

  if (existing?.id) {
    let { error } = await supabase
      .from("offer_responses")
      .update({ response: status, line_payload: linePayload, ...directFields })
      .eq("id", existing.id);
    if (error && /response_status|next_action|selected_date|offered_hourly_wage|response_source/i.test(error.message)) {
      const retry = await supabase
        .from("offer_responses")
        .update({ response: status, line_payload: linePayload })
        .eq("id", existing.id);
      error = retry.error;
    }
    if (error) throw new Error(`offer response update failed: ${error.message}`);
  } else {
    let { error } = await supabase.from("offer_responses").insert({
      offer_id: offerId,
      seeker_id: seekerId,
      response: status,
      line_payload: linePayload,
      ...directFields,
    });
    if (error && /response_status|next_action|selected_date|offered_hourly_wage|response_source/i.test(error.message)) {
      const retry = await supabase.from("offer_responses").insert({
        offer_id: offerId,
        seeker_id: seekerId,
        response: status,
        line_payload: linePayload,
      });
      error = retry.error;
    }
    if (error) throw new Error(`offer response insert failed: ${error.message}`);
  }

  const { error: offerError } = await supabase.from("offers").update({ status }).eq("id", offerId);
  if (offerError) throw new Error(`offer status update failed: ${offerError.message}`);
}

async function handleEvent(supabase: SupabaseServer | null, event: LineEvent) {
  const lineUserId = event.source?.userId || "";
  if (!lineUserId) return { handled: false, reason: "missing_line_user_id" };

  const parsed = parseOfferStatus(event);
  if (!parsed) {
    if (supabase && (event.type === "follow" || event.type === "message" || event.type === "postback")) {
      await ensureLineUser(supabase, lineUserId);
    }
    return { handled: true, kind: event.type };
  }
  if (!supabase) return { handled: false, reason: "supabase_not_configured", status: parsed.status };

  const { seekerId, offerId } = await resolveOffer(supabase, lineUserId, parsed.offerId);
  if (!seekerId || !offerId) {
    return { handled: false, reason: "offer_or_seeker_not_found", status: parsed.status, offerId };
  }

  const meta = await fetchOfferMeta(supabase, offerId);
  let replied = false;
  const replyMessages =
    event.replyToken && parsed.status === "interested" && parsed.stage === "interested_clicked"
      ? [buildOfferActionChoiceFlexMessage({ offerId, hourlyWage: meta.hourlyWage })]
      : event.replyToken && parsed.status === "interested" && parsed.stage === "action_selected"
        ? [buildOfferDatePickerFlexMessage({ offerId, hourlyWage: meta.hourlyWage, nextAction: parsed.nextAction || "consultation_only" })]
        : event.replyToken && parsed.status === "interested" && parsed.stage === "schedule_selected"
          ? [{ type: "text", text: confirmationText(parsed.nextAction, parsed.selectedDate || "日付未選択", meta.hourlyWage) }]
          : event.replyToken && parsed.status === "rejected"
            ? [{ type: "text", text: "今回は見送りとして受け付けました。\nまた気になるお店があればいつでも確認できます。" }]
            : null;
  if (event.replyToken && replyMessages) {
    await replyWithPushFallback(event.replyToken, lineUserId, replyMessages);
    replied = true;
  }

  let persisted = true;
  let storeLineSent = false;
  try {
    await saveOfferResponse(supabase, event, lineUserId, parsed.status, offerId, seekerId, {
      stage: parsed.stage,
      nextAction: parsed.nextAction,
      selectedDate: parsed.selectedDate,
      offeredHourlyWage: meta.hourlyWage,
    });
    if (parsed.stage === "schedule_selected" && parsed.selectedDate) {
      storeLineSent = await notifyClubOfSchedule(
        supabase,
        meta.clubId,
        parsed.nextAction,
        parsed.selectedDate,
      );
    }
  } catch (error) {
    // A temporary DB/schema issue must not make the LINE conversation appear
    // unresponsive. Continue the interaction and retain a detailed server log.
    persisted = false;
    console.error("[line-webhook] response persistence failed", {
      message: error instanceof Error ? error.message : "unknown",
      offerId,
      seekerId,
      stage: parsed.stage,
    });
  }

  console.info("[line-webhook] offer event handled", {
    offerId,
    seekerId,
    status: parsed.status,
    stage: parsed.stage,
    replied,
    persisted,
  });
  return { handled: true, kind: "offer_response", status: parsed.status, stage: parsed.stage, offerId, replied, persisted, storeLineSent };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!verifyLineSignature(rawBody, signature)) {
    console.error("[line-webhook] invalid signature", { hasSignature: Boolean(signature) });
    return NextResponse.json({ ok: true, accepted: false, reason: "invalid_signature" });
  }

  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(rawBody || "{}") as { events?: LineEvent[] };
  } catch (error) {
    console.error("[line-webhook] invalid json", error);
    return NextResponse.json({ ok: true, accepted: false, reason: "invalid_json" });
  }

  const supabase = getSupabaseServer();
  const results = [];
  for (const event of payload.events || []) {
    try {
      results.push(await handleEvent(supabase, event));
    } catch (error) {
      console.error("[line-webhook] event failed", {
        message: error instanceof Error ? error.message : "unknown",
        type: event.type,
        lineUserId: event.source?.userId || "",
      });
      results.push({ handled: false, reason: "event_error", type: event.type });
    }
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    activeWebhookUrl: "https://maxvalue-seven.vercel.app/api/line/webhook",
    bubbleRollbackUrl: "https://shindory2000-69886.bubbleapps.io/api/1.1/wf/line_webhook",
  });
}
