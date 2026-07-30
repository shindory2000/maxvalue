import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  [
    "maxvalue_line_user_id", "maxvalue_line_name", "maxvalue_line_display_name",
    "maxvalue_line_picture_url", "maxvalue_role", "maxvalue_db_role",
    "maxvalue_club_id", "maxvalue_club_name", "maxvalue_admin_pending",
  ].forEach(name => response.cookies.delete(name));
  return response;
}
