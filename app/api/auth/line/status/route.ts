import { NextRequest, NextResponse } from "next/server";
import { fetchLineBotProfile, getLineConfig, isLineLoginConfigured } from "@/lib/line";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ADMIN_SESSION_COOKIE, getAdminSessionLineUserId } from "@/lib/admin";

export const dynamic = "force-dynamic";

function decodeCookie(value = "") {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

export async function GET(request: NextRequest) {
  const config = getLineConfig();
  const userId = request.cookies.get("maxvalue_line_user_id")?.value ||
    getAdminSessionLineUserId(request.cookies.get(ADMIN_SESSION_COOKIE)?.value || "");
  const displayName = request.cookies.get("maxvalue_line_display_name")?.value || request.cookies.get("maxvalue_line_name")?.value || "";
  const pictureUrl = request.cookies.get("maxvalue_line_picture_url")?.value || "";
  const role = request.cookies.get("maxvalue_role")?.value || "";
  const dbRole = request.cookies.get("maxvalue_db_role")?.value || (role === "club" ? "club_staff" : role);
  const selectedClubId = request.cookies.get("maxvalue_club_id")?.value || "";
  const selectedClubName = request.cookies.get("maxvalue_club_name")?.value || "";
  let persistedRole = dbRole;
  let deleted = false;
  let hasSeekerProfile = false;
  let friendAdded = false;

  if (userId) {
    const supabase = getSupabaseServer();
    if (supabase) {
      const userResult = await supabase
        .from("users")
        .select("*")
        .eq("line_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      const user = Array.isArray(userResult.data) ? userResult.data[0] : null;
      deleted = Boolean(user?.is_deleted || user?.deleted_at);
      const raw = (user?.bubble_raw || {}) as Record<string, unknown>;
      const extra = (raw.admin_extra || {}) as Record<string, unknown>;
      persistedRole = deleted ? "" : String(extra.effective_role || user?.role || dbRole || "");
      if (user?.id && !deleted) {
        const { data: profiles } = await supabase
          .from("seeker_profiles")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);
        hasSeekerProfile = Boolean(Array.isArray(profiles) && profiles[0]?.id);
      }
    }
    const botProfile = await fetchLineBotProfile(userId).catch(() => ({ userId: "", displayName: "", pictureUrl: "" }));
    friendAdded = Boolean(botProfile.userId || botProfile.displayName);
  }
  return NextResponse.json({
    configured: isLineLoginConfigured(),
    callbackUrl: config.redirectUri,
    bubbleWebhookUrl: "https://shindory2000-69886.bubbleapps.io/api/1.1/wf/line_webhook",
    nextWebhookUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://maxvalue-seven.vercel.app"}/api/line/webhook`,
    friendUrlConfigured: Boolean(config.friendUrl),
    environment: {
      loginChannelId: Boolean(config.channelId),
      loginChannelSecret: Boolean(config.channelSecret),
      messagingChannelId: Boolean(config.messagingChannelId),
      messagingChannelSecret: Boolean(config.messagingChannelSecret),
      channelAccessToken: Boolean(config.channelAccessToken),
      webhookSecret: Boolean(config.webhookSecret),
      supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    capabilities: {
      isAdmin: persistedRole === "admin" && !deleted,
      isClubStaff: (persistedRole === "club_staff" || persistedRole === "admin") && !deleted,
      hasSeekerProfile,
      friendAdded,
      deleted,
      selectedClubId,
      selectedClubName: selectedClubName ? decodeCookie(selectedClubName) : "",
    },
    profile: userId && !deleted ? {
      userId,
      line_user_id: userId,
      displayName: decodeCookie(displayName || "LINEユーザー"),
      line_display_name: decodeCookie(displayName || "LINEユーザー"),
      pictureUrl: pictureUrl ? decodeCookie(pictureUrl) : "",
      line_picture_url: pictureUrl ? decodeCookie(pictureUrl) : "",
      role,
      db_role: persistedRole,
    } : null,
  });
}
