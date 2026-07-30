import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TicketType = "registration_invite" | "interview";

type GachaItemRow = {
  id: string;
  name: string | null;
  rarity: string | null;
  description: string | null;
  image_url: string | null;
  probability: number | string | null;
  ticket_type: TicketType | null;
};

function toItem(row: Partial<GachaItemRow>) {
  return {
    id: String(row.id || ""),
    name: String(row.name || "景品"),
    rarity: String(row.rarity || ""),
    description: String(row.description || ""),
    image_url: row.image_url || "",
    probability: Number(row.probability || 0),
    ticket_type: row.ticket_type || "registration_invite",
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const lineUserId = String(body.lineUserId || "").trim();
  const supabase = getSupabaseServer();

  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!lineUserId) return NextResponse.json({ registration_invite: 0, interview: 0, results: [] });
  const authenticatedLineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
  if (!authenticatedLineUserId) return NextResponse.json({ error: "LINEログインが必要です" }, { status: 401 });
  if (lineUserId !== authenticatedLineUserId) return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });

  try {
    const { data: userRows, error: userError } = await supabase
      .from("users")
      .select("id,bubble_raw")
      .eq("line_user_id", lineUserId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (userError) throw new Error(`user lookup failed: ${userError.message}`);

    const userRow = Array.isArray(userRows) ? userRows[0] : null;
    const userId = userRow?.id || "";
    if (!userId) return NextResponse.json({ registration_invite: 0, interview: 0, results: [] });

    const { data: tickets, error: ticketError } = await supabase
      .from("gacha_tickets")
      .select("ticket_type")
      .eq("user_id", userId)
      .is("used_at", null);
    if (ticketError) throw new Error(`ticket lookup failed: ${ticketError.message}`);

    const registrationInvite = (Array.isArray(tickets) ? tickets : [])
      .filter(ticket => ticket.ticket_type === "registration_invite").length;
    const interview = (Array.isArray(tickets) ? tickets : [])
      .filter(ticket => ticket.ticket_type === "interview").length;

    const { data: resultRows, error: resultError } = await supabase
      .from("gacha_results")
      .select("id,created_at,gacha_item_id,gacha_items(id,name,rarity,description,image_url,probability,ticket_type)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (resultError) throw new Error(`gacha result lookup failed: ${resultError.message}`);

    const results = (Array.isArray(resultRows) ? resultRows : []).map(row => {
      const item = Array.isArray(row.gacha_items) ? row.gacha_items[0] : row.gacha_items;
      return toItem(item || {});
    }).filter(item => item.id || item.name);
    const userRaw = (userRow?.bubble_raw || {}) as Record<string, unknown>;
    const adminExtra = (userRaw.admin_extra || {}) as Record<string, unknown>;
    const rank = String(adminExtra.rank || "A");

    return NextResponse.json({
      registration_invite: registrationInvite,
      interview,
      results,
      rank,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error("[gacha-state] failed", { detail, lineUserId });
    return NextResponse.json({
      registration_invite: 0,
      interview: 0,
      results: [],
      error: "ガチャ状態の取得に失敗しました",
      detail,
    });
  }
}
