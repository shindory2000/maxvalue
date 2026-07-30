import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { extractBubbleLineUserId } from "@/lib/bubble-line";
import { buildAdminMessageFlexMessage, sendLinePushMessage } from "@/lib/line";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const seekerId = String(body.seekerId || "");
  const message = String(body.message || "").trim();
  let lineUserId = String(body.lineUserId || "").trim();

  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  if (!lineUserId && seekerId) {
    const { data: profile, error: profileError } = await supabase
      .from("seeker_profiles")
      .select("user_id,bubble_raw,nickname")
      .eq("id", seekerId)
      .maybeSingle();
    if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

    if (profile?.user_id) {
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("line_user_id,bubble_raw,line_name")
        .eq("id", profile.user_id)
        .maybeSingle();
      if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });
      lineUserId =
        String(user?.line_user_id || "") ||
        extractBubbleLineUserId(user?.bubble_raw) ||
        extractBubbleLineUserId(profile.bubble_raw) ||
        "";
      if (!user?.line_user_id && lineUserId) {
        await supabase.from("users").update({ line_user_id: lineUserId }).eq("id", profile.user_id);
      }
    }
  }

  if (!lineUserId || lineUserId.startsWith("temp_")) {
    return NextResponse.json({ error: "LINE userIdが未保存です。" }, { status: 400 });
  }

  try {
    await sendLinePushMessage(lineUserId, [buildAdminMessageFlexMessage({ message })]);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "LINE送信に失敗しました。",
    }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
