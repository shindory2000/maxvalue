import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const lineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
  const body = await request.json().catch(() => ({}));
  const clubId = String(body.clubId || "");
  if (!lineUserId || !clubId) return NextResponse.json({ error: "session and clubId are required" }, { status: 400 });

  const [{ data: user }, { data: club }] = await Promise.all([
    supabase.from("users").select("id,role").eq("line_user_id", lineUserId).maybeSingle(),
    supabase.from("clubs").select("id,display_name,is_active").eq("id", clubId).maybeSingle(),
  ]);
  if (user?.role !== "admin") return NextResponse.json({ error: "admin authorization required" }, { status: 403 });
  if (!club?.id || club.is_active === false) return NextResponse.json({ error: "club not found" }, { status: 404 });

  const response = NextResponse.json({ ok: true, club: { id: club.id, name: club.display_name } });
  const cookieOptions = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" };
  response.cookies.set("maxvalue_club_id", club.id, cookieOptions);
  response.cookies.set("maxvalue_club_name", encodeURIComponent(club.display_name), cookieOptions);
  return response;
}
