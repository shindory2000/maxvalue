import { loadEnvConfig } from "@next/env";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

type BubbleRow = Record<string, unknown> & { _id?: string; "Created Date"?: string; "Modified Date"?: string };
type RequiredEndpointName = "users" | "clubs" | "offers" | "offerResponses";
type OptionalEndpointName = "gachaItems" | "gachaResults";
type EndpointName = RequiredEndpointName | OptionalEndpointName;

const requiredEndpoints: Record<RequiredEndpointName, string> = {
  users: "/api/1.1/obj/user",
  clubs: "/api/1.1/obj/club",
  offers: "/api/1.1/obj/offer",
  offerResponses: "/api/1.1/obj/offerresponse",
};

const optionalEndpointCandidates: Record<OptionalEndpointName, string[]> = {
  gachaItems: [
    "/api/1.1/obj/gacha",
    "/api/1.1/obj/gacha_item",
    "/api/1.1/obj/gacha item",
    "/api/1.1/obj/ガチャ",
  ],
  gachaResults: [
    "/api/1.1/obj/gacha_result",
    "/api/1.1/obj/gacha result",
    "/api/1.1/obj/gacha_results",
    "/api/1.1/obj/ガチャ結果",
  ],
};

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const fullDryRun = args.has("--full") || commit;
const baseUrl = (process.env.BUBBLE_API_BASE_URL || "https://maxvalue.work").replace(/\/$/, "");
const bubbleToken = process.env.BUBBLE_API_TOKEN;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!bubbleToken) fail("BUBBLE_API_TOKEN is missing from .env.local");

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[\s\u00a0_\-・/（）()@：:]/g, "");
}

function pick(row: BubbleRow, aliases: string[]) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const wanted = normalizeKey(alias);
    const match = entries.find(([key]) => normalizeKey(key) === wanted);
    if (match && match[1] !== undefined && match[1] !== null && match[1] !== "") return match[1];
  }
  return undefined;
}

function pickByIncludes(row: BubbleRow, fragments: string[]) {
  const normalizedFragments = fragments.map(normalizeKey);
  const match = Object.entries(row).find(([key, value]) => {
    if (value === undefined || value === null || value === "") return false;
    const normalized = normalizeKey(key);
    return normalizedFragments.some(fragment => normalized.includes(fragment));
  });
  return match?.[1];
}

function text(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(text(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateValue(value: unknown) {
  const rendered = text(value);
  if (!rendered) return undefined;
  const date = new Date(rendered);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function referenceId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (Array.isArray(value)) return referenceId(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record._id || record.id || record.unique_id || record.slug) || null;
  }
  return null;
}

function imageUrl(value: unknown): string | null {
  if (typeof value === "string") {
    if (!value) return null;
    return value.startsWith("//") ? `https:${value}` : value;
  }
  if (Array.isArray(value)) return imageUrl(value[0]);
  if (value && typeof value === "object") return imageUrl((value as Record<string, unknown>).url);
  return null;
}

function imageUrls(value: unknown) {
  if (Array.isArray(value)) return value.map(imageUrl).filter((item): item is string => Boolean(item));
  const single = imageUrl(value);
  return single ? [single] : [];
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  return ["true", "yes", "1", "テスト", "test"].includes(text(value).toLowerCase());
}

function isTestRow(row: BubbleRow) {
  const explicit = pick(row, ["is_test", "is test", "test", "テスト", "テストデータ"]);
  if (explicit !== undefined) return booleanValue(explicit);
  const haystack = Object.values(row).filter(value => typeof value === "string").join(" ").toLowerCase();
  return /\btest\b|テスト/.test(haystack);
}

function roleValue(row: BubbleRow): "seeker" | "club_staff" | "admin" {
  const normalized = text(pick(row, ["role", "権限", "ユーザー種別", "type", "種別"])).toLowerCase();
  if (normalized.includes("admin") || normalized.includes("管理")) return "admin";
  if (normalized.includes("club") || normalized.includes("staff") || normalized.includes("店舗")) return "club_staff";
  return "seeker";
}

function offerStatus(value: unknown): "sent" | "interested" | "rejected" {
  const normalized = text(value).toLowerCase();
  if (normalized.includes("興味") || normalized.includes("interest") || normalized.includes("あり")) return "interested";
  if (normalized.includes("見送り") || normalized.includes("reject") || normalized.includes("なし")) return "rejected";
  return "sent";
}

function responseStatus(row: BubbleRow): "interested" | "rejected" {
  const value = pick(row, ["response", "回答", "offer関心度", "関心度", "興味", "status", "ステータス", "states", "interest"]) ??
    pickByIncludes(row, ["関心度"]);
  const normalized = text(value).toLowerCase();
  if (normalized.includes("興味") || normalized.includes("interest") || normalized.includes("interested") || normalized === "yes" || normalized === "true" || normalized === "あり") {
    return "interested";
  }
  return "rejected";
}

function extractLineUserId(value: unknown): string | null {
  const rendered = text(value);
  if (!rendered) return null;
  const match = rendered.match(/U[a-f0-9]{20,}/i);
  return match?.[0] || rendered;
}

async function bubbleRequest(endpoint: string, cursor: number, limit: number) {
  const url = new URL(endpoint, baseUrl);
  url.searchParams.set("cursor", String(cursor));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("api_token", bubbleToken as string);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bubbleToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${endpoint} returned ${response.status}: ${body.slice(0, 400)}`);
  }
  const payload = await response.json() as {
    response?: { results?: BubbleRow[]; cursor?: number; remaining?: number; count?: number };
    results?: BubbleRow[];
    cursor?: number;
    remaining?: number;
  };
  const container = payload.response || payload;
  return {
    results: container.results || [],
    cursor: container.cursor ?? cursor,
    remaining: container.remaining ?? 0,
  };
}

async function fetchRows(endpoint: string, inspectOnly: boolean) {
  if (inspectOnly) return (await bubbleRequest(endpoint, 0, 3)).results;
  const rows: BubbleRow[] = [];
  let cursor = 0;
  for (let page = 0; page < 100; page += 1) {
    const result = await bubbleRequest(endpoint, cursor, 100);
    rows.push(...result.results);
    if (!result.results.length || result.remaining <= 0) break;
    cursor = result.cursor + result.results.length;
  }
  return rows;
}

async function resolveOptionalEndpoint(name: OptionalEndpointName, inspectOnly: boolean) {
  for (const endpoint of optionalEndpointCandidates[name]) {
    try {
      const rows = await fetchRows(endpoint, inspectOnly);
      return { endpoint, rows };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/returned 404|returned 400/.test(message)) console.warn(`Optional ${name} failed at ${endpoint}: ${message}`);
    }
  }
  return { endpoint: null, rows: [] as BubbleRow[] };
}

function safeSample(row: BubbleRow) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (/token|secret|password/i.test(key)) return [key, "[redacted]"];
    const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
    return [key, rendered.length > 160 ? `${rendered.slice(0, 157)}...` : value];
  }));
}

function bubbleId(row: BubbleRow) {
  return text(row._id || pick(row, ["unique id", "id", "Slug"]), crypto.randomUUID());
}

function mapUser(row: BubbleRow) {
  const id = bubbleId(row);
  const nickname = text(pick(row, [
    "nickname", "ニックネーム", "name", "名前", "LINE name", "LINE表示名", "氏名",
  ]), "Bubble User");
  const lineUserId = text(pick(row, [
    "line_user_id", "line user id", "LINEID", "lineID", "LINEユーザーID", "LINE User ID", "LINE UserId",
  ]), `bubble_${id}`);
  const age = Math.min(99, Math.max(18, numberValue(pick(row, ["age", "年齢"]), 19)));
  const role = roleValue(row);
  const createdAt = dateValue(row["Created Date"]);
  const updatedAt = dateValue(row["Modified Date"]);
  return {
    user: {
      bubble_id: id,
      line_user_id: lineUserId,
      line_name: nickname,
      line_picture_url: imageUrl(pick(row, ["line_picture_url", "line_image", "LINE画像", "プロフィール画像", "profile image", "ProfilePhoto"])),
      role,
      created_at: createdAt,
      last_login_at: updatedAt,
      is_test: isTestRow(row),
      bubble_raw: row,
    },
    profile: {
      bubble_id: id,
      nickname,
      age,
      work_experience: text(pick(row, ["work_experience", "experience", "ナイトワーク経験", "ナイトワーク経験歴", "経験"]), "未回答"),
      desired_region: text(pick(row, ["desired_region", "region", "希望地域", "希望勤務地域", "希望勤務地域"]), "大阪"),
      desired_area: text(pick(row, ["desired_area", "希望エリア", "希望勤務地エリア"]), "北新地"),
      desired_shift: text(pick(row, ["desired_shift", "shift", "希望シフト", "勤務希望"]), "未回答"),
      start_timing: text(pick(row, ["start_timing", "available_flom", "available_from", "勤務開始予定", "勤務開始", "開始時期"]), "未回答"),
      current_region: text(pick(row, ["current_region", "現在地域", "現地域"])) || null,
      current_area: text(pick(row, ["current_area", "現在エリア", "現エリア"])) || null,
      current_hourly_range: text(pick(row, ["current_hourly_range", "hourlywagerange", "現在時給", "時給", "当時の時給"])) || null,
      current_monthly_sales_range: text(pick(row, ["current_monthly_sales_range", "現在月売", "月売"])) || null,
      photo_1_url: imageUrl(pick(row, ["photo_1_url", "image1", "顔1", "顔写真1", "プロフィール写真", "image", "画像1"])),
      photo_2_url: imageUrl(pick(row, ["photo_2_url", "image2", "顔2", "顔写真2", "画像2"])),
      full_body_photo_url: imageUrl(pick(row, ["full_body_photo_url", "image3", "全身", "全身写真", "画像3"])),
      invite_code: text(pick(row, ["invite_code", "referral_code", "紹介コード"]), `MV-BUBBLE-${id.replace(/[^a-zA-Z0-9]/g, "").slice(-24)}`),
      setup_completed: true,
      created_at: createdAt,
      updated_at: updatedAt,
      is_test: isTestRow(row),
      bubble_raw: row,
    },
  };
}

function mapClub(row: BubbleRow) {
  const id = bubbleId(row);
  const searchName = text(pick(row, ["search_name", "店前(検索用)", "店名(検索用)", "検索用"]), "名称未設定");
  const displayName = text(pick(row, ["display_name", "店名(表示用)", "店名", "店舗名", "name", "Name"]), searchName);
  const interior = [
    ...imageUrls(pick(row, ["interior_photo_urls", "内装写真", "内装", "店内写真"])),
    ...imageUrls(pick(row, ["image1", "内装1", "内装写真1", "interior_1"])),
    ...imageUrls(pick(row, ["image2", "内装2", "内装写真2", "interior_2"])),
    ...imageUrls(pick(row, ["image3", "内装3", "内装写真3", "interior_3"])),
  ];
  return {
    bubble_id: id,
    display_name: displayName,
    search_name: searchName.toLowerCase(),
    store_code: text(pick(row, ["store_code", "club_id", "お店ID", "店舗コード", "ID"])) || null,
    business_type: text(pick(row, ["business_type", "club業態", "業態", "ジャンル"]), "未設定"),
    region: text(pick(row, ["region", "地域", "都道府県"]), "未設定"),
    area: text(pick(row, ["area", "エリア"]), "未設定"),
    appeal_text: text(pick(row, ["appeal_text", "お店の魅力", "魅力", "紹介文"])) || null,
    logo_url: imageUrl(pick(row, ["logo_url", "club_logo_image", "club_logo", "ロゴ", "logo", "画像", "店舗画像"])),
    instagram_url: text(pick(row, ["instagram_url", "Instagram", "お店Instagram URL", "instagram"])) || null,
    interior_photo_urls: [...new Set(interior)].slice(0, 6),
    is_active: !booleanValue(pick(row, ["deleted", "無効", "is_deleted", "削除"])),
    created_at: dateValue(row["Created Date"]),
    updated_at: dateValue(row["Modified Date"]),
    is_test: isTestRow(row),
    bubble_raw: row,
  };
}

function mapOffer(row: BubbleRow) {
  const rawStatus = pick(row, ["status", "ステータス", "回答", "関心度"]);
  return {
    bubble_id: bubbleId(row),
    seeker_bubble_id: referenceId(pick(row, ["seeker", "user", "求職者", "対象人物", "送信先", "ユーザー", "receiver"])),
    club_bubble_id: referenceId(pick(row, ["club", "店舗", "オファー店舗", "送信元", "お店", "sender"])),
    staff_bubble_id: referenceId(pick(row, ["staff", "担当者", "club staff", "店舗スタッフ"])),
    hourly_wage: Math.max(1, numberValue(pick(row, ["hourly_wage", "想定時給", "オファー時給", "時給"]), 1)),
    guarantee_period: text(pick(row, ["guarantee_period", "保証期間", "期間"]), "未設定"),
    comment: text(pick(row, ["comment", "コメント", "メモ", "一言"])).slice(0, 30) || null,
    status: offerStatus(rawStatus),
    created_at: dateValue(row["Created Date"]),
    is_test: isTestRow(row),
    bubble_raw: row,
  };
}

function mapOfferResponse(row: BubbleRow) {
  return {
    bubble_id: bubbleId(row),
    offer_bubble_id: referenceId(pick(row, ["offer", "オファー", "Offer"])),
    seeker_bubble_id: referenceId(pick(row, ["seeker", "user", "求職者", "回答者", "ユーザー"])),
    line_user_id: extractLineUserId(pick(row, ["lineuserid", "line_user_id", "LINEユーザーID"])),
    response: responseStatus(row),
    created_at: dateValue(row["Created Date"]),
    is_test: isTestRow(row),
    bubble_raw: row,
  };
}

function mapGachaItem(row: BubbleRow) {
  const id = bubbleId(row);
  const rawTicket = text(pick(row, ["ticket_type", "チケット種別", "種別", "type"])).toLowerCase();
  const minRange = numberValue(pick(row, ["minrange", "min_range", "最小", "下限"]), 0);
  const maxRange = numberValue(pick(row, ["maxrange", "max_range", "最大", "上限"]) ?? pickByIncludes(row, ["maxrange"]), 0);
  const probability = numberValue(pick(row, ["probability", "確率", "排出率"]), maxRange > minRange ? (maxRange - minRange) / 100 : 0.01);
  return {
    bubble_id: id,
    name: text(pick(row, ["item", "name", "景品名", "景品", "名前"]), "景品未設定"),
    rarity: text(pick(row, ["rarity", "レアリティ", "ランク"]), maxRange >= 99 ? "UR" : maxRange >= 90 ? "SSR" : maxRange >= 50 ? "SR" : "R"),
    image_url: imageUrl(pick(row, ["image", "画像", "image_url", "景品画像"])),
    probability: probability > 1 ? probability / 100 : probability,
    description: text(pick(row, ["description", "説明", "説明文", "説明"]), text(pickByIncludes(row, ["説明"]), "")) || null,
    ticket_type: rawTicket.includes("面接") || rawTicket.includes("interview") ? "interview" as const : "registration_invite" as const,
    is_active: !booleanValue(pick(row, ["inactive", "無効", "停止"])),
    is_test: isTestRow(row),
    bubble_raw: row,
  };
}

function mapGachaResult(row: BubbleRow) {
  const rawStatus = text(pick(row, ["used_status", "使用状況", "status", "States", "states"]), "unused").toLowerCase();
  return {
    bubble_id: bubbleId(row),
    user_bubble_id: referenceId(pick(row, ["user", "ユーザー", "求職者", "owner"])),
    gacha_item_bubble_id: referenceId(pick(row, ["gacha", "ガチャ", "item", "景品", "gacha item", "Prize", "prize"])),
    item_name: text(pick(row, ["item", "景品名", "景品", "name"])),
    ticket_type: text(pick(row, ["ticket_type", "チケット種別", "種別"])).includes("面接") ? "interview" as const : "registration_invite" as const,
    used_status: rawStatus.includes("done") || rawStatus.includes("complete") || rawStatus.includes("利用済") ? "completed" :
      rawStatus.includes("request") || rawStatus.includes("依頼") ? "requested" : "unused",
    created_at: dateValue(row["Created Date"]),
    is_test: isTestRow(row),
    bubble_raw: row,
  };
}

async function inspect() {
  const report: Record<string, unknown> = {};
  for (const [name, endpoint] of Object.entries(requiredEndpoints) as [RequiredEndpointName, string][]) {
    const rows = await fetchRows(endpoint, true);
    report[name] = endpointReport(name, endpoint, rows);
  }
  for (const name of Object.keys(optionalEndpointCandidates) as OptionalEndpointName[]) {
    const { endpoint, rows } = await resolveOptionalEndpoint(name, true);
    report[name] = endpointReport(name, endpoint || "(not found)", rows);
  }
  await writeFile(path.join(process.cwd(), "outputs", "bubble-inspection.json"), JSON.stringify(report, null, 2));
  console.dir(report, { depth: 7 });
  console.log("\nInspection written to outputs/bubble-inspection.json");
}

function endpointReport(name: EndpointName, endpoint: string, rows: BubbleRow[]) {
  return {
    endpoint,
    count: rows.length,
    fields: [...new Set(rows.flatMap(row => Object.keys(row)))].sort(),
    samples: rows.map(safeSample),
    mapped: rows.map(row =>
      name === "users" ? mapUser(row) :
      name === "clubs" ? mapClub(row) :
      name === "offers" ? mapOffer(row) :
      name === "offerResponses" ? mapOfferResponse(row) :
      name === "gachaItems" ? mapGachaItem(row) : mapGachaResult(row),
    ),
  };
}

async function upsertOne(client: SupabaseClient, table: string, row: Record<string, unknown>, conflict: string) {
  const clean = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  const { data, error } = await client.from(table).upsert(clean, { onConflict: conflict }).select("id,bubble_id").single();
  if (error) throw new Error(`${table} ${text(row.bubble_id)}: ${error.message}`);
  return data as { id: string; bubble_id: string | null };
}

async function assertBubbleSchema(client: SupabaseClient) {
  const checks = [
    ["users", "id,bubble_id"],
    ["seeker_profiles", "id,bubble_id"],
    ["clubs", "id,bubble_id"],
    ["offers", "id,bubble_id"],
    ["offer_responses", "id,bubble_id"],
    ["gacha_items", "id,bubble_id"],
    ["gacha_results", "id,bubble_id"],
  ] as const;
  for (const [table, select] of checks) {
    const { error } = await client.from(table).select(select).limit(1);
    if (error) {
      throw new Error(`Supabase schema is not ready for Bubble import. Run outputs/maxvalue_supabase_setup.sql in SQL Editor first. Missing check: ${table}.${select}. ${error.message}`);
    }
  }
}

async function fetchAllBubble() {
  const entries = await Promise.all(
    (Object.entries(requiredEndpoints) as [RequiredEndpointName, string][]).map(async ([name, endpoint]) => [name, await fetchRows(endpoint, false)]),
  );
  const optional = await Promise.all(
    (Object.keys(optionalEndpointCandidates) as OptionalEndpointName[]).map(async name => {
      const resolved = await resolveOptionalEndpoint(name, false);
      return [name, resolved.rows] as const;
    }),
  );
  return Object.fromEntries([...entries, ...optional]) as Record<EndpointName, BubbleRow[]>;
}

async function migrate() {
  const raw = await fetchAllBubble();
  const mappedUsers = raw.users.map(mapUser);
  const mappedClubs = raw.clubs.map(mapClub);
  const mappedOffers = raw.offers.map(mapOffer);
  const mappedResponses = raw.offerResponses.map(mapOfferResponse);
  const mappedGachaItems = raw.gachaItems.map(mapGachaItem);
  const mappedGachaResults = raw.gachaResults.map(mapGachaResult);
  const dryRunReport = {
    mode: commit ? "commit" : "dry-run",
    sourceCounts: Object.fromEntries(Object.entries(raw).map(([key, rows]) => [key, rows.length])),
    mappedCounts: {
      users: mappedUsers.length,
      seekerProfiles: mappedUsers.filter(item => item.user.role === "seeker").length,
      clubs: mappedClubs.length,
      offers: mappedOffers.length,
      offerResponses: mappedResponses.length,
      gachaItems: mappedGachaItems.length,
      gachaResults: mappedGachaResults.length,
    },
    sampleMappings: {
      user: mappedUsers[0],
      club: mappedClubs[0],
      offer: mappedOffers[0],
      offerResponse: mappedResponses[0],
      gachaItem: mappedGachaItems[0],
      gachaResult: mappedGachaResults[0],
    },
  };
  console.dir(dryRunReport, { depth: 7 });
  await writeFile(path.join(process.cwd(), "outputs", "bubble-dry-run.json"), JSON.stringify(dryRunReport, null, 2));
  if (!commit) return;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("--commit requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await assertBubbleSchema(client);

  const skipped: { type: string; bubble_id: string; reason: string }[] = [];
  const userIds = new Map<string, string>();
  const profileIds = new Map<string, string>();
  const profileIdsByLineUserId = new Map<string, string>();
  for (const item of mappedUsers) {
    const savedUser = await upsertOne(client, "users", item.user, "line_user_id");
    userIds.set(item.user.bubble_id, savedUser.id);
    if (item.user.role === "seeker") {
      const profile = { ...item.profile, user_id: savedUser.id };
      const savedProfile = await upsertOne(client, "seeker_profiles", profile, "bubble_id");
      profileIds.set(item.user.bubble_id, savedProfile.id);
      profileIdsByLineUserId.set(item.user.line_user_id, savedProfile.id);
    }
  }

  const unknownGachaOwner = await upsertOne(client, "users", {
    line_user_id: "bubble_unknown_gacha_owner",
    line_name: "Bubble gacha owner unknown",
    role: "seeker",
    is_test: true,
    bubble_id: "bubble_unknown_gacha_owner",
    bubble_raw: { source: "Bubble gacha result without user reference" },
  }, "line_user_id");

  const clubIds = new Map<string, string>();
  for (const club of mappedClubs) {
    const { data: existingByName } = await client
      .from("clubs")
      .select("id")
      .eq("display_name", club.display_name)
      .eq("area", club.area)
      .maybeSingle();
    const saved = await upsertOne(
      client,
      "clubs",
      existingByName ? { ...club, id: existingByName.id } : club,
      existingByName ? "id" : "bubble_id",
    );
    clubIds.set(club.bubble_id, saved.id);
  }

  async function ensurePlaceholderClub(bubbleId: string | null | undefined) {
    const placeholderBubbleId = bubbleId || "bubble_unknown_offer_club";
    const existing = clubIds.get(placeholderBubbleId);
    if (existing) return existing;
    const saved = await upsertOne(client, "clubs", {
      bubble_id: placeholderBubbleId,
      display_name: bubbleId ? `Bubble未取得店舗 ${bubbleId}` : "Bubble参照なし店舗",
      search_name: bubbleId ? `bubble_missing_${bubbleId}` : "bubble_unknown_offer_club",
      store_code: bubbleId ? `bubble_missing_${bubbleId.slice(-12)}` : "bubble_unknown",
      business_type: "未設定",
      region: "未設定",
      area: "未設定",
      appeal_text: "BubbleのOfferに店舗参照が無い、または取得対象外だったため自動作成しました。",
      logo_url: null,
      instagram_url: null,
      interior_photo_urls: [],
      is_active: false,
      is_test: true,
      bubble_raw: { source: "placeholder", bubble_id: placeholderBubbleId },
    }, "bubble_id");
    clubIds.set(placeholderBubbleId, saved.id);
    return saved.id;
  }

  const gachaItemIds = new Map<string, string>();
  const gachaItemIdsByName = new Map<string, string>();
  for (const item of mappedGachaItems) {
    const { data: existingByTicketName } = await client
      .from("gacha_items")
      .select("id")
      .eq("ticket_type", item.ticket_type)
      .eq("name", item.name)
      .maybeSingle();
    const saved = await upsertOne(
      client,
      "gacha_items",
      existingByTicketName ? { ...item, id: existingByTicketName.id } : item,
      existingByTicketName ? "id" : "bubble_id",
    );
    gachaItemIds.set(item.bubble_id, saved.id);
    gachaItemIdsByName.set(`${item.ticket_type}:${item.name}`, saved.id);
  }

  async function ensurePlaceholderUser(bubbleId: string | null | undefined) {
    const placeholderBubbleId = bubbleId || "bubble_unknown_gacha_owner";
    const existing = userIds.get(placeholderBubbleId);
    if (existing) return existing;
    const saved = await upsertOne(client, "users", {
      line_user_id: `bubble_missing_${placeholderBubbleId}`,
      line_name: bubbleId ? `Bubble未取得ユーザー ${bubbleId}` : "Bubble gacha owner unknown",
      role: "seeker",
      is_test: true,
      bubble_id: placeholderBubbleId,
      bubble_raw: { source: "placeholder", bubble_id: placeholderBubbleId },
    }, "line_user_id");
    userIds.set(placeholderBubbleId, saved.id);
    return saved.id;
  }

  async function ensurePlaceholderGachaItem(bubbleId: string | null | undefined, ticketType: "registration_invite" | "interview", itemName?: string) {
    const placeholderBubbleId = bubbleId || `bubble_unknown_gacha_item_${ticketType}`;
    const existing = gachaItemIds.get(placeholderBubbleId);
    if (existing) return existing;
    const name = itemName || (bubbleId ? `Bubble未取得景品 ${bubbleId}` : `Bubble参照なし景品 ${ticketType}`);
    const saved = await upsertOne(client, "gacha_items", {
      bubble_id: placeholderBubbleId,
      name,
      rarity: "R",
      image_url: null,
      probability: 0,
      description: "Bubbleのガチャ履歴に景品参照が無い、または取得対象外だったため自動作成しました。",
      ticket_type: ticketType,
      is_active: false,
      is_test: true,
      bubble_raw: { source: "placeholder", bubble_id: placeholderBubbleId },
    }, "bubble_id");
    gachaItemIds.set(placeholderBubbleId, saved.id);
    gachaItemIdsByName.set(`${ticketType}:${name}`, saved.id);
    return saved.id;
  }

  const offerIds = new Map<string, string>();
  for (const offer of mappedOffers) {
    const seekerId = offer.seeker_bubble_id ? profileIds.get(offer.seeker_bubble_id) : undefined;
    const clubId = offer.club_bubble_id ? (clubIds.get(offer.club_bubble_id) || await ensurePlaceholderClub(offer.club_bubble_id)) : await ensurePlaceholderClub(null);
    const saved = await upsertOne(client, "offers", {
      bubble_id: offer.bubble_id,
      seeker_id: seekerId || null,
      club_id: clubId,
      staff_id: null,
      hourly_wage: offer.hourly_wage,
      guarantee_period: offer.guarantee_period,
      comment: offer.comment,
      status: offer.status,
      created_at: offer.created_at,
      is_test: offer.is_test,
      bubble_raw: offer.bubble_raw,
    }, "bubble_id");
    offerIds.set(offer.bubble_id, saved.id);
  }

  for (const response of mappedResponses) {
    const offerId = response.offer_bubble_id ? offerIds.get(response.offer_bubble_id) : undefined;
    let seekerId = response.seeker_bubble_id ? profileIds.get(response.seeker_bubble_id) : undefined;
    if (!seekerId && response.line_user_id) seekerId = profileIdsByLineUserId.get(response.line_user_id);
    if (!seekerId && offerId) {
      const { data } = await client.from("offers").select("seeker_id").eq("id", offerId).single();
      seekerId = data?.seeker_id;
    }
    await upsertOne(client, "offer_responses", {
      bubble_id: response.bubble_id,
      offer_id: offerId || null,
      seeker_id: seekerId || null,
      response: response.response,
      created_at: response.created_at,
      line_payload: response.bubble_raw,
      is_test: response.is_test,
      bubble_raw: response.bubble_raw,
    }, "bubble_id");
  }

  for (const result of mappedGachaResults) {
    const userId = result.user_bubble_id ? (userIds.get(result.user_bubble_id) || await ensurePlaceholderUser(result.user_bubble_id)) : unknownGachaOwner.id;
    const itemId = (result.gacha_item_bubble_id ? gachaItemIds.get(result.gacha_item_bubble_id) : undefined) ||
      (result.item_name ? gachaItemIdsByName.get(`${result.ticket_type}:${result.item_name}`) : undefined) ||
      await ensurePlaceholderGachaItem(result.gacha_item_bubble_id, result.ticket_type, result.item_name);
    const ticket = await upsertOne(client, "gacha_tickets", {
      bubble_id: `ticket_${result.bubble_id}`,
      user_id: userId,
      ticket_type: result.ticket_type,
      source: "admin_grant",
      used_at: result.created_at,
      created_at: result.created_at,
      is_test: result.is_test,
      bubble_raw: result.bubble_raw,
    }, "bubble_id");
    await upsertOne(client, "gacha_results", {
      bubble_id: result.bubble_id,
      user_id: userId,
      gacha_item_id: itemId,
      ticket_id: ticket.id,
      created_at: result.created_at,
      used_status: ["requested", "completed"].includes(result.used_status) ? result.used_status : "unused",
      is_test: result.is_test,
      bubble_raw: result.bubble_raw,
    }, "bubble_id");
  }

  const report = await countReport(client);
  const finalReport = { committed: true, counts: report, skipped };
  await writeFile(path.join(process.cwd(), "outputs", "bubble-import-report.json"), JSON.stringify(finalReport, null, 2));
  console.dir(finalReport, { depth: 6 });
  console.log("Bubble import committed successfully. Report written to outputs/bubble-import-report.json");
}

async function countReport(client: SupabaseClient) {
  const tables = ["users", "seeker_profiles", "clubs", "offers", "offer_responses", "gacha_items", "gacha_results"] as const;
  const pairs = await Promise.all(tables.map(async table => {
    const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`${table} count failed: ${error.message}`);
    return [table, count || 0] as const;
  }));
  return Object.fromEntries(pairs);
}

async function main() {
  if (!fullDryRun) await inspect();
  else await migrate();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
