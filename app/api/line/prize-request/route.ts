import { NextRequest, NextResponse } from "next/server";
import { sendLinePushMessage } from "@/lib/line";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const lineUserId = String(body.lineUserId || "");
  const itemName = String(body.itemName || "");
  const description = String(body.description || "");
  const supabase = getSupabaseServer();

  if (!itemName) return NextResponse.json({ error: "itemName is required" }, { status: 400 });
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const { data: user } = lineUserId
    ? await supabase.from("users").select("id,line_user_id,line_name").eq("line_user_id", lineUserId).maybeSingle()
    : { data: null };

  const { data: item } = await supabase
    .from("gacha_items")
    .select("id,name")
    .eq("name", itemName)
    .maybeSingle();

  if (user?.id && item?.id) {
    await supabase
      .from("gacha_results")
      .update({ used_status: "requested", used_requested_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("gacha_item_id", item.id)
      .eq("used_status", "unused");
  }

  let lineSent = false;
  let lineError = "";
  const targetLineUserId = user?.line_user_id || lineUserId;
  if (targetLineUserId && !targetLineUserId.startsWith("temp_")) {
    try {
      await sendLinePushMessage(targetLineUserId, [{
        type: "text",
        text: `景品の利用申請を受け付けました。\n\n景品：${itemName}\n${description ? `内容：${description}\n` : ""}運営からLINEでご案内します。`,
      }]);
      lineSent = true;
    } catch (error) {
      lineError = error instanceof Error ? error.message : "LINE push failed";
    }
  }

  return NextResponse.json({ ok: true, lineSent, lineError });
}
