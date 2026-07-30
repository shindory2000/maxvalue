import { NextRequest, NextResponse } from "next/server";
import { fetchLineBotProfile, getLineConfig } from "@/lib/line";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const lineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
  if (!lineUserId) {
    return NextResponse.json({ friendAdded: false, reason: "line_session_missing" }, { status: 401 });
  }

  const profile = await fetchLineBotProfile(lineUserId).catch(() => ({ userId: "", displayName: "", pictureUrl: "" }));
  return NextResponse.json({
    friendAdded: Boolean(profile.userId || profile.displayName),
    friendUrl: getLineConfig().friendUrl,
  });
}
