import { NextRequest, NextResponse } from "next/server";
import { sendLinePushMessage } from "@/lib/line";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.nextUrl.searchParams.get("secret") || "";
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { data: responses, error } = await supabase.from("offer_responses").select("id,offer_id,seeker_id,next_action,selected_date,line_payload,offers(club_id,clubs(display_name))").eq("response_status", "schedule_selected").eq("selected_date", today);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let sent = 0;
  for (const response of responses || []) {
    const { data: seeker } = await supabase.from("seeker_profiles").select("user_id,nickname").eq("id", response.seeker_id).maybeSingle();
    if (!seeker?.user_id) continue;
    const { data: user } = await supabase.from("users").select("line_user_id").eq("id", seeker.user_id).maybeSingle();
    if (!user?.line_user_id) continue;
    const offer = Array.isArray(response.offers) ? response.offers[0] : response.offers;
    const club = Array.isArray(offer?.clubs) ? offer?.clubs[0] : offer?.clubs;
    const mode = response.next_action === "trial_shift" ? "体験入店" : "面接";
    await sendLinePushMessage(user.line_user_id, [{ type: "text", text: `本日は${club?.display_name || "店舗"}での${mode}予定日です。\n時間になりましたら入店し、お名前と${mode}の旨をお伝えください。` }]).catch(() => undefined);
    sent += 1;
  }
  return NextResponse.json({ ok: true, date: today, candidates: (responses || []).length, sent });
}
