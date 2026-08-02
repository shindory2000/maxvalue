"use client";

import { getSupabase } from "../supabase";
import {
  AdminGachaResultRecord, AdminOfferRecord, ClubRecord, GachaItemRecord, GachaState, OfferRecord, SeekerProfileInput,
  SeekerProfileRecord, SeekerRecord,
} from "./types";

function requireSupabase() {
  const client = getSupabase();
  if (!client) throw new Error("Supabase is not configured");
  return client;
}

let inMemoryTemporaryLineUserId = "";

function createTemporaryLineUserId() {
  const cryptoLike = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoLike && "randomUUID" in cryptoLike) {
    return `temp_${cryptoLike.randomUUID()}`;
  }
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readCookie(name: string) {
  if (typeof document === "undefined") return "";
  const entry = document.cookie
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(`${name}=`));
  if (!entry) return "";
  let value = entry.slice(name.length + 1);
  // Older LINE callbacks encoded display names before Next.js encoded the
  // cookie again. Decode a few times so existing users are repaired without
  // requiring another login.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      break;
    }
  }
  return value;
}

export function ensureTemporaryLineUserId() {
  const key = "maxvalue_temporary_line_user_id";
  if (typeof window === "undefined") {
    if (!inMemoryTemporaryLineUserId) inMemoryTemporaryLineUserId = createTemporaryLineUserId();
    return inMemoryTemporaryLineUserId;
  }
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const generated = createTemporaryLineUserId();
    window.localStorage.setItem(key, generated);
    return generated;
  } catch {
    if (!inMemoryTemporaryLineUserId) inMemoryTemporaryLineUserId = createTemporaryLineUserId();
    return inMemoryTemporaryLineUserId;
  }
}

export function isTemporaryLineUserId(lineUserId: string) {
  return lineUserId.startsWith("temp_");
}

export function getActiveLineUserId() {
  return readCookie("maxvalue_line_user_id") || ensureTemporaryLineUserId();
}

export function getActiveLinePictureUrl() {
  return readCookie("maxvalue_line_picture_url");
}

export function getActiveLineDisplayName() {
  return readCookie("maxvalue_line_display_name") || readCookie("maxvalue_line_name");
}

export function getReferralCode() {
  return readCookie("maxvalue_referral_code");
}

export async function bootstrapTemporaryUser(lineUserId: string, lineName = "仮LINEユーザー") {
  if (!isTemporaryLineUserId(lineUserId)) return null;
  const client = requireSupabase();
  const { data, error } = await client.rpc("bootstrap_temporary_user", {
    p_line_user_id: lineUserId,
    p_line_name: lineName,
  });
  if (error) throw error;
  return data;
}

export async function fetchClubs(): Promise<ClubRecord[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("clubs")
    .select("id,display_name,search_name,kana_name,store_code,business_type,region,area,appeal_text,logo_url,instagram_url,interior_photo_urls,profile,updated_at")
    .eq("is_active", true)
    .order("display_name");
  if (error) throw error;
  return Array.isArray(data) ? data as ClubRecord[] : [];
}

export async function fetchSeekers(clubId = ""): Promise<SeekerRecord[]> {
  const query = clubId ? `?clubId=${encodeURIComponent(clubId)}` : "";
  const response = await fetch(`/api/seekers${query}`, { cache: "no-store" });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data?.detail || data?.error || "求職者一覧の取得に失敗しました");
  return Array.isArray(data) ? data as SeekerRecord[] : [];
}

export async function fetchOffers(lineUserId: string): Promise<OfferRecord[]> {
  const response = await fetch(`/api/offers?lineUserId=${encodeURIComponent(lineUserId)}`, { cache: "no-store" });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.error || "オファーの取得に失敗しました");
  return Array.isArray(data) ? data as OfferRecord[] : [];
}

export async function fetchAdminOffers(): Promise<AdminOfferRecord[]> {
  const response = await fetch("/api/admin/sales", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "オファー一覧の取得に失敗しました");
  return Array.isArray(data.offers) ? data.offers.map((offer: Record<string, unknown>) => ({ ...offer, bubble_id: null, seeker_name: offer.user_name, is_test: false })) as AdminOfferRecord[] : [];
}

export async function saveSeekerProfile(lineUserId: string, profile: SeekerProfileInput) {
  const response = await fetch("/api/seeker/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lineUserId, ...profile }),
  });
  if (response.ok) return response.json();

  const json = await response.json().catch(() => ({}));
  throw new Error(json.detail || json.error || "プロフィール保存に失敗しました。入力内容と写真アップロードを確認してください。");
}

export async function fetchSeekerProfile(lineUserId: string): Promise<SeekerProfileRecord | null> {
  const response = await fetch(`/api/seeker/profile?lineUserId=${encodeURIComponent(lineUserId)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "プロフィールの取得に失敗しました");
  return data as SeekerProfileRecord;
}

export async function fetchGachaItems(
  ticketType?: "registration_invite" | "interview",
): Promise<GachaItemRecord[]> {
  const client = requireSupabase();
  let query = client
    .from("gacha_items")
    .select("id,name,rarity,description,image_url,probability,ticket_type")
    .eq("is_active", true)
    .order("probability", { ascending: true });
  if (ticketType) query = query.eq("ticket_type", ticketType);
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data as GachaItemRecord[] : [];
}

export async function fetchAdminGachaResults(): Promise<AdminGachaResultRecord[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_admin_gacha_results");
  if (error) throw error;
  return Array.isArray(data) ? data as AdminGachaResultRecord[] : [];
}

export async function fetchGachaState(lineUserId: string): Promise<GachaState> {
  const response = await fetch("/api/gacha/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lineUserId }),
  });
  const data = await response.json().catch(() => ({})) as Partial<GachaState> & { detail?: string; error?: string };
  if (!response.ok) throw new Error(data.detail || data.error || "ガチャ状態の取得に失敗しました");
  return {
    registration_invite: Number(data.registration_invite || 0),
    interview: Number(data.interview || 0),
    results: Array.isArray(data.results) ? data.results : [],
    rank: String(data.rank || "A"),
  };
}

export async function spinGacha(lineUserId: string, ticketType: "registration_invite" | "interview"): Promise<GachaItemRecord> {
  const response = await fetch("/api/gacha/spin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lineUserId, ticketType }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.detail || json.error || "ガチャの実行に失敗しました");
  return json as GachaItemRecord;
}
