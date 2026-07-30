import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TicketType = "registration_invite" | "interview";

function isTicketType(value: string): value is TicketType {
  return value === "registration_invite" || value === "interview";
}

function rankMultiplier(rank: string, rarity: string) {
  const normalizedRank = rank.toUpperCase();
  const normalizedRarity = rarity.toUpperCase();
  const high = ["UR", "SSR", "S"].includes(normalizedRarity);
  const middle = ["SR", "A"].includes(normalizedRarity);
  if (normalizedRank === "S") return high ? 1.4 : middle ? 1.15 : 0.82;
  if (normalizedRank === "B") return high ? 0.75 : middle ? 0.9 : 1.15;
  if (normalizedRank === "C") return high ? 0.5 : middle ? 0.75 : 1.35;
  return 1;
}

function pickItem<T extends { probability?: number | null; rarity?: string | null }>(items: T[], rank: string) {
  const weight = (item: T) => Number(item.probability || 0) * rankMultiplier(rank, String(item.rarity || ""));
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  const roll = Math.random() * (total > 0 ? total : 1);
  let threshold = 0;
  for (const item of items) {
    threshold += weight(item);
    if (roll <= threshold) return item;
  }
  return items[0] || null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const lineUserId = String(body.lineUserId || "").trim();
  const ticketType = String(body.ticketType || "").trim();
  const supabase = getSupabaseServer();

  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!lineUserId) return NextResponse.json({ error: "LINEユーザーIDが見つかりません" }, { status: 400 });
  if (!isTicketType(ticketType)) return NextResponse.json({ error: "チケット種別が不正です" }, { status: 400 });
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
    const userRaw = (userRow?.bubble_raw || {}) as Record<string, unknown>;
    const rank = String(((userRaw.admin_extra || {}) as Record<string, unknown>).rank || "A");
    if (!userId) return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });

    const { data: ticketRows, error: ticketError } = await supabase
      .from("gacha_tickets")
      .select("id")
      .eq("user_id", userId)
      .eq("ticket_type", ticketType)
      .is("used_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (ticketError) throw new Error(`ticket lookup failed: ${ticketError.message}`);
    const ticketId = Array.isArray(ticketRows) ? ticketRows[0]?.id : "";
    if (!ticketId) return NextResponse.json({ error: "利用可能なチケットがありません" }, { status: 400 });

    const { data: items, error: itemError } = await supabase
      .from("gacha_items")
      .select("id,name,rarity,description,image_url,probability,ticket_type")
      .eq("ticket_type", ticketType)
      .eq("is_active", true)
      .order("probability", { ascending: false });
    if (itemError) throw new Error(`gacha item lookup failed: ${itemError.message}`);
    const item = pickItem(Array.isArray(items) ? items : [], rank);
    if (!item?.id) return NextResponse.json({ error: "ガチャ景品が設定されていません" }, { status: 400 });

    const now = new Date().toISOString();
    const { data: consumedTicket, error: consumeError } = await supabase
      .from("gacha_tickets")
      .update({ used_at: now })
      .eq("id", ticketId)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (consumeError) throw new Error(`ticket consume failed: ${consumeError.message}`);
    if (!consumedTicket?.id) return NextResponse.json({ error: "チケットはすでに使用されています" }, { status: 409 });

    const { error: resultError } = await supabase.from("gacha_results").insert({
      user_id: userId,
      gacha_item_id: item.id,
      ticket_id: ticketId,
    });
    if (resultError) {
      const { error: rollbackError } = await supabase.from("gacha_tickets").update({ used_at: null }).eq("id", ticketId).eq("used_at", now);
      if (rollbackError) console.error("[gacha-spin] ticket rollback failed", { ticketId, detail: rollbackError.message });
      throw new Error(`gacha result insert failed: ${resultError.message}`);
    }

    return NextResponse.json({
      id: item.id,
      name: item.name,
      rarity: item.rarity,
      description: item.description,
      image_url: item.image_url,
      probability: Number(item.probability || 0),
      ticket_type: item.ticket_type,
      rank,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error("[gacha-spin] failed", { detail, lineUserId, ticketType });
    return NextResponse.json({ error: "ガチャの実行に失敗しました", detail }, { status: 500 });
  }
}
