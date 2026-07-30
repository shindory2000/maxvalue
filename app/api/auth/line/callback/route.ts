import { NextRequest, NextResponse } from "next/server";
import { exchangeLineCode, fetchLineBotProfile, fetchLineProfile, verifyLineOAuthState } from "@/lib/line";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE, createAdminSessionToken } from "@/lib/admin";

export const dynamic = "force-dynamic";

type LoginRole = "seeker" | "club_staff" | "ambassador" | "admin";
type SupabaseServer = NonNullable<ReturnType<typeof getSupabaseServer>>;

function decodeCookie(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function chooseRole(requested: LoginRole, existing?: string | null): LoginRole {
  if (existing === "admin") return "admin";
  if (requested === "admin") return "admin";
  if (requested === "club_staff") return "club_staff";
  if (requested === "ambassador") return "ambassador";
  return existing === "club_staff" ? "club_staff" : "seeker";
}

function normalizeRole(value?: string | null): LoginRole {
  if (value === "admin" || value === "club_staff" || value === "ambassador" || value === "seeker") return value;
  return "seeker";
}

function toClientRole(role: LoginRole) {
  return role === "club_staff" ? "club" : role;
}

function cleanupOAuthCookies(response: NextResponse) {
  response.cookies.delete("line_oauth_state");
  response.cookies.delete("line_return_to");
  response.cookies.delete("line_redirect_uri");
  response.cookies.delete("line_login_role");
  response.cookies.delete("line_club_code");
  response.cookies.delete("line_referral_code");
  response.cookies.delete("maxvalue_admin_pending");
}

async function findClubByCode(supabase: SupabaseServer, clubCode: string) {
  if (!clubCode.trim()) return null;
  const normalizedCode = clubCode.trim().toLowerCase();
  const { data } = await supabase
    .from("clubs")
    .select("id,display_name,store_code,profile")
    .limit(1000);
  const clubs = Array.isArray(data) ? data : [];
  return clubs.find(club => {
    const profile = (club.profile || {}) as Record<string, unknown>;
    const permissionCode = String(profile.permission_code || "").trim().toLowerCase();
    const storeCode = String(club.store_code || "").trim().toLowerCase();
    return Boolean(normalizedCode && (normalizedCode === storeCode || normalizedCode === permissionCode));
  }) || null;
}

async function findExistingLineUser(supabase: SupabaseServer, lineUserId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`users lookup failed: ${error.message}`);
  const existing = Array.isArray(data) ? data[0] : null;
  const raw = (existing?.bubble_raw || {}) as Record<string, unknown>;
  const oldSoftDelete = (raw.admin_deleted || {}) as Record<string, unknown>;
  if (existing?.id && (existing.is_deleted || existing.deleted_at || oldSoftDelete.is_deleted)) {
    const tombstoneLineId = `deleted_${existing.id}_${Date.now()}`;
    const { error: detachError } = await supabase
      .from("users")
      .update({ line_user_id: tombstoneLineId })
      .eq("id", existing.id);
    if (detachError) throw new Error(`deleted user detach failed: ${detachError.message}`);
    return null;
  }
  return existing;
}

async function saveLineUser(
  supabase: SupabaseServer,
  profile: Awaited<ReturnType<typeof fetchLineProfile>>,
  requestedRole: LoginRole,
) {
  const existing = await findExistingLineUser(supabase, profile.userId);
  const existingRaw = (existing?.bubble_raw || {}) as Record<string, unknown>;
  const existingExtra = (existingRaw.admin_extra || {}) as Record<string, unknown>;
  const effectiveExisting = String(existingExtra.effective_role || existing?.role || "");
  const resolvedRole = chooseRole(requestedRole, effectiveExisting);
  const payload = {
    line_user_id: profile.userId,
    line_name: profile.displayName || "LINEユーザー",
    line_picture_url: profile.pictureUrl || null,
    role: resolvedRole === "ambassador" ? "seeker" : resolvedRole,
    bubble_raw: { ...existingRaw, admin_extra: { ...existingExtra, effective_role: resolvedRole } },
    last_login_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from("users")
      .update(payload)
      .eq("id", existing.id)
      .select("id,role,line_user_id")
      .single();
    if (error) throw new Error(`users update failed: ${error.message}`);
    return { user: data, role: resolvedRole };
  }

  const { data, error } = await supabase
    .from("users")
    .insert(payload)
    .select("id,role,line_user_id")
    .single();
  if (error) {
    const racedUser = await findExistingLineUser(supabase, profile.userId);
    if (racedUser?.id) return saveLineUser(supabase, profile, requestedRole);
    throw new Error(`users insert failed: ${error.message}`);
  }
  return { user: data, role: resolvedRole };
}

async function getSeekerRedirectTarget(supabase: SupabaseServer, userId: string) {
  const { data, error } = await supabase
    .from("seeker_profiles")
    .select("id,nickname,age,photo_1_url,desired_region,desired_area,work_experience,desired_shift,start_timing")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`seeker profile lookup failed: ${error.message}`);
  const profile = Array.isArray(data) ? data[0] : null;
  const completed = Boolean(profile?.id);
  return {
    profileId: profile?.id || "",
    completed,
    screen: completed ? "profile" : "setup",
  };
}

async function linkClubStaff(
  supabase: SupabaseServer,
  userId: string,
  clubId: string,
  staffName: string,
) {
  const { data: existingRows, error: lookupError } = await supabase
    .from("club_staffs")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (lookupError) throw new Error(`club staff lookup failed: ${lookupError.message}`);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (existing?.id) {
    const { error } = await supabase
      .from("club_staffs")
      .update({ club_id: clubId, staff_name: staffName, is_active: true })
      .eq("id", existing.id);
    if (error) throw new Error(`club staff update failed: ${error.message}`);
    return;
  }
  const { error } = await supabase.from("club_staffs").insert({
    user_id: userId,
    club_id: clubId,
    staff_name: staffName,
    is_active: true,
  });
  if (error) throw new Error(`club staff insert failed: ${error.message}`);
}

export async function GET(request: NextRequest) {
  const expectedState = request.cookies.get("line_oauth_state")?.value;
  const receivedState = request.nextUrl.searchParams.get("state");
  const signedState = verifyLineOAuthState(receivedState);
  const code = request.nextUrl.searchParams.get("code");
  const stateIsValid = Boolean(
    receivedState &&
    ((expectedState && expectedState === receivedState) || signedState),
  );
  const returnTo = request.cookies.get("line_return_to")?.value || signedState?.returnTo || "/?screen=signin";
  const safeReturnUrl = new URL(returnTo, request.nextUrl.origin);

  if (!stateIsValid) {
    safeReturnUrl.searchParams.set("line", "error");
    safeReturnUrl.searchParams.set("reason", "oauth_state");
    const response = NextResponse.redirect(safeReturnUrl);
    cleanupOAuthCookies(response);
    return response;
  }
  if (!code) {
    safeReturnUrl.searchParams.set("line", "error");
    safeReturnUrl.searchParams.set("reason", "missing_code");
    const response = NextResponse.redirect(safeReturnUrl);
    cleanupOAuthCookies(response);
    return response;
  }

  const redirectUri = request.cookies.get("line_redirect_uri")?.value || signedState?.redirectUri || `${request.nextUrl.origin}/api/auth/line/callback`;
  const requestedRole = normalizeRole(request.cookies.get("line_login_role")?.value || signedState?.role || "seeker");
  const clubCode = request.cookies.get("line_club_code")?.value || signedState?.clubCode || "";
  const referralCode = request.cookies.get("line_referral_code")?.value || signedState?.referralCode || "";

  try {
    const token = await exchangeLineCode(code, redirectUri);
    const profile = await fetchLineProfile(token.access_token);
    const supabase = getSupabaseServer();
    let resolvedRole: LoginRole = requestedRole;
    let linkedClub: { id: string; display_name: string } | null = null;
    let redirectScreen: string | null = null;
    let savedUserId = "";

    if (supabase) {
      const { user: savedUser, role } = await saveLineUser(supabase, profile, requestedRole);
      resolvedRole = role;
      savedUserId = String(savedUser?.id || "");

      if (requestedRole === "club_staff" && savedUser?.id) {
        const club = await findClubByCode(supabase, decodeCookie(clubCode));
        if (club) {
          await linkClubStaff(supabase, savedUser.id, club.id, profile.displayName || "店舗スタッフ");
          linkedClub = { id: club.id, display_name: club.display_name };
        }
      }

      if (savedUser?.id) {
        if (requestedRole === "seeker") {
          const seekerTarget = await getSeekerRedirectTarget(supabase, savedUser.id);
          resolvedRole = "seeker";
          if (seekerTarget.completed) {
            redirectScreen = "profile";
          } else {
            const botProfile = await fetchLineBotProfile(profile.userId).catch(() => ({ userId: "", displayName: "", pictureUrl: "" }));
            redirectScreen = botProfile.userId || botProfile.displayName ? "setup" : "friendAdd";
          }
          console.log("[line-callback] requested seeker redirect resolved", {
            userId: savedUser.id,
            profileId: seekerTarget.profileId,
            completed: seekerTarget.completed,
            persistedRole: role,
            returnTo,
          });
        } else if (resolvedRole === "admin") {
          redirectScreen = "adminUsers";
        } else if (resolvedRole === "ambassador") {
          const raw = (await supabase.from("users").select("bubble_raw").eq("id", savedUser.id).maybeSingle()).data?.bubble_raw as Record<string, unknown> | null;
          redirectScreen = raw?.ambassador_profile ? "ambassadorProfile" : "ambassadorSetup";
        } else if (resolvedRole === "club_staff") {
          redirectScreen = "talent";
        } else {
          const seekerTarget = await getSeekerRedirectTarget(supabase, savedUser.id);
          if (seekerTarget.completed) {
            redirectScreen = "profile";
          } else {
            const botProfile = await fetchLineBotProfile(profile.userId).catch(() => ({ userId: "", displayName: "", pictureUrl: "" }));
            redirectScreen = botProfile.userId || botProfile.displayName ? "setup" : "friendAdd";
          }
          console.log("[line-callback] seeker redirect resolved", {
            userId: savedUser.id,
            profileId: seekerTarget.profileId,
            completed: seekerTarget.completed,
            requestedRole,
            returnTo,
          });
        }
      }
    }

    const redirectUrl = new URL(returnTo, request.nextUrl.origin);
    if (redirectScreen) redirectUrl.searchParams.set("screen", redirectScreen);
    redirectUrl.searchParams.set("line", "connected");
    redirectUrl.searchParams.set("role", toClientRole(resolvedRole));
    if (savedUserId) redirectUrl.searchParams.set("user", savedUserId);
    if (requestedRole === "club_staff" && !linkedClub) redirectUrl.searchParams.set("club", "unmatched");
    if (linkedClub) redirectUrl.searchParams.set("club", "linked");

    const response = NextResponse.redirect(redirectUrl);
    cleanupOAuthCookies(response);
    response.cookies.delete("maxvalue_admin_pending");
    response.cookies.set("maxvalue_line_user_id", profile.userId, {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 180,
      path: "/",
    });
    if (referralCode) {
      response.cookies.set("maxvalue_referral_code", referralCode, {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 14,
        path: "/",
      });
    }
    response.cookies.set("maxvalue_line_name", encodeURIComponent(profile.displayName), {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 180,
      path: "/",
    });
    response.cookies.set("maxvalue_line_display_name", encodeURIComponent(profile.displayName), {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 180,
      path: "/",
    });
    response.cookies.set("maxvalue_role", toClientRole(resolvedRole), {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 180,
      path: "/",
    });
    response.cookies.set("maxvalue_db_role", resolvedRole, {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 180,
      path: "/",
    });
    if (resolvedRole === "admin") {
      const adminSession = createAdminSessionToken(profile.userId);
      if (adminSession) {
        response.cookies.set(ADMIN_SESSION_COOKIE, adminSession, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: ADMIN_SESSION_MAX_AGE,
          path: "/",
        });
      }
    } else {
      response.cookies.delete(ADMIN_SESSION_COOKIE);
    }
    if (linkedClub) {
      response.cookies.set("maxvalue_club_id", linkedClub.id, {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 180,
        path: "/",
      });
      response.cookies.set("maxvalue_club_name", encodeURIComponent(linkedClub.display_name), {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 180,
        path: "/",
      });
    }
    if (profile.pictureUrl) {
      response.cookies.set("maxvalue_line_picture_url", encodeURIComponent(profile.pictureUrl), {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 180,
        path: "/",
      });
    } else {
      response.cookies.delete("maxvalue_line_picture_url");
    }
    return response;
  } catch (error) {
    safeReturnUrl.searchParams.set("line", "error");
    safeReturnUrl.searchParams.set("reason", "line_callback_failed");
    console.error("[line-callback] failed", {
      message: error instanceof Error ? error.message : "unknown",
      returnTo,
      requestedRole,
      hasCode: Boolean(code),
    });
    const response = NextResponse.redirect(safeReturnUrl);
    cleanupOAuthCookies(response);
    return response;
  }
}
