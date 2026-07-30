import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const accountRoles = ["seeker", "club_staff", "ambassador", "admin"] as const;
type AccountRole = (typeof accountRoles)[number];
type AccountRow = {
  id: string;
  role?: string | null;
  line_name?: string | null;
  line_picture_url?: string | null;
  line_user_id?: string | null;
  is_deleted?: boolean | null;
  deleted_at?: string | null;
  bubble_raw?: Record<string, unknown> | null;
  created_at?: string | null;
};
type StaffRow = {
  user_id: string;
  club_id: string | null;
  staff_name?: string | null;
  clubs?: { display_name?: string | null } | Array<{ display_name?: string | null }> | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isAccountRole(value: string): value is AccountRole {
  return (accountRoles as readonly string[]).includes(value);
}

function dbRoleFor(role: AccountRole): "seeker" | "club_staff" | "admin" {
  return role === "ambassador" ? "seeker" : role;
}

function inviteCodeFor(userId: string) {
  return `AM-${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || Date.now().toString(36)}`;
}

async function serializeAccounts(supabase: NonNullable<ReturnType<typeof getSupabaseServer>>, rows: AccountRow[]) {
  const userIds = rows.map(user => user.id).filter(Boolean);
  const { data: staffs } = userIds.length
    ? await supabase
      .from("club_staffs")
      .select("user_id,club_id,staff_name,clubs(display_name)")
      .in("user_id", userIds)
    : { data: [] };
  const staffMap = new Map((Array.isArray(staffs) ? staffs as StaffRow[] : []).map(staff => [staff.user_id, staff]));
  const referredBy = new Map<string, Array<{ id: string; name: string; picture_url: string | null }>>();
  for (const candidate of rows) {
    const candidateRaw = asRecord(candidate.bubble_raw);
    const inviterId = String(candidateRaw.invited_by_user_id || "");
    if (!inviterId) continue;
    const current = referredBy.get(inviterId) || [];
    current.push({
      id: candidate.id,
      name: candidate.line_name || "紹介ユーザー",
      picture_url: candidate.line_picture_url || null,
    });
    referredBy.set(inviterId, current);
  }
  return rows.map(user => {
    const staff = staffMap.get(user.id);
    const club = Array.isArray(staff?.clubs) ? staff?.clubs[0] : staff?.clubs;
    const raw = asRecord(user.bubble_raw);
    const extra = asRecord(raw.admin_extra);
    const referrals = referredBy.get(user.id) || [];
    return {
      ...user,
      role: extra.effective_role || user.role,
      name: user.line_name || staff?.staff_name || "名前未設定",
      club_id: staff?.club_id || null,
      club_name: club?.display_name || null,
      referral_count: referrals.length,
      referrals,
    };
  });
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: users, error } = await supabase
    .from("users")
    .select("id,role,line_name,line_picture_url,line_user_id,bubble_raw,created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (Array.isArray(users) ? users as AccountRow[] : []).filter(user => {
    const raw = asRecord(user.bubble_raw);
    const legacyDeleted = asRecord(raw.admin_deleted);
    return !user.is_deleted && !user.deleted_at && !legacyDeleted.is_deleted && !raw.is_deleted;
  });
  return NextResponse.json(await serializeAccounts(supabase, rows));
}

export async function PATCH(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const userId = String(body.userId || body.id || "");
  const role = String(body.role || "");
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (!isAccountRole(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id,role,line_name,line_picture_url,line_user_id,bubble_raw,created_at")
    .eq("id", userId)
    .maybeSingle();
  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const raw = asRecord((user as AccountRow).bubble_raw);
  const adminExtra = asRecord(raw.admin_extra);
  const ambassadorProfile = asRecord(raw.ambassador_profile);
  const nextRaw: Record<string, unknown> = {
    ...raw,
    admin_extra: {
      ...adminExtra,
      effective_role: role,
    },
  };
  if (role === "ambassador" && !raw.ambassador_profile) {
    nextRaw.ambassador_profile = {
      name: (user as AccountRow).line_name || "名前未設定",
      region: ambassadorProfile.region || "",
      photo_url: (user as AccountRow).line_picture_url || "",
      invite_code: ambassadorProfile.invite_code || inviteCodeFor(userId),
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("users")
    .update({
      role: dbRoleFor(role),
      bubble_raw: nextRaw,
    })
    .eq("id", userId)
    .select("id,role,line_name,line_picture_url,line_user_id,bubble_raw,created_at")
    .maybeSingle();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "User update failed" }, { status: 500 });

  const [serialized] = await serializeAccounts(supabase, [updated as AccountRow]);
  return NextResponse.json(serialized);
}
