"use client";

// The application shell is intentionally client-driven because LINE's in-app
// browser returns users to role-specific screens through query parameters.

import {
  ArrowLeft, ArrowRight, BadgeCheck, BarChart3, Bell, Building2, CalendarDays,
  Camera, Check, ChevronRight, CircleUserRound, Clock3, Copy, Crown, Gift,
  Heart, Home, ImagePlus, LayoutGrid, LineChart, LockKeyhole, LogOut, Mail,
  LoaderCircle, MapPin, Menu, MessageCircle, Search, Send, ShieldCheck, Sparkles,
  Star, Store, Ticket, UserRound, Users, WalletCards, X
} from "lucide-react";
import { Component, CSSProperties, FormEvent, ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo } from "react";
import { motion } from "framer-motion";
import {
  bootstrapTemporaryUser, ensureTemporaryLineUserId, getActiveLineUserId,
  getActiveLinePictureUrl, getReferralCode, fetchAdminGachaResults,
  fetchAdminOffers, fetchClubs, fetchGachaItems, fetchGachaState, fetchOffers,
  fetchSeekerProfile, fetchSeekers,
  saveSeekerProfile, spinGacha,
} from "@/lib/supabase/data";
import type {
  AdminGachaResultRecord, AdminOfferRecord, ClubRecord, GachaItemRecord,
  OfferRecord, SeekerProfileRecord, SeekerRecord,
} from "@/lib/supabase/types";
import {
  companyContent, landingStories, privacyContent, termsContent,
} from "@/content/site-content";

type Role = "guest" | "seeker" | "club" | "admin";
type Screen =
  | "landing" | "signin" | "friendAdd" | "instagramGate" | "setup" | "offers" | "gacha" | "profile" | "photoEdit" | "profileEdit" | "ambassadorSetup" | "ambassadorProfile"
  | "clubSignin" | "clubSetup" | "talent" | "sentOffers" | "clubProfile"
  | "adminSignin" | "adminUsers" | "adminClubs" | "sales";

const validScreens = [
  "landing", "signin", "friendAdd", "instagramGate", "setup", "offers", "gacha", "profile", "photoEdit", "profileEdit", "ambassadorSetup", "ambassadorProfile",
  "clubSignin", "clubSetup", "talent", "sentOffers", "clubProfile",
  "adminSignin", "adminUsers", "adminClubs", "sales",
] as const satisfies readonly Screen[];

const seekerProtectedScreens: readonly Screen[] = [
  "friendAdd", "setup", "offers", "gacha", "profile", "photoEdit", "profileEdit",
];
const clubProtectedScreens: readonly Screen[] = ["clubSetup", "talent", "sentOffers", "clubProfile"];
const ambassadorProtectedScreens: readonly Screen[] = ["ambassadorSetup", "ambassadorProfile"];
const adminProtectedScreens: readonly Screen[] = ["adminUsers", "adminClubs", "sales"];

const regionAreas = {
  "大阪": ["北新地", "ミナミ"],
  "東京": ["六本木", "銀座", "歌舞伎町"],
} as const;

type Region = keyof typeof regionAreas;
const talentHues = ["rose", "sand", "night", "lilac", "blue", "peach"];
const LINE_FRIEND_URL = process.env.NEXT_PUBLIC_LINE_FRIEND_URL || "https://lin.ee/QoHrKN8";
type AdminAccountRole = "seeker" | "club_staff" | "ambassador" | "admin";

type AdminViewMode = "admin" | "club" | "seeker" | "ambassador";
type AdminCapabilityContextValue = {
  isAdmin: boolean;
  mode: AdminViewMode;
  selectedClub: ClubRecord | null;
  switchMode: (mode: AdminViewMode) => void;
};
const AdminCapabilityContext = createContext<AdminCapabilityContextValue>({
  isAdmin: false,
  mode: "seeker",
  selectedClub: null,
  switchMode: () => undefined,
});

function useAdminCapability() {
  return useContext(AdminCapabilityContext);
}

type AdminSeekerRecord = SeekerRecord & {
  current_club?: string | null;
  blocked_clubs?: string[];
  current_hourly_range?: string | null;
  current_monthly_sales_range?: string | null;
  gacha_ticket_count?: number;
  rank?: string | null;
  role?: Role | "club_staff" | "ambassador" | null;
  staff_club_id?: string | null;
  staff_club_name?: string | null;
  past_offers?: SeekerPastOfferRecord[];
};

type SeekerPastOfferRecord = {
  id: string;
  club_id?: string | null;
  club_name?: string | null;
  club_logo_url?: string | null;
  created_at: string;
  hourly_wage: number;
  guarantee_period: string;
  comment: string | null;
  status: "interested" | "rejected" | "no_response" | "sent";
  response_status?: string | null;
  next_action?: string | null;
  selected_date?: string | null;
  offered_hourly_wage?: number | null;
  response_source?: string | null;
};

type AdminClubRecord = ClubRecord & {
  staff_count?: number;
  offer_count?: number;
  permission_code?: string | null;
  bubble_raw?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
};

type AdminSalesResponse = {
  totals: { interested: number; rejected: number; no_response: number; total: number };
  by_club: { name: string; interested: number; rejected: number; no_response: number; total: number }[];
  by_user: { name: string; interested: number; rejected: number; no_response: number; total: number }[];
  unlinked_visit_count?: number;
  clubs?: { id: string; name: string }[];
  seekers?: { id: string; name: string }[];
  admin_staff?: { id: string; name: string }[];
  visits?: SalesVisitRecord[];
  leads?: SalesLeadRecord[];
  offers: {
    id: string;
    club_name: string;
    user_name: string;
    area: string;
    hourly_wage: number;
    guarantee_period: string;
    comment: string | null;
    status: "interested" | "rejected" | "no_response";
    response_status?: string | null;
    next_action?: string | null;
    selected_date?: string | null;
    offered_hourly_wage?: number | null;
    response_source?: string | null;
    workflow_status?: string | null;
    outcome?: Record<string, unknown> | null;
    created_at: string;
  }[];
};

type SalesVisitRecord = {
  id: string;
  visit_date: string;
  visit_purpose: string;
  club_name: string;
  seeker_name?: string | null;
  assigned_staff_name: string;
  budget: number;
  result_saved?: boolean;
};

type SalesLeadRecord = {
  id: string;
  club_name: string;
  name: string;
  age: number | null;
  rank: string | null;
  potential: string | null;
  scout_status: string | null;
  assigned_staff_name: string | null;
  next_action: string | null;
  last_contact_at: string | null;
};

function isScreen(value: unknown): value is Screen {
  return typeof value === "string" && (validScreens as readonly string[]).includes(value);
}

function safeArray<T>(value: T[] | readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? [...value] : [];
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatYen(value: unknown) {
  return safeNumber(value).toLocaleString("ja-JP");
}

function formatDateTime(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("ja-JP") : "日時未設定";
}

function formatDate(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("ja-JP") : "日付未定";
}

function offerStatusLabel(status: unknown) {
  if (status === "interested") return "興味あり";
  if (status === "rejected") return "見送り";
  return "未反応";
}

function nextActionLabel(value: unknown) {
  if (value === "trial_shift") return "体験する";
  if (value === "consultation_only") return "話を聞くだけ";
  return "未選択";
}

function responseStageLabel(value: unknown) {
  if (value === "interested_clicked") return "興味あり押下";
  if (value === "action_selected") return "進め方選択済み";
  if (value === "schedule_selected") return "日程確定";
  if (value === "rejected") return "見送り";
  return "未反応";
}

function responseSourceLabel(value: unknown) {
  if (value === "line") return "LINE";
  if (value === "app") return "アプリ内";
  return "未取得";
}

function safeInitial(value: unknown, fallback = "M") {
  const text = String(value || "").trim();
  if (/^https?:\/\//i.test(text)) return fallback;
  return text ? text.slice(0, 1) : fallback;
}

function copyText(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
  navigator.clipboard.writeText(value).catch(() => undefined);
}

function normalizeSalesData(value: AdminSalesResponse | null | undefined): AdminSalesResponse {
  const totals = value?.totals || { interested: 0, rejected: 0, no_response: 0, total: 0 };
  return {
    totals: {
      interested: safeNumber(totals.interested),
      rejected: safeNumber(totals.rejected),
      no_response: safeNumber(totals.no_response),
      total: safeNumber(totals.total),
    },
    by_club: safeArray(value?.by_club),
    by_user: safeArray(value?.by_user),
    unlinked_visit_count: safeNumber(value?.unlinked_visit_count),
    clubs: safeArray(value?.clubs),
    seekers: safeArray(value?.seekers),
    admin_staff: safeArray(value?.admin_staff),
    visits: safeArray(value?.visits),
    leads: safeArray(value?.leads),
    offers: safeArray(value?.offers),
  };
}

function hiraToKata(value: string) {
  return value.replace(/[\u3041-\u3096]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60));
}

function normalizeSearch(value: unknown, loose = false) {
  const normalized = hiraToKata(String(value || "").normalize("NFKC").toLowerCase())
    .replace(/[ \t\n\r　・･_\-‐‑‒–—―]/g, "");
  return loose ? normalized.replace(/ー/g, "") : normalized;
}

function clubSearchText(club: Pick<ClubRecord, "display_name" | "search_name" | "kana_name" | "region" | "area" | "store_code">) {
  return [club.display_name, club.search_name, club.kana_name, club.region, club.area, club.store_code].filter(Boolean).join(" ");
}

function matchesClubSearch(club: Pick<ClubRecord, "display_name" | "search_name" | "kana_name" | "region" | "area" | "store_code">, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const haystack = clubSearchText(club);
  return normalizeSearch(haystack).includes(normalizeSearch(trimmed)) ||
    normalizeSearch(haystack, true).includes(normalizeSearch(trimmed, true));
}

async function fetchAdminSeekers(): Promise<AdminSeekerRecord[]> {
  const response = await fetch("/api/admin/seekers", { cache: "no-store" });
  if (!response.ok) throw new Error("ユーザー管理データの取得に失敗しました");
  return response.json();
}

async function fetchAdminAccounts(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch("/api/admin/accounts", { cache: "no-store" });
  if (!response.ok) throw new Error("アカウント一覧の取得に失敗しました");
  return response.json();
}

async function patchAdminAccountRole(userId: string, role: AdminAccountRole): Promise<Record<string, unknown>> {
  const response = await fetch("/api/admin/accounts", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, role }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "権限更新に失敗しました");
  return json;
}

async function fetchAdminClubs(): Promise<AdminClubRecord[]> {
  const response = await fetch("/api/admin/clubs");
  if (!response.ok) throw new Error("店舗管理データの取得に失敗しました");
  return response.json();
}

async function fetchAdminSales(): Promise<AdminSalesResponse> {
  const response = await fetch("/api/admin/sales");
  if (!response.ok) throw new Error("営業管理データの取得に失敗しました");
  return response.json();
}

async function postAdminSales(kind: "visit" | "result", payload: Record<string, unknown>) {
  const response = await fetch("/api/admin/sales", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, ...payload }),
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.error || "営業データの保存に失敗しました");
  }
  return response.json();
}

async function patchAdminSeeker(id: string, updates: Record<string, unknown>) {
  const response = await fetch("/api/admin/seekers", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, updates }),
  });
  if (!response.ok) throw new Error("ユーザー更新に失敗しました");
  return response.json();
}

async function deleteAdminSeeker(id: string) {
  const response = await fetch("/api/admin/seekers", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, mode: "reset_seeker" }),
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.error || "ユーザー削除に失敗しました");
  }
  return response.json();
}

async function patchAdminClub(id: string, updates: Record<string, unknown>, extra: Record<string, unknown>) {
  const response = await fetch("/api/admin/clubs", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, updates, extra }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "店舗更新に失敗しました");
  return json;
}

function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className={`logo ${light ? "logo-light" : ""}`}>
      <span className="logo-mark"><i /><i /><i /><i /></span>
      <span>MAXVALUE</span>
    </div>
  );
}

function Button({ children, kind = "primary", onClick, type = "button", disabled = false, className = "" }: {
  children: ReactNode; kind?: "primary" | "secondary" | "line" | "ghost" | "dark";
  onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; className?: string;
}) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`button ${kind} ${className}`}>{children}</button>;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : "画面の読み込みに失敗しました" };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("MAXVALUE client error", error, info);
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <main className="app-shell soft-bg">
        <section className="page-content">
          <div className="empty-state error-state">
            <ShieldCheck />
            <h2>画面を再読み込みしてください</h2>
            <p>一時的にデータを読み込めませんでした。復旧画面を表示しているため、アプリ全体は停止していません。</p>
            <Button onClick={() => {
              if (typeof window !== "undefined") {
                window.location.href = "/";
              }
            }}>トップへ戻る</Button>
          </div>
        </section>
      </main>
    );
  }
}

function Field({ label, children, hint, required = false, error, id }: { label: string; children: ReactNode; hint?: string; required?: boolean; error?: string; id?: string }) {
  return <label className={`field ${error ? "field-error" : ""}`} data-field-id={id}><span>{label}{required && <b className="required-mark"> *</b>}</span>{children}{hint && <small>{hint}</small>}{error && <em>{error}</em>}</label>;
}

function Select({ children, defaultValue = "" }: { children: ReactNode; defaultValue?: string }) {
  return <select defaultValue={defaultValue}><option value="" disabled>選択してください</option>{children}</select>;
}

function RegionAreaPicker({ label, region, area, onRegion, onArea, error, id }: {
  label: string;
  region: Region | "";
  area: string;
  onRegion: (region: Region) => void;
  onArea: (area: string) => void;
  error?: string;
  id?: string;
}) {
  return (
    <div className={`field region-field ${error ? "field-error" : ""}`} data-field-id={id}>
      <span>{label}<b className="required-mark"> *</b></span>
      <div className="region-cards">
        {(Object.keys(regionAreas) as Region[]).map(item => (
          <button key={item} type="button" className={region === item ? "selected" : ""} onClick={() => onRegion(item)}>
            <MapPin size={18} /><b>{item}</b><small>{item === "大阪" ? "北新地・ミナミ" : "六本木・銀座・歌舞伎町"}</small>
          </button>
        ))}
      </div>
      {region && <div className="area-choice" aria-label={`${label}のエリア`}>
        {regionAreas[region].map(item => <button type="button" key={item} className={area === item ? "selected" : ""} onClick={() => onArea(item)}>{item}</button>)}
      </div>}
      {error && <em>{error}</em>}
    </div>
  );
}

type LineLoginRole = "seeker" | "club_staff" | "admin";

function lineLoginHref(screen: Screen, role: LineLoginRole = "seeker", clubCode = "", referralCode = "") {
  const params = new URLSearchParams({ returnTo: `/?screen=${screen}`, role });
  if (clubCode.trim()) params.set("clubCode", clubCode.trim());
  if (referralCode.trim()) params.set("ref", referralCode.trim());
  return `/api/auth/line/start?${params.toString()}`;
}

function LineLoginButton({ children = "LINEでログイン", screen = "setup", role = "seeker", className = "" }: { children?: ReactNode; screen?: Screen; role?: LineLoginRole; className?: string }) {
  return <a className={`line-login-link ${className}`} href={lineLoginHref(screen, role)}><MessageCircle size={18} />{children}</a>;
}

function FadeIn({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function PrizeArtwork({ rarity = "SR", compact = false }: { rarity?: string; compact?: boolean }) {
  return (
    <div className={`collectible-art ${compact ? "compact" : ""}`}>
      <span className="card-corner corner-a" /><span className="card-corner corner-b" />
      <div className="salon-silhouette"><i /><i /><i /></div>
      <strong>ALIS</strong><small>SET SALON</small><b>{rarity}</b>
    </div>
  );
}

function AppHeader({ title, back, action }: { title: string; back?: () => void; action?: ReactNode }) {
  const adminCapability = useAdminCapability();
  return (
    <header className={`app-header ${back ? "has-back" : "app-header-logo-left"} ${adminCapability.isAdmin ? "admin-capable" : ""}`}>
      {back ? <button className="icon-button" onClick={back}><ArrowLeft size={21} /></button> : <Logo />}
      <strong>{title}</strong>
      <div className="header-action">{action || (!adminCapability.isAdmin && <button className="icon-button"><Menu size={20} /></button>)}{adminCapability.isAdmin && <AdminModeSwitcher />}</div>
    </header>
  );
}

function AdminModeSwitcher() {
  const { mode, selectedClub, switchMode } = useAdminCapability();
  const [open, setOpen] = useState(false);
  const label = mode === "admin" ? "管理者" : mode === "club" ? (selectedClub?.display_name || "お店") : mode === "ambassador" ? "アンバサダー" : "求職者";
  return <div className="admin-mode-switch"><button type="button" onClick={() => setOpen(value => !value)}><ShieldCheck size={15}/><span>{label}</span><ChevronRight size={14}/></button>{open && <div className="admin-mode-menu"><small>表示する画面</small><button type="button" className={mode === "admin" ? "active" : ""} onClick={() => { setOpen(false); switchMode("admin"); }}>管理者</button><button type="button" className={mode === "club" ? "active" : ""} onClick={() => { setOpen(false); switchMode("club"); }}>お店</button><button type="button" className={mode === "seeker" ? "active" : ""} onClick={() => { setOpen(false); switchMode("seeker"); }}>求職者</button><button type="button" className={mode === "ambassador" ? "active" : ""} onClick={() => { setOpen(false); switchMode("ambassador"); }}>アンバサダー</button></div>}</div>;
}

function BottomNav({ role, screen, go, badges = {} }: { role: Role; screen: Screen; go: (s: Screen) => void; badges?: Partial<Record<Screen, number>> }) {
  const seeker = [
    ["offers", "オファー", Mail], ["gacha", "ガチャ", Gift], ["profile", "マイページ", CircleUserRound]
  ] as const;
  const club = [
    ["talent", "オファーを出す", Search], ["sentOffers", "出したオファー", Send], ["clubProfile", "マイページ", Store]
  ] as const;
  const admin = [
    ["adminUsers", "ユーザー管理", Users], ["adminClubs", "お店管理", Store], ["sales", "営業", BarChart3]
  ] as const;
  const items = role === "seeker" ? seeker : role === "club" ? club : admin;
  return (
    <nav className="bottom-nav">
      {items.map(([target, label, Icon]) => (
        <button key={target} className={screen === target ? "active" : ""} onClick={() => go(target as Screen)}>
          <Icon size={22} />{Boolean(badges[target as Screen]) && <b className="nav-badge">{badges[target as Screen]}</b>}<span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Landing({ go }: { go: (s: Screen) => void }) {
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"company" | "terms" | "privacy" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeStory, setActiveStory] = useState(0);
  const stories = landingStories;

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 1100);
    const storyTimer = window.setInterval(() => setActiveStory(current => (current + 1) % stories.length), 6200);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(storyTimer);
    };
  }, []);

  const modalCopy = {
    company: companyContent,
    terms: termsContent,
    privacy: privacyContent,
  } as const;

  return (
    <main className="brand-site">
      {loading && <motion.div className="brand-loader" initial={{ opacity: 1 }} exit={{ opacity: 0 }}><Logo light /><span>PRIVATE OFFER STORIES</span></motion.div>}
      <nav className="brand-nav">
        <Logo light />
        <button className="brand-menu-button" onClick={() => setMenuOpen(true)} aria-label="メニュー"><Menu size={24} /></button>
      </nav>
      <section className="brand-cinema">
        {stories.map((story, index) => index === activeStory && (
          <motion.img
            key={story.image}
            src={story.image}
            alt={story.alt}
            initial={{ opacity: 0, scale: 1.06, x: "-2%" }}
            animate={{ opacity: 1, scale: 1.11, x: "3%" }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 1.4 }, scale: { duration: 6.2, ease: "easeOut" }, x: { duration: 6.2, ease: "easeOut" } }}
          />
        ))}
        <div className="brand-cinema-shade" />
        <motion.div key={stories[activeStory].label} className="brand-mini-copy" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2 }}>
          <span>{String(activeStory + 1).padStart(2, "0")}</span>
          <h1>{stories[activeStory].label}</h1>
          <p>{stories[activeStory].copy}</p>
        </motion.div>
        <div className="brand-story-dots" aria-label="ストーリー選択">{stories.map((story, index) => <button key={story.label} type="button" aria-label={`${story.label}を表示`} aria-pressed={activeStory === index} className={activeStory === index ? "active" : ""} onClick={() => setActiveStory(index)} />)}</div>
        <LineLoginButton screen="setup" className="brand-elegant-line">LINEで登録する</LineLoginButton>
      </section>
      <section className="brand-service-intro">
        <span className="brand-section-label">PRIVATE OFFER SERVICE</span>
        <h2>あなたを探しているお店から、<br/>条件つきのオファーが届く。</h2>
        <p>プロフィールを登録したら、あとは待つだけ。希望エリアや働き方に合うお店から届いた条件を、落ち着いて比較できます。</p>
        <div className="brand-benefit-grid">
          <article><Mail/><b>オファーを比較</b><small>時給・保証期間・お店の魅力をひとつの画面で確認</small></article>
          <article><ShieldCheck/><b>プロフィールを保護</b><small>登録情報はオファーのために必要な店舗だけが確認</small></article>
          <article><Gift/><b>限定リワード</b><small>登録・招待・面接で楽しめるMAXVALUEガチャ</small></article>
        </div>
      </section>
      <section className="brand-how">
        <div><span className="brand-section-label">HOW IT WORKS</span><h2>はじめ方は、3ステップ。</h2></div>
        <ol>
          <li><i>01</i><b>LINEで登録</b><small>ニックネームと希望条件を入力</small></li>
          <li><i>02</i><b>オファーを受け取る</b><small>お店から届く条件を比較</small></li>
          <li><i>03</i><b>日程を決める</b><small>話を聞く・体験するを選んで連絡</small></li>
        </ol>
        <LineLoginButton screen="setup" className="brand-bottom-line">無料で始める</LineLoginButton>
      </section>
      <footer className="brand-new-footer">
        <Logo light />
        <div><button onClick={() => setModal("company")}>会社情報</button><button onClick={() => setModal("terms")}>利用規約</button><button onClick={() => setModal("privacy")}>プライバシー</button></div>
      </footer>
      {menuOpen && <div className="brand-menu-panel">
        <button className="modal-x" onClick={() => setMenuOpen(false)}><X /></button>
        <Logo light />
        <button onClick={() => { setModal("company"); setMenuOpen(false); }}>会社情報</button>
        <button onClick={() => { setModal("terms"); setMenuOpen(false); }}>利用規約</button>
        <button onClick={() => { setModal("privacy"); setMenuOpen(false); }}>プライバシーポリシー</button>
        <button onClick={() => go("clubSignin")}>店舗の方</button>
        <a href="/api/auth/line/start?role=ambassador&returnTo=/?screen=ambassadorProfile">アンバサダー</a>
        <button onClick={() => go("adminSignin")}>管理者</button>
      </div>}
      {modal && <div className="modal-backdrop"><div className="brand-info-modal" role="dialog" aria-modal="true" aria-labelledby="brand-info-title"><button className="modal-x" aria-label="閉じる" onClick={() => setModal(null)}><X /></button><h2 id="brand-info-title">{modalCopy[modal].title}</h2>{modalCopy[modal].updatedAt && <small>最終更新：{modalCopy[modal].updatedAt}</small>}<div className="legal-sections">{modalCopy[modal].sections.map(section => <section key={section.heading}><h3>{section.heading}</h3><p>{section.body}</p></section>)}</div></div></div>}
    </main>
  );
}

function Signin({ go, club = false }: { go: (s: Screen) => void; club?: boolean }) {
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [inviter, setInviter] = useState<{ name: string; photo_url?: string | null } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const referral = new URLSearchParams(window.location.search).get("ref") || "";
    if (referral) {
      setCode(referral);
      fetch(`/api/invite/resolve?code=${encodeURIComponent(referral)}`, { cache: "no-store" })
        .then(response => response.ok ? response.json() : { inviter: null })
        .then(data => setInviter(data.inviter || null))
        .catch(() => setInviter(null));
    }
  }, []);
  const startLineLogin = async (returning = false) => {
    const next = returning ? (club ? "talent" : "offers") : (club ? "clubSetup" : "setup");
    setAuthError("");
    if (club && !returning && !code.trim()) {
      setAuthError("店舗IDまたは登録権限コードを入力してください。");
      return;
    }
    setStarting(true);
    try {
      const status = await fetch("/api/auth/line/status").then(response => response.json());
      if (status.configured) {
        window.location.href = lineLoginHref(next, club ? "club_staff" : "seeker", club ? code : "", club ? "" : code);
        return;
      }
      if (club) {
        setAuthError("LINE Loginの環境変数が未設定です。設定後に店舗LINE連携できます。");
        return;
      }
      const lineUserId = ensureTemporaryLineUserId();
      await bootstrapTemporaryUser(lineUserId);
      go(next);
    } finally {
      setStarting(false);
    }
  };
  return (
    <main className="auth-page">
      <button className="auth-back" onClick={() => go("landing")}><ArrowLeft /> 戻る</button>
      <section className="auth-card">
        <Logo /><div className="auth-title"><span>{club ? "FOR CLUB" : "WELCOME"}</span><h1>{club ? "店舗アカウント" : "LINEでかんたん登録"}</h1><p>{club ? "登録済みの店舗IDまたは登録権限コードを入力してください。" : "LINEと連携して、1分で登録完了"}</p></div>
        <Field label={club ? "店舗ID / 登録権限コード" : "招待コード（任意）"}>
          <div className="input-with-icon"><LockKeyhole size={19} /><input value={code} onChange={e => setCode(e.target.value)} placeholder={club ? "例）clubace01" : "例）MV-AIMI23"} /></div>
        </Field>
        {code && <div className="inviter"><div className="avatar small rose" style={inviter?.photo_url ? { backgroundImage: `url(${inviter.photo_url})`, backgroundSize: "cover" } : undefined}>{!inviter?.photo_url && safeInitial(inviter?.name || (club ? "店" : "招"))}</div><span><small>{club ? "店舗コード入力済み" : "招待者"}</small><b>{club ? code : inviter ? `${inviter.name} さん` : "招待コードを確認中"}</b></span>{inviter && <BadgeCheck />}</div>}
        <Button kind="line" disabled={starting} onClick={() => startLineLogin()}><MessageCircle size={20} fill="currentColor" /> {starting ? "接続確認中..." : `LINEで${club ? "続ける" : "新規登録"}`}</Button>
        <Button kind="secondary" disabled={starting} onClick={() => startLineLogin(true)}>すでに登録済みの方</Button>
        {authError && <small className="form-error">{authError}</small>}
        {!club && <p className="auth-note">アカウントを作成すると利用規約とプライバシーポリシーに同意したものとみなされます。18歳以上（高校生不可）の方のみご利用いただけます。</p>}
        {club && <button className="switch-auth" onClick={() => { setAuthError(""); go("signin"); }}>求職者の方はこちら</button>}
      </section>
    </main>
  );
}

function FriendAdd({ go }: { go: (s: Screen) => void }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const checkFriend = async () => {
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/line/friend-status", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.friendAdded) {
        go("setup");
        return;
      }
      setMessage("友だち追加を確認できませんでした。追加後にもう一度確認してください。");
    } catch {
      setMessage("確認に失敗しました。通信状況を確認してもう一度お試しください。");
    } finally {
      setChecking(false);
    }
  };
  return <main className="auth-page"><button className="auth-back" onClick={() => go("signin")}><ArrowLeft /> 戻る</button><section className="auth-card friend-gate"><Logo/><div className="auth-title"><span>LINE FRIEND</span><h1>公式LINEを友だち追加</h1><p>オファー通知を受け取るため、登録前に公式LINEを友だち追加してください。</p></div>{LINE_FRIEND_URL ? <a className="line-login-link" href={LINE_FRIEND_URL} target="_blank" rel="noreferrer"><MessageCircle size={20}/> LINEで友だち追加</a> : <p className="form-error">友だち追加URLが未設定です。</p>}<Button disabled={checking} onClick={checkFriend}>{checking ? "確認中..." : "友だち追加完了を確認"}</Button>{message && <p className="form-error">{message}</p>}</section></main>;
}

function Setup({ go, club = false }: { go: (s: Screen) => void; club?: boolean }) {
  const max = club ? 2 : 4;
  const [step, setStep] = useState(1);
  const [uploaded, setUploaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [invalidFields, setInvalidFields] = useState<Record<string, string>>({});
  const [lineUserId, setLineUserId] = useState("");
  const [nickname, setNickname] = useState("");
  const [linePictureUrl, setLinePictureUrl] = useState("");
  const [age, setAge] = useState("");
  const [workExperience, setWorkExperience] = useState("");
  const [desiredRegion, setDesiredRegion] = useState<Region | "">("");
  const [desiredArea, setDesiredArea] = useState("");
  const [desiredShift, setDesiredShift] = useState("");
  const [startTiming, setStartTiming] = useState("");
  const [currentRegion, setCurrentRegion] = useState<Region | "">("");
  const [currentArea, setCurrentArea] = useState("");
  const [currentHourlyRange, setCurrentHourlyRange] = useState("");
  const [currentMonthlySalesRange, setCurrentMonthlySalesRange] = useState("");
  const [clubs, setClubs] = useState<ClubRecord[]>([]);
  const [currentClubId, setCurrentClubId] = useState("");
  const [blockedClubIds, setBlockedClubIds] = useState<string[]>([]);
  const [desiredClubIds, setDesiredClubIds] = useState<string[]>([]);
  const [clubBrowseRegion, setClubBrowseRegion] = useState<Region | "">("");
  const [clubBrowseArea, setClubBrowseArea] = useState("");
  const [photoUrls, setPhotoUrls] = useState(["", "", ""]);
  const [uploading, setUploading] = useState([false, false, false]);
  const [uploadProgress, setUploadProgress] = useState([0, 0, 0]);
  const [currentClubQuery, setCurrentClubQuery] = useState("");
  const [blockedClubQuery, setBlockedClubQuery] = useState("");
  const setupContentRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    fetchClubs().then(items => setClubs(safeArray(items))).catch(() => setClubs([]));
    const activeLineUserId = getActiveLineUserId();
    setLineUserId(activeLineUserId);
    setLinePictureUrl(getActiveLinePictureUrl());
    fetch("/api/auth/line/status")
      .then(response => response.json())
      .then(status => {
        if (status.profile?.line_user_id || status.profile?.userId) setLineUserId(status.profile.line_user_id || status.profile.userId);
        if ((status.profile?.line_display_name || status.profile?.displayName) && !nickname) setNickname(status.profile.line_display_name || status.profile.displayName);
        if (status.profile?.line_picture_url || status.profile?.pictureUrl) setLinePictureUrl(status.profile.line_picture_url || status.profile.pictureUrl);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (club || !lineUserId) return;
    fetchSeekerProfile(lineUserId)
      .then(profile => {
        if (!profile) return;
        setNickname(current => current || profile.nickname || "");
        setAge(profile.age ? `${profile.age}歳` : "");
        setWorkExperience(profile.work_experience || "");
        setDesiredRegion((profile.desired_region as Region) || "");
        setDesiredArea(profile.desired_area || "");
        setDesiredShift(profile.desired_shift || "");
        setStartTiming(profile.start_timing || "");
        setCurrentHourlyRange(profile.current_hourly_range || "");
        setCurrentMonthlySalesRange(profile.current_monthly_sales_range || "");
        setPhotoUrls([profile.photo_1_url || "", profile.photo_2_url || "", profile.full_body_photo_url || ""]);
        setUploaded(Boolean(profile.photo_1_url));
        if (profile.current_club) setCurrentClubQuery(profile.current_club);
      })
      .catch(() => undefined);
  }, [club, lineUserId]);
  useEffect(() => {
    setupContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);
  const chooseDesiredRegion = (region: Region) => { setDesiredRegion(region); setDesiredArea(""); };
  const validateStep = () => {
    if (club) return {};
    const errors: Record<string, string> = {};
    if (step === 1) {
      if (!nickname.trim()) errors.nickname = "ニックネームを入力してください";
      if (!age) errors.age = "年齢を選択してください";
      if (!workExperience) errors.workExperience = "経験を選択してください";
      if (!desiredRegion) errors.desiredRegion = "希望地域を選択してください";
      if (!desiredArea) errors.desiredArea = "希望エリアを選択してください";
      if (!desiredShift) errors.desiredShift = "希望シフトを選択してください";
      if (!startTiming) errors.startTiming = "勤務開始予定を選択してください";
    }
    if (step === 2) {
      if (desiredClubIds.length < 3) errors.desiredClubIds = "オファーしてほしいお店を3店舗以上選択してください";
    }
    if (step === 3) {
      if (workExperience !== "未経験" && !currentClubId && !currentClubQuery.trim()) errors.currentClubId = "店舗マスタから選択してください";
      if (!currentHourlyRange) errors.currentHourlyRange = "現在時給を選択してください";
      if (!currentMonthlySalesRange) errors.currentMonthlySalesRange = "現在月売を選択してください";
    }
    if (step === 4 && !photoUrls[0]) errors.photo1 = "1枚目のプロフィール写真を登録してください";
    return errors;
  };
  const scrollToFirstError = () => {
    window.setTimeout(() => {
      const node = setupContentRef.current?.querySelector(".field-error, .upload-box.error");
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  };
  const resizeImageForUpload = async (file: File) => {
    if (!file.type.match(/^image\/(jpeg|png|webp)$/) || file.size < 1_800_000) return file;
    const bitmap = await createImageBitmap(file);
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, file.type === "image/png" ? "image/png" : "image/jpeg", 0.84));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.(png|webp)$/i, ".jpg"), { type: blob.type || "image/jpeg" });
  };
  const uploadPhoto = async (file: File, index: number) => {
    setFormError("");
    setInvalidFields(current => ({ ...current, [`photo${index + 1}`]: "" }));
    setUploading(current => current.map((value, i) => i === index ? true : value));
    setUploadProgress(current => current.map((value, i) => i === index ? 8 : value));
    try {
      const faceDetectorCtor = typeof window !== "undefined"
        ? (window as unknown as { FaceDetector?: new (options?: Record<string, unknown>) => { detect: (source: ImageBitmap) => Promise<unknown[]> } }).FaceDetector
        : undefined;
      if (faceDetectorCtor) {
        const bitmap = await createImageBitmap(file);
        const faces = await new faceDetectorCtor({ fastMode: true, maxDetectedFaces: 3 }).detect(bitmap);
        if (!faces.length) throw new Error("人物の顔が写っている写真を選んでください");
      }
      const uploadFile = await resizeImageForUpload(file);
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("slot", `photo_${index + 1}`);
      form.append("lineUserId", lineUserId || getActiveLineUserId());
      const json = await new Promise<{ url: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/storage/upload");
        xhr.upload.onprogress = event => {
          if (!event.lengthComputable) return;
          const percent = Math.max(8, Math.min(92, Math.round((event.loaded / event.total) * 92)));
          setUploadProgress(current => current.map((value, i) => i === index ? percent : value));
        };
        xhr.onload = () => {
          let parsed: { url?: string; error?: string } = {};
          try {
            parsed = JSON.parse(xhr.responseText || "{}");
          } catch {
            parsed = {};
          }
          if (xhr.status >= 200 && xhr.status < 300 && parsed.url) resolve({ url: parsed.url });
          else reject(new Error(parsed.error || "写真アップロードに失敗しました"));
        };
        xhr.onerror = () => reject(new Error("通信エラーで写真アップロードに失敗しました"));
        xhr.send(form);
      });
      if (!json.url) throw new Error("写真URLの取得に失敗しました");
      setUploadProgress(current => current.map((value, i) => i === index ? 100 : value));
      setPhotoUrls(current => current.map((value, i) => i === index ? json.url : value));
      if (index === 0) setUploaded(true);
    } finally {
      setUploading(current => current.map((value, i) => i === index ? false : value));
    }
  };
  const clubMatches = (query: string) => clubs
    .filter(item => matchesClubSearch(item, query))
    .slice(0, 8);
  const rankedClubs = [...clubs]
    .filter(item => !clubBrowseRegion || item.region === clubBrowseRegion)
    .filter(item => !clubBrowseArea || item.area === clubBrowseArea)
    .sort((a, b) => {
      const rankValue = (clubItem: ClubRecord) => {
        const explicit = String(clubItem.profile?.rank || clubItem.profile?.store_rank || "").toUpperCase();
        if (explicit === "S") return 4;
        if (explicit === "A") return 3;
        if (explicit === "B") return 2;
        if (explicit === "C") return 1;
        return /ACE|エース|MUSERVA|ミュゼルヴァ|JUNGLE|ジャングル/i.test(clubItem.display_name) ? 3 : 2;
      };
      return rankValue(b) - rankValue(a) || a.display_name.localeCompare(b.display_name, "ja");
    });
  const next = async () => {
    setFormError("");
    const errors = validateStep();
    setInvalidFields(errors);
    if (Object.keys(errors).length) {
      setFormError("未入力の必須項目があります。赤枠の項目を入力してください。");
      scrollToFirstError();
      return;
    }
    if (step < max) return setStep(step + 1);
    if (club) return go("clubProfile");
    setSaving(true);
    try {
      await saveSeekerProfile(lineUserId || getActiveLineUserId(), {
          nickname,
          fullName: "",
          age: Number(age.replace(/\D/g, "")),
          workExperience,
          desiredRegion,
          desiredArea,
          desiredShift,
          startTiming,
          currentRegion,
          currentArea,
          currentClubId: currentClubId || undefined,
          blockedClubIds,
          currentHourlyRange,
          currentMonthlySalesRange,
          photo1Url: photoUrls[0],
          photo2Url: photoUrls[1],
          photo3Url: photoUrls[2],
          desiredClubIds,
          referralCode: getReferralCode(),
      });
      go("gacha");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "プロフィール保存に失敗しました。もう一度お試しください。");
      scrollToFirstError();
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="app-shell setup-bg">
      <AppHeader title={club ? "店舗プロフィール登録" : "プロフィール登録"} back={() => step > 1 ? setStep(step - 1) : go(club ? "clubSignin" : "signin")} action={<span className="step-count">{step} / {max}</span>} />
      <div className="setup-progress">{Array.from({length: max}, (_, i) => <i key={i} className={i < step ? "done" : ""} />)}</div>
      <section className="setup-content" ref={setupContentRef}>
        <div className="screen-intro"><span>STEP {step}</span><h1>{club ? (step === 1 ? "店舗の基本情報" : "お店の写真") : (step === 1 ? "あなたの希望" : step === 2 ? "気になるお店" : step === 3 ? "現在の状況" : "プロフィール写真")}</h1><p>{club ? "求職者に伝わる情報を登録しましょう。" : "あとからいつでも変更できます。"}</p></div>
        {!club && step === 1 && <div className="form-stack">
          <Field label="ニックネーム" required error={invalidFields.nickname} id="nickname"><input value={nickname} onChange={e => setNickname(e.target.value)} /></Field>
          <Field label="年齢" required error={invalidFields.age} id="age">
            <select value={age} onChange={e => setAge(e.target.value)}><option value="" disabled>年齢を選択してください</option>{Array.from({ length: 17 }, (_, i) => 19 + i).map(value => <option key={value}>{value === 35 ? "35歳以上" : `${value}歳`}</option>)}</select>
          </Field>
          <Field label="ナイトワーク経験" required error={invalidFields.workExperience} id="workExperience"><select value={workExperience} onChange={e => setWorkExperience(e.target.value)}><option value="" disabled>選択してください</option><option>未経験</option><option>半年未満</option><option>半年〜1年</option><option>1年〜2年</option><option>2年以上</option></select></Field>
          <RegionAreaPicker label="希望勤務地域" region={desiredRegion} area={desiredArea} onRegion={chooseDesiredRegion} onArea={setDesiredArea} error={invalidFields.desiredRegion || invalidFields.desiredArea} id="desiredRegion" />
          <Field label="希望シフト" required error={invalidFields.desiredShift} id="desiredShift"><select value={desiredShift} onChange={e => setDesiredShift(e.target.value)}><option value="" disabled>選択してください</option><option>週3〜4</option><option>週4〜5</option><option>週5以上</option><option>検討中</option></select></Field>
          <Field label="勤務開始予定" required error={invalidFields.startTiming} id="startTiming"><select value={startTiming} onChange={e => setStartTiming(e.target.value)}><option value="" disabled>選択してください</option><option>すぐ体入希望</option><option>今月中</option><option>良いお店があれば</option></select></Field>
        </div>}
        {!club && step === 2 && <div className="form-stack">
          <div className={`desired-club-field ${invalidFields.desiredClubIds ? "field-error" : ""}`}>
            <span>オファーしてほしいお店 <b className="required-mark">*</b></span>
            <small>気になるお店を3店舗以上選択してください（おすすめ順）</small>
            <div className="club-hierarchy">
              <div className="region-cards">
                {(Object.keys(regionAreas) as Region[]).map(region => <button type="button" key={region} className={clubBrowseRegion === region ? "selected" : ""} onClick={() => { setClubBrowseRegion(region); setClubBrowseArea(""); }}>
                  <MapPin size={18}/><b>{region === "大阪" ? "関西" : "東京"}</b><small>{regionAreas[region].join("・")}</small>
                </button>)}
              </div>
              {clubBrowseRegion && <div className="area-choice">
                {regionAreas[clubBrowseRegion].map(area => <button type="button" key={area} className={clubBrowseArea === area ? "selected" : ""} onClick={() => setClubBrowseArea(area)}>{area}</button>)}
              </div>}
            </div>
            <div className="desired-club-grid">
              {rankedClubs.map(item => {
                const selected = desiredClubIds.includes(item.id);
                const unavailable = blockedClubIds.includes(item.id) || currentClubId === item.id;
                const photo = item.interior_photo_urls?.[0] || item.logo_url || "";
                return <button type="button" key={item.id} disabled={unavailable} className={selected ? "selected" : ""} onClick={() => setDesiredClubIds(current => selected ? current.filter(id => id !== item.id) : [...current, item.id])}>
                  <i style={photo ? { backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.75)),url(${photo})` } : undefined} />
                  <b>{item.display_name}</b><small>{item.area}</small>{selected && <Check size={18}/>}</button>;
              })}
            </div>
            {invalidFields.desiredClubIds && <em>{invalidFields.desiredClubIds}</em>}
          </div>
        </div>}
        {!club && step === 3 && <div className="form-stack">
          <Field label="現在or直近勤務店" required error={invalidFields.currentClubId} id="currentClubId">
            <input disabled={workExperience === "未経験"} value={workExperience === "未経験" ? "未経験のため入力不要" : currentClubQuery} onChange={e => { setCurrentClubQuery(e.target.value); setCurrentClubId(""); }} placeholder="店舗名を検索して選択" />
            {workExperience === "未経験" && <small>ナイトワーク未経験の方は勤務店入力をスキップできます。</small>}
            {workExperience !== "未経験" && currentClubQuery && !currentClubId && <div className="suggest-panel">
              {clubMatches(currentClubQuery).filter(item => !desiredClubIds.includes(item.id) && !blockedClubIds.includes(item.id)).map(item => <button type="button" key={item.id} onClick={() => { setCurrentClubId(item.id); setCurrentClubQuery(`${item.display_name} / ${item.area}`); }}>
                <Store size={15} /><span>{item.display_name}</span><small>{item.region} / {item.area}</small>
              </button>)}
            </div>}
          </Field>
          <Field label="見られたくない店舗（任意・複数追加可）">
            <input value={blockedClubQuery} onChange={e => setBlockedClubQuery(e.target.value)} placeholder="店舗名を検索して追加" />
            {blockedClubQuery && <div className="suggest-panel">
              {clubMatches(blockedClubQuery).filter(item => !blockedClubIds.includes(item.id) && !desiredClubIds.includes(item.id) && item.id !== currentClubId).map(item => <button type="button" key={item.id} onClick={() => { setBlockedClubIds(ids => [...ids, item.id]); setBlockedClubQuery(""); }}>
                <Store size={15} /><span>{item.display_name}</span><small>{item.region} / {item.area}</small>
              </button>)}
            </div>}
            <div className="selected-clubs">
              {blockedClubIds.map(id => {
                const found = clubs.find(item => item.id === id);
                return <button type="button" key={id} onClick={() => setBlockedClubIds(ids => ids.filter(item => item !== id))}>{found?.display_name || "店舗"} <X size={13} /></button>;
              })}
            </div>
          </Field>
          <Field label="現在時給" required error={invalidFields.currentHourlyRange} id="currentHourlyRange"><select value={currentHourlyRange} onChange={e => setCurrentHourlyRange(e.target.value)}><option value="" disabled>選択してください</option><option>3,000〜5,000</option><option>5,000〜7,000</option><option>7,000〜10,000</option><option>10,000〜15,000</option><option>15,000〜20,000</option><option>20,000〜30,000</option><option>30,000以上</option></select></Field>
          <Field label="現在月売" required error={invalidFields.currentMonthlySalesRange} id="currentMonthlySalesRange"><select value={currentMonthlySalesRange} onChange={e => setCurrentMonthlySalesRange(e.target.value)}><option value="" disabled>選択してください</option><option>50万未満</option><option>50〜100万</option><option>100〜150万</option><option>150〜200万</option><option>200〜300万</option><option>300〜400万</option><option>400〜500万</option><option>500万以上</option></select></Field>
        </div>}
        {!club && step === 4 && <div>
          <div className="photo-required-note"><Check size={16} /> 1枚目だけ登録すれば先へ進めます。2枚目・3枚目は任意です。</div>
          <div className="upload-grid">
            {["顔写真 1枚目（必須）", "顔写真 2枚目（任意）", "全身写真（任意）"].map((label, i) => <label key={label} className={`upload-box ${photoUrls[i] ? "uploaded rose" : ""} ${uploading[i] ? "uploading" : ""} ${invalidFields[`photo${i + 1}`] ? "error" : ""}`}>
              <input type="file" accept="image/*" onChange={event => {
                const file = event.currentTarget.files?.[0];
                if (file) uploadPhoto(file, i).catch(error => setFormError(error.message));
              }} />
              {uploading[i] ? <div className="uploading-state"><span>{uploadProgress[i]}%</span><i style={{ width: `${uploadProgress[i]}%` }} /><b>アップロード中</b></div> : photoUrls[i] ? <><img src={photoUrls[i]} alt="" /><span>変更する</span></> : <><ImagePlus /><b>{label}</b><small>{invalidFields[`photo${i + 1}`] || "タップして追加"}</small></>}
            </label>)}
          </div>
          <div className="photo-guide"><div><ShieldCheck /><span><b>写真は店舗への公開用です</b><small>本人確認とオファーのために使用します</small></span></div><h3>避けてほしい写真</h3><div className="ng-list">{["加工が強い", "顔が隠れている", "遠い", "暗い", "顔が見えない", "本人ではない"].map(x => <span key={x}>{x}</span>)}</div></div>
        </div>}
        {club && step === 1 && <div className="form-stack">
          <Field label="店舗名"><input placeholder="店舗名を入力" /></Field>
          <Field label="業態"><Select><option>キャバクラ</option><option>クラブ</option><option>ラウンジ</option></Select></Field>
          <div className="area-pickers"><Field label="地域"><Select><option>大阪</option><option>東京</option></Select></Field><Field label="エリア"><Select><option>北新地</option><option>ミナミ</option><option>六本木</option><option>銀座</option><option>歌舞伎町</option></Select></Field></div>
          <Field label="お店ID" hint="英数字8文字以上。ログイン時に使用します。"><input placeholder="例）clubace01" /></Field>
          <Field label="登録権限コード（必須）"><input required placeholder="店舗に発行された権限コード" /></Field>
          <Field label="お店の魅力（任意）"><textarea maxLength={30} placeholder="20〜30字で魅力を入力" /></Field>
        </div>}
        {club && step === 2 && <div><div className="upload-grid club-upload">{["店舗ロゴ（必須）", "内装写真 1", "内装写真 2", "内装写真 3"].map((label, i) => <button key={label} className={`upload-box ${uploaded && i === 0 ? "uploaded night" : ""}`} onClick={() => setUploaded(true)}>{uploaded && i === 0 ? <><Store size={46} /><span>変更する</span></> : <><Camera /><b>{label}</b><small>タップして追加</small></>}</button>)}</div></div>}
        {formError && <div className="form-error">{formError}</div>}
      </section>
      <div className="setup-actions"><Button kind="secondary" onClick={() => step > 1 ? setStep(step - 1) : go(club ? "clubSignin" : "signin")}>戻る</Button><Button onClick={next} disabled={saving || uploading.some(Boolean)}>{uploading.some(Boolean) ? "写真アップロード中..." : saving ? "保存中..." : step === max ? "登録を完了" : "次へ"} <ArrowRight size={18} /></Button></div>
    </main>
  );
}

function Offers({ go }: { go: (s: Screen) => void }) {
  const [offers, setOffers] = useState<OfferRecord[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [scheduleOffer, setScheduleOffer] = useState<OfferRecord | null>(null);
  const [scheduleAction, setScheduleAction] = useState<"consultation_only" | "trial_shift" | "">("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [responding, setResponding] = useState(false);
  const [offerMessage, setOfferMessage] = useState("");
  const [offerFilter, setOfferFilter] = useState<"all" | "interested" | "rejected">("all");
  const loadingOffersRef = useRef(false);
  const loadOffers = useCallback(async () => {
    if (loadingOffersRef.current) return;
    loadingOffersRef.current = true;
    const lineUserId = getActiveLineUserId();
    try {
      await bootstrapTemporaryUser(lineUserId);
      const items = await fetchOffers(lineUserId);
      const nextOffers = safeArray(items);
      setOffers(nextOffers);
      try {
        window.sessionStorage.setItem(`maxvalue_offers_${lineUserId}`, JSON.stringify(nextOffers));
      } catch {}
    } catch {
      // Keep the last successfully displayed result during a temporary network error.
    } finally {
      setOffersLoading(false);
      loadingOffersRef.current = false;
    }
  }, []);

  useEffect(() => {
    const lineUserId = getActiveLineUserId();
    try {
      const cached = window.sessionStorage.getItem(`maxvalue_offers_${lineUserId}`);
      if (cached) {
        setOffers(safeArray(JSON.parse(cached)));
        setOffersLoading(false);
      }
    } catch {}
    void loadOffers();
    const interval = window.setInterval(() => void loadOffers(), 20000);
    const refresh = () => {
      if (document.visibilityState === "visible") void loadOffers();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadOffers]);

  const react = async (offer: OfferRecord, status: OfferRecord["status"], date?: string, nextAction?: "consultation_only" | "trial_shift", cancel = false) => {
    setResponding(true);
    setOfferMessage("");
    try {
      const response = await fetch("/api/offers/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offerId: offer.id,
          lineUserId: getActiveLineUserId(),
          status,
          selectedDate: date,
          nextAction,
          cancel,
          cancelReason,
          previousSelectedDate: offer.selected_date,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "反応の保存に失敗しました");
      setOffers(current => current.map(o => o.id === offer.id ? {
        ...o,
        status,
        selected_date: cancel ? null : date || o.selected_date,
        next_action: cancel ? null : nextAction || o.next_action,
        response_status: cancel ? "canceled" : json.responseStage,
        response_source: "app",
        cancel_reason: cancel ? cancelReason : null,
      } : o));
      if (cancel) setOfferMessage("キャンセルを店舗へ連絡しました。");
      else if (status === "interested" && date) setOfferMessage(`${date}で日程希望を送信しました。`);
      if (json.lineSent === false) setOfferMessage("反応は保存しました。LINE通知はLINE IDまたはアクセストークン確認後に送信されます。");
    } catch (error) {
      setOfferMessage(error instanceof Error ? error.message : "反応の保存に失敗しました");
    } finally {
      setResponding(false);
      setScheduleOffer(null);
      setScheduleAction("");
      setScheduleDate("");
      setCancelOpen(false);
      setCancelReason("");
      void loadOffers();
    }
  };
  const newOfferCount = offers.filter(o => o.status === "new").length;
  const visibleOffers = offers.filter(offer => offerFilter === "all" || offer.status === offerFilter);
  return (
    <main className="app-shell">
      <AppHeader title="オファー" action={<button className="icon-button"><Bell size={20} /></button>} />
      <section className="page-content">
        <div className="dashboard-hello"><div><span>MAXVALUE</span><h1>あなたへのオファー</h1></div></div>
        {offerMessage && <div className="inline-notice">{offerMessage}</div>}
        <div className="filter-row"><button className={offerFilter === "all" ? "active" : ""} onClick={() => setOfferFilter("all")}>すべて</button><button className={offerFilter === "interested" ? "active" : ""} onClick={() => setOfferFilter("interested")}>興味あり</button><button className={offerFilter === "rejected" ? "active" : ""} onClick={() => setOfferFilter("rejected")}>見送り</button></div>
        <div className="offer-list">
          {offersLoading && Array.from({ length: 2 }, (_, index) => <div className="offer-card offer-skeleton" key={index} aria-label="オファーを読み込み中"><i/><i/><i/><i/></div>)}
          {visibleOffers.map(o => {
            const logoUrl = typeof o.logo === "string" && /^https?:\/\//i.test(o.logo) ? o.logo : "";
            return <article className="offer-card" key={o.id}>
            <div className="offer-card-head"><div className="club-logo" style={logoUrl ? { backgroundImage: `url(${logoUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>{!logoUrl && safeInitial(o.club, "?")}</div><div><span>{o.area}・キャバクラ</span><h2>{o.club}</h2></div>{o.status === "new" && <b className="new-badge">NEW</b>}</div>
            <div className="offer-condition"><div><small>オファー時給</small><strong>¥{formatYen(o.wage)}<i>/時</i></strong></div><div><small>保証期間</small><strong>{o.period}</strong></div></div>
            <p className="offer-note">「{o.note}」</p>
            <div className="offer-buttons">
              <Button kind={o.status === "rejected" ? "secondary" : "ghost"} onClick={() => react(o, "rejected")} disabled={responding}>{o.status === "rejected" ? <><Check size={17}/> 見送り選択中</> : "今回は見送る"}</Button>
              <Button onClick={() => { setScheduleOffer(o); setScheduleAction((o.next_action as "consultation_only" | "trial_shift") || ""); setScheduleDate(o.selected_date || ""); }} disabled={responding}>{o.selected_date ? <><Check size={17}/> 日程を連絡済み</> : <><Heart size={17}/> 興味あり</>}</Button>
            </div>
          </article>;
          })}
          {!offersLoading && !visibleOffers.length && <div className="empty-state compact"><Mail/><h2>該当するオファーはありません</h2></div>}
        </div>
      </section>
      {scheduleOffer && !cancelOpen && <div className="modal-backdrop"><div className="schedule-modal"><button className="modal-x" onClick={() => setScheduleOffer(null)}><X /></button><span className="eyebrow">SCHEDULE</span><h2>{scheduleOffer.selected_date ? "現在確定している日程" : "ご希望の進め方"}</h2>{scheduleOffer.selected_date && <div className="current-schedule"><b>{scheduleOffer.next_action === "trial_shift" ? "体験する" : "話を聞くだけ"}</b><strong>{formatDate(scheduleOffer.selected_date)}</strong>{scheduleOffer.next_action === "trial_shift" && <small>体験時給 ¥{formatYen(scheduleOffer.wage)}</small>}</div>}<p>{scheduleOffer.selected_date ? "ご変更の場合は、内容と日程を選び直してください。" : "まず希望する内容を選択してください。次に日程を確定します。"}</p><div className="schedule-choice-grid"><button className={scheduleAction === "consultation_only" ? "active" : ""} onClick={() => setScheduleAction("consultation_only")}>話を聞くだけ</button><button className={scheduleAction === "trial_shift" ? "active" : ""} onClick={() => setScheduleAction("trial_shift")}>体験する<br/><small>体験時給 ¥{formatYen(scheduleOffer.wage)}</small></button></div>{scheduleAction && <><h3>面接・体入希望日</h3><p>20時以降（日曜日を除く）で可能な日程を選んでください。</p><input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} /></>}<div className="result-actions"><Button kind="secondary" onClick={() => setScheduleOffer(null)}>戻る</Button><Button disabled={!scheduleAction || !scheduleDate || responding} onClick={() => scheduleAction && react(scheduleOffer, "interested", scheduleDate, scheduleAction)}>{responding ? "送信中..." : "日程を確定"}</Button></div>{scheduleOffer.selected_date && <button className="cancel-schedule-link" onClick={() => setCancelOpen(true)}>キャンセルの場合</button>}</div></div>}
      {scheduleOffer && cancelOpen && <div className="modal-backdrop"><div className="schedule-modal cancel-modal"><button className="modal-x" onClick={() => setCancelOpen(false)}><X /></button><span className="eyebrow">CANCEL</span><h2>日程をキャンセル</h2><p>お店にお伝えするご事情をご記載ください。</p><textarea value={cancelReason} onChange={event => setCancelReason(event.target.value)} rows={5} placeholder="事情をご記載ください"/><div className="result-actions"><Button kind="secondary" onClick={() => setCancelOpen(false)}>戻る</Button><Button disabled={!cancelReason.trim() || responding} onClick={() => react(scheduleOffer, "interested", undefined, undefined, true)}>{responding ? "連絡中..." : "確定"}</Button></div></div></div>}
      <BottomNav role="seeker" screen="offers" go={go} badges={{ offers: newOfferCount }} />
    </main>
  );
}

function Gacha({ go }: { go: (s: Screen) => void }) {
  const [tickets, setTickets] = useState({ registration_invite: 0, interview: 0 });
  const [registrationItems, setRegistrationItems] = useState<GachaItemRecord[]>([]);
  const [interviewItems, setInterviewItems] = useState<GachaItemRecord[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [result, setResult] = useState<GachaItemRecord | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [oddsOpen, setOddsOpen] = useState<{ title: string; items: GachaItemRecord[] } | null>(null);
  const [requestingPrize, setRequestingPrize] = useState(false);
  const [rank, setRank] = useState("A");
  useEffect(() => {
    const lineUserId = getActiveLineUserId();
    bootstrapTemporaryUser(lineUserId)
      .then(() => fetchGachaState(lineUserId))
      .then(state => setTickets({
        registration_invite: safeNumber(state.registration_invite),
        interview: safeNumber(state.interview),
      }))
      .catch(() => undefined);
    fetchGachaState(lineUserId).then(state => setRank(state.rank || "A")).catch(() => undefined);
    fetchGachaItems("registration_invite").then(items => setRegistrationItems(safeArray(items))).catch(() => setRegistrationItems([]));
    fetchGachaItems("interview").then(items => setInterviewItems(safeArray(items))).catch(() => setInterviewItems([]));
  }, []);
  const spin = async (ticketType: "registration_invite" | "interview") => {
    if (!tickets[ticketType] || drawing) return;
    setDrawing(true);
    setTickets(current => ({ ...current, [ticketType]: current[ticketType] - 1 }));
    try {
      const [item] = await Promise.all([
        spinGacha(getActiveLineUserId(), ticketType),
        new Promise(resolve => setTimeout(resolve, 1700)),
      ]);
      setResult(item);
    } catch {
      setTickets(current => ({ ...current, [ticketType]: current[ticketType] + 1 }));
    } finally {
      setDrawing(false);
    }
  };
  const probabilityWeight = (item: GachaItemRecord) => {
    const rarity = String(item.rarity || "").toUpperCase();
    const high = ["UR", "SSR", "S"].includes(rarity);
    const middle = ["SR", "A"].includes(rarity);
    const multiplier = rank === "S" ? (high ? 1.4 : middle ? 1.15 : .82) : rank === "B" ? (high ? .75 : middle ? .9 : 1.15) : rank === "C" ? (high ? .5 : middle ? .75 : 1.35) : 1;
    return Number(item.probability || 0) * multiplier;
  };
  const formatProbability = (item: GachaItemRecord, items: GachaItemRecord[]) => {
    const total = items.reduce((sum, current) => sum + probabilityWeight(current), 0);
    if (!total) return "設定中";
    return `${((probabilityWeight(item) / total) * 100).toFixed(2)}%`;
  };
  const requestPrize = async (item: GachaItemRecord) => {
    setRequestingPrize(true);
    try {
      await fetch("/api/line/prize-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineUserId: getActiveLineUserId(), itemName: item.name, description: item.description }),
      });
      setResult(null);
      go("profile");
    } finally {
      setRequestingPrize(false);
    }
  };
  return (
    <main className="app-shell gacha-page premium-gacha">
      <AppHeader title="ガチャ" action={<div className="gacha-wallet-mini ticket-split"><span title="ガチャチケット"><i className="ticket-icon silver"><Ticket size={17}/></i>{tickets.registration_invite}</span><span title="面接チケット"><i className="ticket-icon gold"><Ticket size={17}/></i>{tickets.interview}</span></div>} />
      <section className="gacha-dashboard">
        <div className="gacha-heading compact"><span>PREMIUM REWARDS</span></div>
        <article className="gacha-campaign registration-card bubble-gacha-card">
          <img className="bubble-gacha-image" src="/optimized-assets/launch-campaign.jpg" alt="MAXVALUEローンチ記念限定ガチャ" />
          <div className="campaign-copy"><span>登録・招待ガチャ</span><h2>登録招待ガチャ</h2><p>SOUMEI、セットサロン、美容施術、SNS支援などの景品が当たります。</p></div>
          <button className="odds-button" onClick={() => setOddsOpen({ title: "登録招待ガチャ", items: registrationItems })}>当選確率</button>
          {tickets.registration_invite > 0 ? <Button onClick={() => spin("registration_invite")} disabled={drawing}><Sparkles size={18} /> ガチャを回す</Button> : <Button kind="secondary" className="invite-spin-button" onClick={() => setInviteOpen(true)}>招待してガチャを引く</Button>}
        </article>
        <article className="gacha-campaign interview-card bubble-gacha-card">
          <img className="bubble-gacha-image" src="/optimized-assets/300-users-campaign.jpg" alt="300ユーザー突破ゴールドチケット限定ガチャ" />
          <div className="campaign-copy"><span>面接後限定ガチャ</span><h2>面接後限定ガチャ</h2><p>面接チケットだけの限定ラインナップ。来店後の楽しみをもう一つ。</p></div>
          <button className="odds-button" onClick={() => setOddsOpen({ title: "面接後限定ガチャ", items: interviewItems })}>当選確率</button>
          {tickets.interview > 0 ? <Button kind="secondary" onClick={() => spin("interview")} disabled={drawing}>面接チケットで回す</Button> : <Button kind="secondary" className="invite-spin-button" onClick={() => setInviteOpen(true)}>招待してチケットをもらう</Button>}
        </article>
      </section>
      {drawing && <div className="gacha-draw-overlay soda-draw"><div className="soda-bubbles">{Array.from({length: 54}, (_, i) => {
        const size = 6 + (i % 9) * 3;
        return <i key={i} style={{
          left: `${(i * 37) % 100}%`,
          width: `${size}px`,
          height: `${size}px`,
          animationDuration: `${2.5 + (i % 8) * .38}s`,
          animationDelay: `${-(i % 12) * .31}s`,
          opacity: .32 + (i % 5) * .12,
        }} />;
      })}</div><b>抽選中です。</b></div>}
      {result && <div className="modal-backdrop prize-backdrop"><div className="result-modal prize-result"><button onClick={() => setResult(null)}><X /></button><span>CONGRATULATIONS</span><h2>{result.name}</h2>{result.image_url ? <img className="prize-result-image" src={result.image_url} alt={result.name} /> : <PrizeArtwork rarity={result.rarity} />}<p>{result.description}</p><div className="result-actions"><Button kind="secondary" onClick={() => setResult(null)}>ガチャ画面に戻る</Button><Button disabled={requestingPrize} onClick={() => requestPrize(result)}>{requestingPrize ? "申請中..." : "すぐ利用申請"}</Button></div></div></div>}
      {inviteOpen && <div className="modal-backdrop"><div className="share-modal"><button className="modal-x" onClick={() => setInviteOpen(false)}><X /></button><span className="eyebrow">INVITE</span><h2>招待URL</h2><p>友達が登録するとガチャチケットが付与されます。</p><div className="copy-url">https://maxvalue-seven.vercel.app/?screen=signin&amp;ref={getActiveLineUserId().slice(-6)}</div><Button onClick={() => copyText(`https://maxvalue-seven.vercel.app/?screen=signin&ref=${getActiveLineUserId().slice(-6)}`)}>コピーする</Button></div></div>}
      {oddsOpen && <div className="modal-backdrop"><div className="odds-modal"><button className="modal-x" onClick={() => setOddsOpen(null)}><X /></button><span className="eyebrow">PROBABILITY</span><h2>{oddsOpen.title}</h2><p>現在のランク：{rank}（ランク補正後）</p><div className="odds-list">{oddsOpen.items.map(item => <div key={item.id}><span>{item.rarity || "PRIZE"}</span><b>{item.name}</b><small>{formatProbability(item, oddsOpen.items)}</small></div>)}</div><Button kind="secondary" onClick={() => setOddsOpen(null)}>閉じる</Button></div></div>}
      <BottomNav role="seeker" screen="gacha" go={go} />
    </main>
  );
}

function profileInputFromRecord(profile: SeekerProfileRecord, overrides: Partial<Parameters<typeof saveSeekerProfile>[1]> = {}) {
  return {
    nickname: profile.nickname,
    fullName: profile.full_name || profile.nickname,
    age: profile.age,
    workExperience: profile.work_experience,
    desiredRegion: profile.desired_region,
    desiredArea: profile.desired_area,
    desiredShift: profile.desired_shift,
    startTiming: profile.start_timing,
    currentRegion: profile.current_region || "",
    currentArea: profile.current_area || "",
    currentClubId: profile.current_club_id || undefined,
    blockedClubIds: safeArray(profile.blocked_club_ids),
    currentHourlyRange: profile.current_hourly_range || "",
    currentMonthlySalesRange: profile.current_monthly_sales_range || "",
    photo1Url: profile.photo_1_url || "",
    photo2Url: profile.photo_2_url || "",
    photo3Url: profile.full_body_photo_url || "",
    desiredClubIds: safeArray(profile.desired_club_ids),
    ...overrides,
  };
}

async function uploadProfileImage(file: File, slot: number) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) throw new Error("JPEG・PNG・WebP・HEIC画像を選択してください");
  let uploadFile = file;
  if (file.size > 1_800_000 || /heic|heif/i.test(file.type)) {
    try {
      const bitmap = await createImageBitmap(file);
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .86));
        if (blob) uploadFile = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      }
      bitmap.close();
    } catch {
      // HEIC decoding is browser-dependent. The server accepts the original file as a fallback.
    }
  }
  const form = new FormData();
  form.append("file", uploadFile);
  form.append("slot", `photo_${slot + 1}`);
  form.append("lineUserId", getActiveLineUserId());
  const response = await fetch("/api/storage/upload", { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) throw new Error(data.error || "写真アップロードに失敗しました");
  return String(data.url);
}

function PhotoEdit({ go }: { go: (s: Screen) => void }) {
  const [profile, setProfile] = useState<SeekerProfileRecord | null>(null);
  const [photos, setPhotos] = useState(["", "", ""]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { fetchSeekerProfile(getActiveLineUserId()).then(value => { setProfile(value); if (value) setPhotos([value.photo_1_url || "", value.photo_2_url || "", value.full_body_photo_url || ""]); }).catch(error => setMessage(error.message)); }, []);
  return <main className="app-shell soft-bg edit-only-page"><AppHeader title="プロフィール写真" back={() => go("profile")} /><section className="page-content"><div className="screen-intro compact"><span>PHOTO EDIT</span><h1>写真を編集</h1><p>1枚目は必須、2枚目・3枚目は任意です。</p></div><div className="upload-grid photo-edit-grid">{["メイン写真（必須）", "写真2（任意）", "写真3（任意）"].map((label, index) => <label className={`upload-box ${photos[index] ? "uploaded rose" : ""} ${uploading === index ? "uploading" : ""}`} key={label}><input type="file" accept="image/*" disabled={uploading !== null || saving} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; setMessage(""); setUploading(index); try { const url = await uploadProfileImage(file, index); setPhotos(current => current.map((item, position) => position === index ? url : item)); } catch (error) { setMessage(error instanceof Error ? error.message : "アップロードに失敗しました"); } finally { setUploading(null); } }} />{uploading === index ? <div className="uploading-state"><b>アップロード中...</b></div> : photos[index] ? <><img src={photos[index]} alt=""/><span>変更する</span></> : <><ImagePlus/><b>{label}</b><small>タップして追加</small></>}</label>)}</div>{message && <p className="form-error">{message}</p>}<Button disabled={!profile || !photos[0] || uploading !== null || saving} onClick={async () => { if (!profile) return; setSaving(true); setMessage(""); try { await saveSeekerProfile(getActiveLineUserId(), profileInputFromRecord(profile, { photo1Url: photos[0], photo2Url: photos[1], photo3Url: photos[2] })); go("profile"); } catch (error) { setMessage(error instanceof Error ? error.message : "保存に失敗しました"); } finally { setSaving(false); } }}>{saving ? "保存中..." : "写真を保存"}</Button></section></main>;
}

function ProfileEdit({ go }: { go: (s: Screen) => void }) {
  const [profile, setProfile] = useState<SeekerProfileRecord | null>(null);
  const [form, setForm] = useState({ age: "", experience: "", region: "", area: "", shift: "", timing: "", hourly: "", monthly: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { fetchSeekerProfile(getActiveLineUserId()).then(value => { setProfile(value); if (value) setForm({ age: String(value.age), experience: value.work_experience, region: value.desired_region, area: value.desired_area, shift: value.desired_shift, timing: value.start_timing, hourly: value.current_hourly_range || "", monthly: value.current_monthly_sales_range || "" }); }).catch(error => setMessage(error.message)); }, []);
  const set = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  return <main className="app-shell soft-bg edit-only-page"><AppHeader title="登録プロフィール編集" back={() => go("profile")} /><section className="page-content"><div className="form-stack"><Field label="年齢" required><select value={form.age} onChange={event => set("age", event.target.value)}><option value="">選択してください</option>{Array.from({length:17},(_,i)=>19+i).map(age => <option key={age} value={age}>{age === 35 ? "35歳以上" : `${age}歳`}</option>)}</select></Field><Field label="ナイトワーク経験" required><select value={form.experience} onChange={event => set("experience", event.target.value)}><option value="">選択してください</option>{["未経験","半年未満","半年〜1年","1年〜2年","2年以上"].map(value => <option key={value}>{value}</option>)}</select></Field><RegionAreaPicker label="希望地域" region={form.region as Region | ""} area={form.area} onRegion={region => { set("region", region); set("area", ""); }} onArea={area => set("area", area)} /><Field label="希望シフト" required><select value={form.shift} onChange={event => set("shift", event.target.value)}><option value="">選択してください</option>{["週3〜4","週4〜5","週5以上","検討中"].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="勤務開始予定" required><select value={form.timing} onChange={event => set("timing", event.target.value)}><option value="">選択してください</option>{["すぐ体入希望","今月中","良いお店があれば"].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="現在時給" required><input value={form.hourly} onChange={event => set("hourly", event.target.value)} /></Field><Field label="現在月売" required><input value={form.monthly} onChange={event => set("monthly", event.target.value)} /></Field></div>{message && <p className="form-error">{message}</p>}<Button disabled={!profile || saving} onClick={async () => { if (!profile) return; if (Object.values(form).some(value => !value.trim())) { setMessage("必須項目を入力してください"); return; } setSaving(true); try { await saveSeekerProfile(getActiveLineUserId(), profileInputFromRecord(profile, { fullName: "", age: Number(form.age), workExperience: form.experience, desiredRegion: form.region, desiredArea: form.area, desiredShift: form.shift, startTiming: form.timing, currentHourlyRange: form.hourly, currentMonthlySalesRange: form.monthly })); go("profile"); } catch (error) { setMessage(error instanceof Error ? error.message : "保存に失敗しました"); } finally { setSaving(false); } }}>{saving ? "保存中..." : "変更を保存"}</Button></section></main>;
}

function InstagramGate({ go }: { go: (s: Screen) => void }) {
  return <main className="instagram-gate"><Logo light/><span>Instagramからの方</span><h1>外部ブラウザーで<br/>開いてください</h1><p>Instagram内ブラウザーでは正常に登録できない場合があります。右上の「…」をタップし、「外部ブラウザーで開く」を選択してください。</p><div className="external-browser-guide"><Menu/><b>右上の「…」をタップ</b><ArrowRight/><span>外部ブラウザーで開く</span></div><Button kind="secondary" onClick={() => go("signin")}>通常ブラウザーで開いた方はこちら</Button></main>;
}

type AmbassadorProfileData = { name: string; region: string; photo_url: string; invite_code: string; referral_count: number; hired_count: number; referrals: Array<{ id: string; name: string; photo_url: string | null; hired: boolean }> };

function AmbassadorSetup({ go }: { go: (s: Screen) => void }) {
  const [name, setName] = useState(""); const [region, setRegion] = useState(""); const [photo, setPhoto] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  return <main className="app-shell soft-bg"><AppHeader title="アンバサダー登録" back={() => go("landing")}/><section className="page-content ambassador-setup"><div className="screen-intro"><span>AMBASSADOR</span><h1>登録情報</h1><p>紹介活動に必要な最小限の情報だけ登録します。</p></div><div className="form-stack"><Field label="名前" required><input value={name} onChange={event => setName(event.target.value)} /></Field><Field label="地域" required><select value={region} onChange={event => setRegion(event.target.value)}><option value="">選択してください</option><option>大阪</option><option>東京</option><option>その他</option></select></Field><label className={`upload-box ambassador-photo ${photo ? "uploaded rose" : ""}`}><input type="file" accept="image/*" disabled={busy} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); try { setPhoto(await uploadProfileImage(file, 0)); } catch (error) { setMessage(error instanceof Error ? error.message : "アップロードに失敗しました"); } finally { setBusy(false); } }}/>{photo ? <><img src={photo} alt=""/><span>変更する</span></> : <><Camera/><b>顔写真1枚</b><small>タップして追加</small></>}</label></div>{message && <p className="form-error">{message}</p>}<Button disabled={busy || !name || !region || !photo} onClick={async () => { setBusy(true); const response = await fetch("/api/ambassador/profile", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({lineUserId:getActiveLineUserId(),name,region,photoUrl:photo}) }); const data = await response.json().catch(()=>({})); setBusy(false); if (!response.ok) setMessage(data.error || "保存に失敗しました"); else go("ambassadorProfile"); }}>{busy ? "保存中..." : "登録を完了"}</Button></section></main>;
}

function AmbassadorProfile({ go }: { go: (s: Screen) => void }) {
  const [profile, setProfile] = useState<AmbassadorProfileData | null>(null); const [copied, setCopied] = useState("");
  useEffect(() => { fetch(`/api/ambassador/profile?lineUserId=${encodeURIComponent(getActiveLineUserId())}`, {cache:"no-store"}).then(async response => { if (response.status === 404) return go("ambassadorSetup"); const data = await response.json(); if (response.ok) setProfile(data); }).catch(()=>undefined); }, [go]);
  const base = "https://maxvalue-seven.vercel.app/?screen=signin"; const lineUrl = `${base}&ref=${encodeURIComponent(profile?.invite_code || "")}&src=line`; const instagramUrl = `${base}&ref=${encodeURIComponent(profile?.invite_code || "")}&src=ig`;
  const copy = async (value: string, type: string) => { await copyText(value); setCopied(type); };
  return <main className="app-shell soft-bg"><AppHeader title="アンバサダー"/><section className="ambassador-hero">{profile?.photo_url ? <img src={profile.photo_url} alt=""/> : <CircleUserRound/>}<h1>{profile?.name || "読込中"}</h1><p>{profile?.region}</p></section><section className="page-content"><div className="profile-stats ambassador-stats"><div><b>{profile?.referral_count || 0}</b><span>招待人数</span></div><div><b>{profile?.hired_count || 0}</b><span>採用人数</span></div></div><div className="ambassador-share-grid"><button onClick={() => copy(lineUrl,"line")}><MessageCircle/><b>LINEで送る</b><small>{copied === "line" ? "コピーしました" : "招待URLをコピー"}</small></button><button onClick={() => copy(instagramUrl,"ig")}><Send/><b>Instagramで送る</b><small>{copied === "ig" ? "コピーしました" : "外部ブラウザー案内付き"}</small></button></div><div className="section-title"><div><span>REFERRALS</span><h2>紹介したユーザー</h2></div></div><div className="account-admin-list">{safeArray(profile?.referrals).map(item => <article key={item.id}><div className="avatar small" style={item.photo_url ? {backgroundImage:`url(${item.photo_url})`,backgroundSize:"cover"}:undefined}>{!item.photo_url && safeInitial(item.name)}</div><div><h3>{item.name}</h3><p>{item.hired ? "採用" : "登録済み"}</p></div><ChevronRight/></article>)}</div></section></main>;
}

function FaceVerificationCard() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState("not_submitted");
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch(`/api/seeker/verification?lineUserId=${encodeURIComponent(getActiveLineUserId())}`, { cache: "no-store" })
      .then(response => response.json()).then(data => setStatus(String(data.status || "not_submitted"))).catch(() => undefined);
    return () => streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);
  const start = async () => {
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("このブラウザでは動画撮影に対応していません。SafariまたはChromeでお試しください。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 1_500_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
        setUploading(true);
        setInstruction("動画を保存中...");
        try {
          const type = recorder.mimeType || "video/webm";
          const extension = type.includes("mp4") ? "mp4" : "webm";
          const file = new File([new Blob(chunks, { type })], `face-verification.${extension}`, { type });
          const form = new FormData();
          form.append("file", file); form.append("slot", "face_verification"); form.append("lineUserId", getActiveLineUserId());
          const uploadResponse = await fetch("/api/storage/upload", { method: "POST", body: form });
          const upload = await uploadResponse.json().catch(() => ({}));
          if (!uploadResponse.ok || !upload.url) throw new Error(upload.error || "動画のアップロードに失敗しました");
          const saveResponse = await fetch("/api/seeker/verification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lineUserId: getActiveLineUserId(), videoUrl: upload.url }) });
          const saved = await saveResponse.json().catch(() => ({}));
          if (!saveResponse.ok) throw new Error(saved.error || "本人確認動画を保存できませんでした");
          setStatus("pending"); setMessage("動画を受け付けました。運営確認後にプロフィールへ反映します。");
        } catch (error) { setMessage(error instanceof Error ? error.message : "動画を保存できませんでした"); }
        finally { setUploading(false); setInstruction(""); }
      };
      setRecording(true); setInstruction("正面を向いてください"); recorder.start(500);
      window.setTimeout(() => setInstruction("ゆっくり左を向いてください"), 2500);
      window.setTimeout(() => setInstruction("ゆっくり右を向いてください"), 5200);
      window.setTimeout(() => { setInstruction("正面に戻ってください"); if (recorder.state === "recording") recorder.stop(); }, 8500);
    } catch (error) { setRecording(false); setMessage(error instanceof Error ? error.message : "カメラを開始できませんでした"); }
  };
  return <div className="face-verification-card"><div><span>VIDEO VERIFICATION</span><h3>動画本人確認でオファー率アップ</h3><p>正面、左、右を向く約9秒の動画を撮影します。公開プロフィールには表示されません。</p></div><div className={`face-capture ${recording ? "active" : ""}`}><video ref={videoRef} muted playsInline />{!recording && <Camera size={30}/>} {instruction && <b>{instruction}</b>}</div>{status === "pending" && <div className="form-success">審査待ち</div>}{message && <p className={status === "pending" ? "form-success" : "form-error"}>{message}</p>}<Button disabled={recording || uploading || status === "pending"} onClick={start}>{recording ? "撮影中..." : uploading ? "保存中..." : status === "pending" ? "提出済み" : "撮影を始める"}</Button></div>;
}

function Profile({ go }: { go: (s: Screen) => void }) {
  const [copied, setCopied] = useState(false);
  const [prizeOpen, setPrizeOpen] = useState<GachaItemRecord | null>(null);
  const [allPrizesOpen, setAllPrizesOpen] = useState(false);
  const [prizes, setPrizes] = useState<GachaItemRecord[]>([]);
  const [profile, setProfile] = useState<SeekerProfileRecord | null>(null);
  const [linePictureUrl, setLinePictureUrl] = useState("");
  const [requestingPrize, setRequestingPrize] = useState(false);
  const displayPrizes = useMemo(() => {
    const setSalonImage = prizes.find(prize => prize.name.includes("セットサロン") && prize.image_url)?.image_url;
    if (!setSalonImage) return prizes;
    return prizes.map(prize => prize.name.includes("セットサロン") ? { ...prize, image_url: setSalonImage } : prize);
  }, [prizes]);
  useEffect(() => {
    const lineUserId = getActiveLineUserId();
    setLinePictureUrl(getActiveLinePictureUrl());
    fetch("/api/auth/line/status")
      .then(response => response.json())
      .then(status => setLinePictureUrl(status.profile?.pictureUrl || ""))
      .catch(() => undefined);
    bootstrapTemporaryUser(lineUserId).then(async () => {
      const [gachaState, seekerProfile] = await Promise.all([
        fetchGachaState(lineUserId),
        fetchSeekerProfile(lineUserId),
      ]);
      setPrizes(safeArray(gachaState.results));
      setProfile(seekerProfile);
    }).catch(() => undefined);
  }, []);
  const requestPrize = async (item: GachaItemRecord) => {
    setRequestingPrize(true);
    try {
      await fetch("/api/line/prize-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineUserId: getActiveLineUserId(), itemName: item.name, description: item.description }),
      });
      setPrizeOpen(null);
    } finally {
      setRequestingPrize(false);
    }
  };
  const photos = [profile?.photo_1_url || linePictureUrl, profile?.photo_2_url, profile?.full_body_photo_url];
  const inviteUrl = `https://maxvalue-seven.vercel.app/?screen=signin&ref=${encodeURIComponent(profile?.invite_code || "")}`;
  const blockedClubs = safeArray(profile?.blocked_clubs);
  const profileRows = profile ? [
    ["年齢", `${profile.age}歳`],
    ["ナイトワーク経験", profile.work_experience],
    ["希望地域", `${profile.desired_region} / ${profile.desired_area}`],
    ["希望シフト", profile.desired_shift],
    ["勤務開始予定", profile.start_timing],
    ["現在or直近勤務店", profile.current_club || "未選択"],
    ["見られたくない店", blockedClubs.join("、") || "未選択"],
    ["現在時給", profile.current_hourly_range || "未選択"],
    ["現在月売", profile.current_monthly_sales_range || "未選択"],
  ] : [];
  return (
    <main className="app-shell soft-bg">
      <AppHeader title="マイページ" />
      <section className="profile-hero profile-hero-new">
        <div className="profile-gallery">
          {photos.map((photo, index) => <div key={index} className={`profile-photo ${index === 0 ? "main-photo rose" : `sub-photo ${index === 1 ? "sand" : "night"}`}`} style={photo ? {backgroundImage: `url(${photo})`, backgroundSize: "cover"} : undefined}>{!photo && <b className="photo-empty">写真未登録</b>}{index === 0 && <span>MAIN</span>}</div>)}
          <button className="gallery-edit" onClick={() => go("photoEdit")}><Camera size={17} /> 写真を編集</button>
        </div>
        <div className="profile-main profile-identity"><div><span className="verified"><BadgeCheck size={15} /> 登録情報</span><h1>{profile?.nickname || "プロフィール未登録"}</h1><p>{profile ? `${profile.age}歳・${profile.desired_region} / ${profile.desired_area}` : "登録フォームを完了してください"}</p></div></div>
        <div className="profile-stats"><div><b>0</b><span>紹介した人数</span></div><div><b>0</b><span>採用された人数</span></div><div><b>{displayPrizes.length}</b><span>獲得した景品</span></div></div>
      </section>
      <section className="page-content profile-content">
        <div className="invite-card compact-invite"><div><span><Ticket size={16} /> あなたの招待リンク</span><b>{profile?.invite_code ? inviteUrl : "登録完了後に発行"}</b></div><button onClick={() => { if (profile?.invite_code) copyText(inviteUrl); setCopied(true); }}>{copied ? <Check /> : <Copy />}</button><p>友達が登録すると、あなたにもガチャチケットが1枚届きます。</p></div>
        {profile && <FaceVerificationCard />}
        <div className="section-title"><div><span>COLLECTION</span><h2>ガチャ獲得物</h2></div><button onClick={() => setAllPrizesOpen(true)}>すべて見る</button></div>
        <div className="reward-grid">
          {Array.from({ length: 4 }, (_, index) => displayPrizes[index]).map((prize, index) => <button key={prize?.id || index} className={`reward-tile ${prize ? "" : "empty"}`} onClick={() => prize && setPrizeOpen(prize)} disabled={!prize}>
            {prize ? (prize.image_url ? <img src={prize.image_url} alt={prize.name} /> : <PrizeArtwork compact rarity={prize.rarity} />) : <Gift size={24} />}
            <span>{prize?.name || "未獲得"}</span>
            {prize && <small>利用申請</small>}
          </button>)}
        </div>
        <div className="section-title profile-title"><div><span>PROFILE</span><h2>登録プロフィール</h2></div><button className="round-edit" onClick={() => go("profileEdit")}>編集</button></div>
        <div className="profile-table">{profileRows.length ? profileRows.map(([k,v]) => <div key={k}><span>{k}</span><b>{v}</b></div>) : <div><span>プロフィール</span><b>未登録</b></div>}</div>
      </section>
      {allPrizesOpen && <div className="modal-backdrop"><div className="all-prizes-modal"><button className="modal-x" aria-label="閉じる" onClick={() => setAllPrizesOpen(false)}><X /></button><span className="eyebrow">COLLECTION</span><h2>ガチャ獲得物一覧</h2><p>獲得した景品を新しい順に表示しています。</p><div className="all-prizes-grid">{displayPrizes.map((prize, index) => <button key={`${prize.id || prize.name}-${index}`} onClick={() => { setAllPrizesOpen(false); setPrizeOpen(prize); }}>{prize.image_url ? <img src={prize.image_url} alt={prize.name} /> : <PrizeArtwork compact rarity={prize.rarity} />}<span><b>{prize.name}</b><small>{prize.rarity || "PRIZE"}</small></span><ChevronRight /></button>)}</div>{!displayPrizes.length && <div className="empty-state compact"><Gift/><h3>獲得した景品はまだありません</h3></div>}<Button kind="secondary" onClick={() => { setAllPrizesOpen(false); go("gacha"); }}>ガチャ画面へ</Button></div></div>}
      {prizeOpen && <div className="modal-backdrop prize-backdrop"><div className="prize-detail-modal"><button className="modal-x" onClick={() => setPrizeOpen(null)}><X /></button><span>REWARD</span><h2>{prizeOpen.name}</h2>{prizeOpen.image_url ? <img className="prize-result-image" src={prizeOpen.image_url} alt={prizeOpen.name} /> : <PrizeArtwork rarity={prizeOpen.rarity} />}<div className="prize-description"><b>{prizeOpen.description}</b><p>利用申請を送ると、運営LINEで確認できるように保存します。</p></div><div className="result-actions"><Button kind="secondary" onClick={() => setPrizeOpen(null)}>戻る</Button><Button disabled={requestingPrize} onClick={() => requestPrize(prizeOpen)}>{requestingPrize ? "申請中..." : "利用申請する"}</Button></div></div></div>}
      <BottomNav role="seeker" screen="profile" go={go} />
    </main>
  );
}

function Talent({ go, admin = false }: { go: (s: Screen) => void; admin?: boolean }) {
  const { selectedClub } = useAdminCapability();
  const [talentProfiles, setTalentProfiles] = useState<AdminSeekerRecord[]>([]);
  const [adminOffers, setAdminOffers] = useState<AdminOfferRecord[]>([]);
  const [adminGachaResults, setAdminGachaResults] = useState<AdminGachaResultRecord[]>([]);
  const [adminTab, setAdminTab] = useState<"users" | "offers" | "interviews" | "gacha">("users");
  const [adminAccountType, setAdminAccountType] = useState<"seeker" | "club_staff" | "ambassador" | "admin">("seeker");
  const [adminAccounts, setAdminAccounts] = useState<Array<Record<string, unknown>>>([]);
  const [selectedAccount, setSelectedAccount] = useState<Record<string, unknown> | null>(null);
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [experienceFilter, setExperienceFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [detail, setDetail] = useState<AdminSeekerRecord | null>(null);
  const [editUser, setEditUser] = useState<AdminSeekerRecord | null>(null);
  const [messageUser, setMessageUser] = useState<AdminSeekerRecord | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ url: string; label: string } | null>(null);
  const [storeTalentTab, setStoreTalentTab] = useState<"new" | "offer_count">("new");
  const [interestOnly, setInterestOnly] = useState(false);
  const [adminTalentSort, setAdminTalentSort] = useState<"new" | "offer_count">("new");
  const [rankFilter, setRankFilter] = useState("");
  const [adminOfferFilter, setAdminOfferFilter] = useState<"all" | "interested" | "pending" | "rejected">("all");
  const [gachaFilter, setGachaFilter] = useState<"requested" | "unused" | "completed">("requested");
  const [interestedTalent, setInterestedTalent] = useState<Array<AdminSeekerRecord & { interest_status?: string }>>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const dataRequestRef = useRef(0);
  useEffect(() => {
    const requestId = ++dataRequestRef.current;
    setDataLoading(true);
    void (async () => {
      try {
        if (admin) {
          const [seekers, offers, gachaResults, accounts] = await Promise.all([
            fetchAdminSeekers(),
            fetchAdminOffers(),
            fetchAdminGachaResults(),
            fetchAdminAccounts(),
          ]);
          if (requestId !== dataRequestRef.current) return;
          setTalentProfiles(safeArray(seekers) as AdminSeekerRecord[]);
          setAdminOffers(safeArray(offers));
          setAdminGachaResults(safeArray(gachaResults));
          setAdminAccounts(safeArray(accounts));
        } else {
          const [seekers, interests] = await Promise.all([
            fetchSeekers(selectedClub?.id || ""),
            selectedClub?.id
              ? fetch(`/api/club/interests?clubId=${encodeURIComponent(selectedClub.id)}`, { cache: "no-store" }).then(response => response.json())
              : Promise.resolve([]),
          ]);
          if (requestId !== dataRequestRef.current) return;
          setTalentProfiles(safeArray(seekers) as AdminSeekerRecord[]);
          setInterestedTalent(safeArray(interests));
        }
      } catch {
        if (requestId !== dataRequestRef.current) return;
        setTalentProfiles([]);
        if (admin) {
          setAdminOffers([]);
          setAdminGachaResults([]);
          setAdminAccounts([]);
        } else {
          setInterestedTalent([]);
        }
      } finally {
        if (requestId === dataRequestRef.current) setDataLoading(false);
      }
    })();
    return () => {
      dataRequestRef.current += 1;
    };
  }, [admin, selectedClub?.id]);
  const visibleTalent = talentProfiles.filter(t =>
    (!admin || String(t.role || "seeker") === "seeker") &&
    (!query || normalizeSearch(`${t.nickname} ${t.region} ${t.area} ${t.experience}`).includes(normalizeSearch(query)) || normalizeSearch(`${t.nickname} ${t.region} ${t.area} ${t.experience}`, true).includes(normalizeSearch(query, true))) &&
    (!areaFilter || t.area === areaFilter || t.region === areaFilter) &&
    (!experienceFilter || t.experience === experienceFilter) &&
    (!shiftFilter || t.desired_shift === shiftFilter) &&
    (!rankFilter || (rankFilter === "LastCall" ? t.last_call_cast : t.rank === rankFilter))
  ).sort((a, b) => (storeTalentTab === "offer_count" || (admin && adminTalentSort === "offer_count"))
    ? Number(b.offer_count || 0) - Number(a.offer_count || 0)
    : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const visibleAdminOffers = adminOffers.filter(offer => adminOfferFilter === "all" || (adminOfferFilter === "pending" ? offer.status === "interested" && !offer.selected_date : offer.status === adminOfferFilter));
  return (
    <main className="app-shell">
      <AppHeader title={admin ? "ユーザー管理" : "求職者を探す"} />
      <section className="page-content talent-content">
        {admin && <div className="admin-account-tabs four"><button className={adminAccountType === "seeker" ? "active" : ""} onClick={() => setAdminAccountType("seeker")}>求職者</button><button className={adminAccountType === "club_staff" ? "active" : ""} onClick={() => setAdminAccountType("club_staff")}>お店</button><button className={adminAccountType === "ambassador" ? "active" : ""} onClick={() => setAdminAccountType("ambassador")}>アンバサダー</button><button className={adminAccountType === "admin" ? "active" : ""} onClick={() => setAdminAccountType("admin")}>管理者</button></div>}
        {!admin && <div className="store-talent-tabs"><button className={storeTalentTab === "new" ? "active" : ""} onClick={() => { setStoreTalentTab("new"); setInterestOnly(false); }}>新着求職者</button><button className={storeTalentTab === "offer_count" ? "active" : ""} onClick={() => { setStoreTalentTab("offer_count"); setInterestOnly(false); }}>オファー数順</button></div>}
        {admin ? <div className="admin-tabs">
          <button className={adminTab === "users" ? "active" : ""} onClick={() => setAdminTab("users")}>ユーザー {dataLoading ? "…" : adminAccountType === "seeker" ? talentProfiles.length : adminAccounts.filter(account => account.role === adminAccountType).length}</button>
          <button className={adminTab === "offers" ? "active" : ""} onClick={() => setAdminTab("offers")}>オファー {dataLoading ? "…" : adminOffers.length}</button>
          <button className={adminTab === "interviews" ? "active" : ""} onClick={() => setAdminTab("interviews")}>面接</button>
          <button className={adminTab === "gacha" ? "active" : ""} onClick={() => setAdminTab("gacha")}>ガチャ {dataLoading ? "…" : adminGachaResults.length}</button>
        </div> : <div className="talent-heading"><div><span>NEW TALENT</span><h1>新着の求職者</h1></div><button onClick={() => setFiltersOpen(open => !open)}><LayoutGrid size={18}/> 絞り込み</button></div>}
        {admin && <div className="search-box"><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="名前・地域・経験で検索" /></div>}
        {!admin && <button className={`interest-filter-cta ${interestOnly ? "active" : ""}`} onClick={() => setInterestOnly(value => !value)}><Heart size={18}/> 関心があるユーザー <b>{interestedTalent.filter(item => item.interest_status === "pending").length}</b></button>}
        {!admin && filtersOpen && <div className="talent-filter-panel">
          <div className="talent-filter-grid">
          <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}><option value="">地域・エリア</option><option>大阪</option><option>東京</option><option>北新地</option><option>ミナミ</option><option>六本木</option><option>銀座</option><option>歌舞伎町</option></select>
          <select value={experienceFilter} onChange={e => setExperienceFilter(e.target.value)}><option value="">経験</option><option>未経験</option><option>半年未満</option><option>半年〜1年</option><option>1年〜2年</option><option>2年以上</option></select>
          <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}><option value="">希望シフト</option><option>週3〜4</option><option>週4〜5</option><option>週5以上</option><option>検討中</option></select>
          <select defaultValue="new"><option value="new">新着順</option><option value="profile">プロフィール充実順</option><option value="age">年齢順</option></select>
          </div>
          <button className="filter-clear" onClick={() => { setAreaFilter(""); setExperienceFilter(""); setShiftFilter(""); }}>条件をクリア</button>
        </div>}
        {dataLoading && <div className="empty-state compact admin-loading-state"><LoaderCircle className="spin"/><h2>ユーザー情報を読み込み中です</h2></div>}
        {!dataLoading && (!admin || (adminTab === "users" && adminAccountType === "seeker")) && !interestOnly && <>{admin && <div className="sort-tabs"><button className={adminTalentSort === "new" ? "active" : ""} onClick={() => setAdminTalentSort("new")}>新着順</button><button className={adminTalentSort === "offer_count" ? "active" : ""} onClick={() => setAdminTalentSort("offer_count")}>オファー数順</button></div>}<div className="rank-filter-row">{["","S","A","B","C","LastCall"].map(rank => <button key={rank || "all"} className={rankFilter === rank ? "active" : ""} onClick={() => setRankFilter(rank)}>{rank || "すべて"}</button>)}</div>
        <div className="talent-grid">{visibleTalent.map((t, index) => <article key={t.id} className="talent-card" onClick={() => setDetail(t)}>
          <div className={`talent-photo ${talentHues[index % talentHues.length]}`} style={(t.photo_1_url || t.line_picture_url) ? { backgroundImage: `url(${t.photo_1_url || t.line_picture_url})`, backgroundSize: "cover" } : undefined}>{!(t.photo_1_url || t.line_picture_url) && <CircleUserRound className="talent-placeholder-icon"/>}{index < 2 && <span className="new-badge">NEW</span>}</div>
          <div>{admin && <h3>{t.nickname}</h3>}<p>{t.region}・{t.age}歳</p><span>{t.experience}</span></div>
        </article>)}</div></>}
        {!admin && interestOnly && <div className="interest-talent-list">{interestedTalent.map(item => <article key={item.id}><button className="interest-talent-main" onClick={() => setDetail(item)}><div className="avatar" style={(item.photo_1_url || item.line_picture_url) ? { backgroundImage: `url(${item.photo_1_url || item.line_picture_url})`, backgroundSize: "cover" } : undefined}>{!(item.photo_1_url || item.line_picture_url) && <CircleUserRound/>}</div><div><b>{item.age}歳</b><span>{item.region} / {item.area} / {item.experience}</span></div><small>{item.interest_status === "pending" ? "未回答" : item.interest_status === "accepted" ? "受け入れ" : "見送り"}</small></button>{item.interest_status === "pending" && <div className="interest-actions"><Button kind="secondary" onClick={async () => { await fetch("/api/club/interests", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ seekerId: item.id, clubId: selectedClub?.id, status: "rejected" }) }); setInterestedTalent(current => current.map(row => row.id === item.id ? {...row, interest_status: "rejected"} : row)); }}>見送る</Button><Button onClick={async () => { await fetch("/api/club/interests", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ seekerId: item.id, clubId: selectedClub?.id, status: "accepted" }) }); setInterestedTalent(current => current.map(row => row.id === item.id ? {...row, interest_status: "accepted"} : row)); }}>受け入れる</Button></div>}</article>)}</div>}
        {!dataLoading && admin && adminTab === "users" && adminAccountType !== "seeker" && <div className="account-admin-list">{adminAccounts.filter(account => account.role === adminAccountType).map(account => <article key={String(account.id)} onClick={() => setSelectedAccount(account)}><div className="avatar small" style={account.line_picture_url ? { backgroundImage: `url(${String(account.line_picture_url)})`, backgroundSize: "cover" } : undefined}>{!account.line_picture_url && safeInitial(account.name)}</div><div><h3>{String(account.name || "名前未設定")}</h3><p>{adminAccountType === "club_staff" ? String(account.club_name || "店舗未紐付け") : adminAccountType === "ambassador" ? `紹介 ${Number(account.referral_count || 0)}人` : "管理者"}</p></div><small>{formatDate(account.created_at)}</small></article>)}</div>}
        {admin && adminTab === "offers" && <><div className="status-filter-row">{[["all","すべて"],["interested","興味あり"],["pending","日程未調整"],["rejected","興味なし"]].map(([value,label]) => <button key={value} className={adminOfferFilter === value ? "active" : ""} onClick={() => setAdminOfferFilter(value as typeof adminOfferFilter)}>{label}</button>)}</div><div className="offer-list">{visibleAdminOffers.map(offer => <article key={offer.id} className="offer-card">
          <div className="offer-card-head"><div className="club-logo">{offer.club_name?.slice(0, 1) || "?"}</div><div><span>{offer.area || "エリア未設定"}</span><h2>{offer.club_name || "店舗未設定"}</h2></div>{offer.is_test && <b className="new-badge">TEST</b>}</div>
          <div className="offer-condition"><div><small>オファー時給</small><strong>¥{formatYen(offer.hourly_wage)}<i>/時</i></strong></div><div><small>保証期間</small><strong>{offer.guarantee_period}</strong></div></div>
          <p className="offer-note">{offer.seeker_name ? `${offer.seeker_name} 宛` : "求職者未指定"} / {offer.status}</p>
          {offer.comment && <div className="perk-line"><Send size={17} /><span>{offer.comment}</span></div>}
        </article>)}</div></>}
        {admin && adminTab === "interviews" && <AdminInterviewPanel />}
        {admin && adminTab === "gacha" && <><div className="status-filter-row"><button className={gachaFilter === "requested" ? "active" : ""} onClick={() => setGachaFilter("requested")}>利用申請</button><button className={gachaFilter === "unused" ? "active" : ""} onClick={() => setGachaFilter("unused")}>未申請</button><button className={gachaFilter === "completed" ? "active" : ""} onClick={() => setGachaFilter("completed")}>利用済み</button></div><div className="offer-list">{adminGachaResults.filter(result => result.used_status === gachaFilter).map(result => <article key={result.id} className="offer-card">
          <div className="offer-card-head"><div className="club-logo">{result.rarity}</div><div><span>{result.used_status}</span><h2>{result.item_name}</h2></div>{result.is_test && <b className="new-badge">TEST</b>}</div>
          <p className="offer-note">{result.user_name || "ユーザー未設定"} / {formatDateTime(result.created_at)}</p>
          <button className="perk-line result-profile-link" onClick={() => { const user = talentProfiles.find(item => item.nickname === result.user_name); if (user) setDetail(user); }}><Gift size={17} /><span>ユーザープロフィールを確認</span></button>
        </article>)}</div></>}
      </section>
      {detail && (() => {
        const mainPhoto = detail.photo_1_url || detail.line_picture_url || "";
        const subPhotos = [detail.photo_2_url, detail.full_body_photo_url, detail.line_picture_url]
          .filter((url): url is string => Boolean(url && url !== mainPhoto));
        return <div className="detail-sheet"><div className="sheet-header"><button onClick={() => setDetail(null)}><ArrowLeft /></button><b>求職者プロフィール</b><span /></div>
          {mainPhoto && <div className="detail-photos clean-gallery">
            <button type="button" className="detail-photo detail-photo-button main" style={{ backgroundImage: `url(${mainPhoto})`, backgroundSize: "cover" }} onClick={() => setPhotoPreview({ url: mainPhoto, label: "プロフィール写真" })} />
            {subPhotos.slice(0, 3).map((url, index) => <button type="button" key={`${url}-${index}`} className={`detail-photo detail-photo-button thumb ${talentHues[index + 1]}`} style={{ backgroundImage: `url(${url})`, backgroundSize: "cover" }} onClick={() => setPhotoPreview({ url, label: "プロフィール写真" })} />)}
          </div>}
          <div className="detail-body"><span className="verified"><BadgeCheck/> 登録情報確認済み</span><h1>{admin ? detail.nickname : `${detail.age}歳`}{admin && <small>{detail.age}歳</small>}</h1><h3>プロフィール</h3><div className="profile-table compact"><div><span>希望地域</span><b>{detail.region} / {detail.area}</b></div><div><span>経験</span><b>{detail.experience}</b></div><div><span>希望シフト</span><b>{detail.desired_shift}</b></div><div><span>勤務開始予定</span><b>{detail.start_timing}</b></div>{admin && <><div><span>現在or直近勤務店</span><b>{detail.current_club || "未設定"}</b></div><div><span>現在時給</span><b>{detail.current_hourly_range || "未設定"}</b></div><div><span>現在月売</span><b>{detail.current_monthly_sales_range || "未設定"}</b></div><div><span>ガチャチケット</span><b>{detail.gacha_ticket_count || 0}</b></div><div><span>ランク</span><b>{detail.rank || "未設定"}</b></div></>}</div><h3>過去のオファー</h3><div className="past-offer-list">{safeArray(detail.past_offers).length ? safeArray(detail.past_offers).map(offer => <article key={String(offer.id)} className="past-offer-card"><div className="past-offer-head"><div className="past-offer-logo" style={offer.club_logo_url ? { backgroundImage: `url(${offer.club_logo_url})`, backgroundSize: "cover" } : undefined}>{!offer.club_logo_url && safeInitial(offer.club_name || "店")}</div><div><b>{offer.club_name || "店舗未設定"}</b><time>{formatDateTime(offer.created_at)}</time></div><span className={`status-chip ${offer.status === "sent" ? "no_response" : offer.status}`}>{offerStatusLabel(offer.status)}</span></div><strong>¥{formatYen(offer.hourly_wage)} / {offer.guarantee_period || "保証未設定"}</strong><p>{offer.comment || "コメントなし"}</p><div className="response-meta"><span>{nextActionLabel(offer.next_action)}</span><span>{offer.selected_date ? `希望日 ${formatDate(offer.selected_date)}` : "日程未確定"}</span><span>{responseSourceLabel(offer.response_source)}</span><span>{responseStageLabel(offer.response_status)}</span></div></article>) : <p>この求職者への過去オファーはまだありません。</p>}</div></div><div className="sheet-actions two">{admin ? <><Button onClick={() => setEditUser(detail)}>編集する</Button><Button kind="ghost" onClick={() => setMessageUser(detail)}>メッセージ</Button></> : <><Button kind="secondary" onClick={() => setDetail(null)}>戻る</Button><Button onClick={() => setOfferOpen(true)}>オファーする</Button></>}</div></div>;
      })()}
      {photoPreview && <div className="modal-backdrop photo-preview-backdrop" onClick={() => setPhotoPreview(null)}><div className="photo-preview-modal" onClick={event => event.stopPropagation()}><button type="button" className="modal-x" onClick={() => setPhotoPreview(null)}><X /></button><span>{photoPreview.label}</span><img src={photoPreview.url} alt={photoPreview.label} /></div></div>}
      {offerOpen && <OfferModal seeker={detail} close={() => setOfferOpen(false)} onSent={offer => {
        if (!detail) return;
        const updated = {
          ...detail,
          past_offers: [offer, ...safeArray(detail.past_offers)],
        };
        setDetail(updated);
        setTalentProfiles(items => items.map(item => item.id === updated.id ? updated as AdminSeekerRecord : item));
      }} />}
      {editUser && <AdminUserEditModal seeker={editUser} close={() => setEditUser(null)} saved={updated => {
        const nextRole = String(updated.role || "seeker") as AdminAccountRole;
        setTalentProfiles(items => nextRole === "seeker"
          ? items.map(item => item.id === updated.id ? updated : item)
          : items.filter(item => item.id !== updated.id));
        setDetail(null);
        setAdminTab("users");
        setAdminAccountType(nextRole);
        Promise.all([fetchAdminAccounts(), fetchAdminSeekers()])
          .then(([accounts, seekers]) => {
            setAdminAccounts(safeArray(accounts));
            setTalentProfiles(safeArray(seekers) as AdminSeekerRecord[]);
          })
          .catch(() => undefined);
        setEditUser(null);
      }} deleted={id => {
        setTalentProfiles(items => items.filter(item => item.id !== id));
        if (detail?.id === id) setDetail(null);
        setEditUser(null);
      }} />}
      {messageUser && <AdminMessageModal seeker={messageUser} close={() => setMessageUser(null)} />}
      {selectedAccount && <AdminAccountDetailModal account={selectedAccount} close={() => setSelectedAccount(null)} saved={updated => {
        const nextRole = String(updated.role || "seeker") as AdminAccountRole;
        setAdminAccounts(items => items.map(item => String(item.id) === String(updated.id) ? { ...item, ...updated } : item));
        setAdminTab("users");
        setAdminAccountType(nextRole);
        Promise.all([fetchAdminAccounts(), fetchAdminSeekers()])
          .then(([accounts, seekers]) => {
            setAdminAccounts(safeArray(accounts));
            setTalentProfiles(safeArray(seekers) as AdminSeekerRecord[]);
          })
          .catch(() => undefined);
        setSelectedAccount(null);
      }} />}
      <BottomNav role={admin ? "admin" : "club"} screen={admin ? "adminUsers" : "talent"} go={go} />
    </main>
  );
}

function AdminInterviewPanel() {
  const [data, setData] = useState<AdminSalesResponse | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [statusFilter, setStatusFilter] = useState<"scheduled" | "interviewed" | "result">("scheduled");
  const [actionFilter, setActionFilter] = useState<"all" | "consultation_only" | "trial_shift">("all");
  useEffect(() => { fetchAdminSales().then(setData).catch(() => setData(normalizeSalesData(null))); }, []);
  const today = new Date().toISOString().slice(0, 10);
  const statusOf = (offer: AdminSalesResponse["offers"][number]) => offer.outcome || offer.workflow_status === "interviewed" ? "result" : String(offer.selected_date || "") < today ? "interviewed" : "scheduled";
  const interviews = safeArray(data?.offers).filter(offer => offer.selected_date && String(offer.selected_date).startsWith(month) && statusOf(offer) === statusFilter && (actionFilter === "all" || offer.next_action === actionFilter)).sort((a, b) => String(a.selected_date).localeCompare(String(b.selected_date)));
  return <div className="admin-interview-panel"><div className="section-title"><div><span>INTERVIEW</span><h2>面接カレンダー・一覧</h2></div><input type="month" value={month} onChange={event => setMonth(event.target.value)}/></div><div className="status-filter-row"><button className={statusFilter === "scheduled" ? "active" : ""} onClick={() => setStatusFilter("scheduled")}>面接/体験予定</button><button className={statusFilter === "interviewed" ? "active" : ""} onClick={() => setStatusFilter("interviewed")}>面接済み</button><button className={statusFilter === "result" ? "active" : ""} onClick={() => setStatusFilter("result")}>合否</button></div>{statusFilter === "scheduled" && <div className="rank-filter-row"><button className={actionFilter === "all" ? "active" : ""} onClick={() => setActionFilter("all")}>すべて</button><button className={actionFilter === "consultation_only" ? "active" : ""} onClick={() => setActionFilter("consultation_only")}>面接</button><button className={actionFilter === "trial_shift" ? "active" : ""} onClick={() => setActionFilter("trial_shift")}>体験</button></div>}<div className="interview-calendar-list">{interviews.map(offer => <article key={offer.id}><time>{formatDate(offer.selected_date)}</time><div><b>{offer.user_name || "求職者"}</b><span>{offer.club_name || "店舗未設定"}</span></div><strong>{nextActionLabel(offer.next_action)}</strong><small>{statusOf(offer) === "result" ? String(offer.outcome?.result || "結果入力済み") : `¥${formatYen(offer.offered_hourly_wage || offer.hourly_wage)}`}</small></article>)}</div>{!interviews.length && <div className="empty-state compact"><CalendarDays/><h2>該当する予定はありません</h2></div>}</div>;
}

function AdminAccountDetailModal({ account, close, saved }: {
  account: Record<string, unknown>;
  close: () => void;
  saved: (account: Record<string, unknown>) => void;
}) {
  const currentRole = ["seeker", "club_staff", "ambassador", "admin"].includes(String(account.role))
    ? String(account.role) as AdminAccountRole
    : "seeker";
  const [role, setRole] = useState<AdminAccountRole>(currentRole);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const referrals = safeArray(account.referrals as Record<string, unknown>[] | undefined);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const userId = String(account.id || "");
    if (!userId) {
      setError("ユーザーIDが取得できません。");
      return;
    }
    setSaving(true);
    try {
      const updated = await patchAdminAccountRole(userId, role);
      saved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "権限更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop">
    <form className="account-detail-modal" onSubmit={submit}>
      <button type="button" className="modal-x" onClick={close}><X /></button>
      <span className="eyebrow">ACCOUNT</span>
      <h2>{String(account.name || "ユーザー詳細")}</h2>
      {error && <p className="form-error">{error}</p>}
      <Field label="権限" required>
        <select value={role} onChange={event => setRole(event.target.value as AdminAccountRole)} required>
          <option value="seeker">求職者</option>
          <option value="club_staff">お店スタッフ</option>
          <option value="ambassador">アンバサダー</option>
          <option value="admin">管理者</option>
        </select>
      </Field>
      {role === "club_staff" && <p className="offer-note">所属店舗：{String(account.club_name || "店舗未紐付け")}</p>}
      {role === "ambassador" && <>
        <div className="profile-stats"><div><b>{Number(account.referral_count || referrals.length || 0)}</b><span>紹介人数</span></div></div>
        <h3>紹介ユーザー</h3>
        <div className="account-admin-list">{referrals.length ? referrals.map(referral => <article key={String(referral.id)}>
          <div className="avatar small" style={referral.picture_url ? { backgroundImage: `url(${String(referral.picture_url)})`, backgroundSize: "cover" } : undefined}>{safeInitial(referral.name)}</div>
          <div><h3>{String(referral.name || "紹介ユーザー")}</h3><p>登録済み</p></div>
        </article>) : <p className="offer-note">紹介ユーザーはまだいません。</p>}</div>
      </>}
      <div className="sheet-actions two">
        <Button type="button" kind="secondary" onClick={close}>閉じる</Button>
        <Button type="submit" disabled={saving}>{saving ? "保存中..." : "権限を保存"}</Button>
      </div>
    </form>
  </div>;
}

function AdminMessageModal({ seeker, close }: { seeker: AdminSeekerRecord; close: () => void }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    if (!message.trim()) {
      setResult({ ok: false, text: "メッセージ本文を入力してください。" });
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/line/admin-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seekerId: seeker.id, lineUserId: seeker.line_user_id, message: message.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "LINE送信に失敗しました。");
      setResult({ ok: true, text: "MAXVALUE運営カードをLINEへ送信しました。" });
      setMessage("");
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : "LINE送信に失敗しました。" });
    } finally {
      setSending(false);
    }
  };
  return <div className="modal-backdrop admin-message-backdrop"><form className="admin-message-modal" onSubmit={send}><button type="button" className="modal-x" onClick={close}><X /></button><span>MAXVALUE運営から</span><h2>{seeker.nickname}さんへ送信</h2><p>LINE上では運営からのカードとして表示されます。</p>{result && <p className={result.ok ? "form-success" : "form-error"}>{result.text}</p>}<Field label="メッセージ本文" required><textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="メッセージを入力してください" rows={6} required /></Field><div className="sheet-actions two"><Button type="button" kind="secondary" onClick={close}>閉じる</Button><Button type="submit" disabled={sending}>{sending ? "送信中..." : "LINEへ送信"}</Button></div></form></div>;
}

function AdminUserEditModal({ seeker, close, saved, deleted }: {
  seeker: AdminSeekerRecord;
  close: () => void;
  saved: (seeker: AdminSeekerRecord) => void;
  deleted: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const fields = [
    ["role", "権限", seeker.role || "seeker"],
    ["staff_club_id", "所属店舗ID（店舗スタッフのみ）", seeker.staff_club_id || ""],
    ["line_user_id", "LINE userId（手動補完）", seeker.line_user_id || ""],
    ["nickname", "ニックネーム", seeker.nickname],
    ["age", "年齢", seeker.age],
    ["work_experience", "ナイトワーク経験", seeker.experience],
    ["desired_region", "希望地域", seeker.region],
    ["desired_area", "希望エリア", seeker.area],
    ["desired_shift", "希望シフト", seeker.desired_shift],
    ["start_timing", "勤務開始予定", seeker.start_timing],
    ["current_club", "現在or直近勤務店", seeker.current_club || ""],
    ["blocked_clubs", "見られたくないお店", seeker.blocked_clubs?.join("\n") || ""],
    ["current_hourly_range", "現在時給", seeker.current_hourly_range || ""],
    ["current_monthly_sales_range", "現在月売", seeker.current_monthly_sales_range || ""],
    ["photo_1_url", "プロフィール写真1", seeker.photo_1_url || ""],
    ["photo_2_url", "プロフィール写真2", seeker.photo_2_url || ""],
    ["full_body_photo_url", "プロフィール写真3", seeker.full_body_photo_url || ""],
    ["gacha_ticket_count", "ガチャチケット数", seeker.gacha_ticket_count || 0],
    ["rank", "ランク", seeker.rank || ""],
    ["last_call_cast", "LastCall出演", seeker.last_call_cast ? "true" : "false"],
  ] as const;

  return <div className="modal-backdrop"><form className="admin-edit-modal" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const updates = Object.fromEntries(fields.map(([key]) => [key, form.get(key)]));
    setSaving(true);
    try {
      await patchAdminSeeker(seeker.id, updates);
      saved({
        ...seeker,
        nickname: String(updates.nickname || seeker.nickname),
        age: Number(updates.age || seeker.age),
        experience: String(updates.work_experience || seeker.experience),
        region: String(updates.desired_region || seeker.region),
        area: String(updates.desired_area || seeker.area),
        desired_shift: String(updates.desired_shift || seeker.desired_shift),
        start_timing: String(updates.start_timing || seeker.start_timing),
        current_club: String(updates.current_club || ""),
        blocked_clubs: String(updates.blocked_clubs || "").split(/\n|,/).map(item => item.trim()).filter(Boolean),
        current_hourly_range: String(updates.current_hourly_range || ""),
        current_monthly_sales_range: String(updates.current_monthly_sales_range || ""),
        photo_1_url: String(updates.photo_1_url || ""),
        photo_2_url: String(updates.photo_2_url || ""),
        full_body_photo_url: String(updates.full_body_photo_url || ""),
        gacha_ticket_count: Number(updates.gacha_ticket_count || 0),
        rank: String(updates.rank || ""),
        last_call_cast: String(updates.last_call_cast) === "true",
        line_user_id: String(updates.line_user_id || "") || null,
        role: String(updates.role || seeker.role || "seeker") as AdminSeekerRecord["role"],
        staff_club_id: String(updates.staff_club_id || "") || null,
      });
    } finally {
      setSaving(false);
    }
  }}>
    <button type="button" className="modal-x" onClick={close}><X /></button>
    <span className="eyebrow">ADMIN EDIT</span><h2>ユーザー編集</h2>
    <div className="admin-edit-grid">{fields.map(([key, label, value]) => <Field key={key} label={label}>
      {key === "role" ? <select name={key} defaultValue={String(value)}><option value="seeker">求職者</option><option value="club_staff">店舗スタッフ</option><option value="ambassador">アンバサダー</option><option value="admin">管理者</option></select> : key === "last_call_cast" ? <select name={key} defaultValue={String(value)}><option value="false">出演なし</option><option value="true">出演者</option></select> : key.includes("photo") || key === "blocked_clubs" ? <textarea name={key} defaultValue={String(value)} /> : <input name={key} defaultValue={String(value)} />}
    </Field>)}</div>
    <Button type="submit" disabled={saving}>{saving ? "保存中..." : "保存する"}</Button>
    <div className="admin-danger-zone">
      <b>求職者登録をリセット</b>
      <p>求職者プロフィールと関連履歴を削除し、同じLINEで新規登録フローを試せる状態にします。管理者・店舗などの権限は保持します。</p>
      {deleteError && <p className="form-error">{deleteError}</p>}
      <Button kind="secondary" className="danger" disabled={deleting} onClick={async () => {
        if (!window.confirm(`${seeker.nickname} さんの求職者登録をリセットします。プロフィール・ガチャ・求職者向け履歴は削除されます。実行しますか？`)) return;
        setDeleting(true);
        setDeleteError("");
        try {
          const result = await deleteAdminSeeker(seeker.id);
          deleted(seeker.id);
          if (result.sessionCleared) window.location.href = "/?screen=signin";
        } catch (error) {
          setDeleteError(error instanceof Error ? error.message : "削除に失敗しました");
        } finally {
          setDeleting(false);
        }
      }}>{deleting ? "リセット中..." : "求職者登録をリセット"}</Button>
    </div>
  </form></div>;
}

function AdminClubs({ go }: { go: (s: Screen) => void }) {
  const [clubs, setClubs] = useState<AdminClubRecord[]>([]);
  const [selected, setSelected] = useState<AdminClubRecord | null>(null);
  const [editing, setEditing] = useState<AdminClubRecord | null>(null);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [area, setArea] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [storeCode, setStoreCode] = useState("");

  useEffect(() => { fetchAdminClubs().then(items => setClubs(safeArray(items))).catch(() => setClubs([])); }, []);
  const visible = clubs.filter(club =>
    matchesClubSearch(club, query) &&
    (!region || club.region === region) &&
    (!area || club.area === area) &&
    (!businessType || club.business_type === businessType) &&
    (!storeCode || normalizeSearch(club.store_code).includes(normalizeSearch(storeCode)))
  );
  const areas = Array.from(new Set(clubs.filter(club => !region || club.region === region).map(club => club.area).filter(Boolean)));
  const businessTypes = Array.from(new Set(clubs.map(club => club.business_type).filter(Boolean)));

  return <main className="app-shell soft-bg">
    <AppHeader title="お店管理" />
    <section className="page-content admin-clubs-content">
      <div className="admin-toolbar">
        <div><span className="eyebrow">ADMIN STORES</span><h1>店舗マスタ</h1><p>店舗データは削除せず、統合候補はレポートで確認します。</p></div>
        <Button kind="secondary" onClick={() => go("adminUsers")}>ユーザー管理へ</Button>
      </div>
      <div className="admin-filter-grid">
        <Field label="店舗名"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="あんじゅーる / アンジュール" /></Field>
        <Field label="地域"><select value={region} onChange={e => { setRegion(e.target.value); setArea(""); }}><option value="">すべて</option><option>大阪</option><option>東京</option></select></Field>
        <Field label="エリア"><select value={area} onChange={e => setArea(e.target.value)}><option value="">すべて</option>{areas.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label="業態"><select value={businessType} onChange={e => setBusinessType(e.target.value)}><option value="">すべて</option>{businessTypes.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label="店舗ID"><input value={storeCode} onChange={e => setStoreCode(e.target.value)} placeholder="store_code" /></Field>
      </div>
      <div className="admin-club-list">
        {visible.map(club => <article key={club.id} className="admin-club-row" onClick={() => setSelected(club)}>
          <div className="admin-club-logo" style={club.logo_url ? { backgroundImage: `url(${club.logo_url})`, backgroundSize: "cover" } : undefined}>{!club.logo_url && safeInitial(club.display_name, "?")}</div>
          <div><b>{club.display_name}</b><span>{club.region} / {club.area} / {club.business_type}</span></div>
          <small>{club.store_code || "店舗IDなし"}</small>
          <small>スタッフ {club.staff_count || 0}</small>
          <small>オファー {club.offer_count || 0}</small>
          <time>{club.updated_at ? formatDate(club.updated_at) : "-"}</time>
        </article>)}
      </div>
    </section>
    {selected && <div className="detail-sheet"><div className="sheet-header"><button onClick={() => setSelected(null)}><ArrowLeft /></button><b>店舗詳細</b><button onClick={() => setEditing(selected)}>編集</button></div>
      <section className="club-profile-hero"><div className="club-brand"><div className="club-logo big" style={selected.logo_url ? { backgroundImage: `url(${selected.logo_url})`, backgroundSize: "cover" } : undefined}>{!selected.logo_url && safeInitial(selected.display_name, "?")}</div><div><span>{selected.region}・{selected.area}・{selected.business_type}</span><h1>{selected.display_name}</h1><p>STORE ID: {selected.store_code || "未設定"}</p></div></div><div className="interior-strip">{[0,1,2].map(index => <div key={index} style={selected.interior_photo_urls?.[index] ? {backgroundImage:`url(${selected.interior_photo_urls?.[index]})`, backgroundSize:"cover"} : undefined}/>)}</div></section>
      <section className="page-content profile-content"><div className="profile-table">{[
        ["店舗紹介文", selected.appeal_text || "未設定"],
        ["権限コード", selected.permission_code || "未設定"],
        ["スタッフ数", `${selected.staff_count || 0}人`],
        ["オファー数", `${selected.offer_count || 0}件`],
        ["Instagram URL", selected.instagram_url || "未設定"],
      ].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div></section>
    </div>}
    {editing && <AdminClubEditModal club={editing} close={() => setEditing(null)} saved={updated => {
      setClubs(items => items.map(item => item.id === updated.id ? updated : item));
      setSelected(updated);
      setEditing(null);
    }} />}
    <BottomNav role="admin" screen="adminClubs" go={go} />
  </main>;
}

function AdminClubEditModal({ club, close, saved }: {
  club: AdminClubRecord;
  close: () => void;
  saved: (club: AdminClubRecord) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const profile = (club.profile || {}) as Record<string, unknown>;
  const extraFields = [
    ["permission_code", "権限コード"], ["trial_perks", "体入特典"], ["hiring_perks", "採用特典"],
    ["wage_range", "時給レンジ"], ["backs", "各種バック"], ["deductions", "控除"], ["payday", "給料日"],
    ["daily_pay", "日払い可否"], ["business_hours", "営業時間"], ["closed_days", "定休日"],
    ["min_weekly_shifts", "週間最低出勤日数"], ["ride_fee", "送り費用"], ["ride_area", "送り範囲"],
    ["customer_base", "客層"], ["average_customer_spend", "平均客単価"], ["store_scale", "店舗規模"],
    ["average_cast_age", "キャスト平均年齢"], ["cast_count", "キャスト在籍数"], ["outfit", "服装"],
    ["required_id", "体験時必要身分証"], ["address", "住所"],
  ] as const;
  return <div className="modal-backdrop"><form className="admin-edit-modal wide" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const updates = {
      display_name: form.get("display_name"),
      region: form.get("region"),
      area: form.get("area"),
      business_type: form.get("business_type"),
      store_code: form.get("store_code"),
      kana_name: form.get("kana_name"),
      appeal_text: form.get("appeal_text"),
      logo_url: form.get("logo_url"),
      instagram_url: form.get("instagram_url"),
      interior_photo_urls: form.get("interior_photo_urls"),
    };
    const extra = Object.fromEntries(extraFields.map(([key]) => [key, form.get(key)]));
    setSaving(true);
    setSaveError("");
    try {
      const result = await patchAdminClub(club.id, updates, extra);
      const persisted = (result.club || {}) as Partial<AdminClubRecord>;
      const persistedProfile = (persisted.profile || profile) as Record<string, unknown>;
      saved({
        ...club,
        ...persisted,
        permission_code: String(persistedProfile.permission_code || ""),
        profile: persistedProfile,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "店舗情報を保存できませんでした");
    } finally {
      setSaving(false);
    }
  }}>
    <button type="button" className="modal-x" onClick={close}><X /></button>
    <span className="eyebrow">STORE EDIT</span><h2>店舗編集</h2>
    {saveError && <p className="form-error">{saveError}</p>}
    <div className="admin-edit-grid">
      <Field label="店舗名"><input name="display_name" defaultValue={club.display_name} /></Field>
      <Field label="地域"><input name="region" defaultValue={club.region} /></Field>
      <Field label="エリア"><input name="area" defaultValue={club.area} /></Field>
      <Field label="業態"><input name="business_type" defaultValue={club.business_type} /></Field>
      <Field label="店舗ID / store_code"><input name="store_code" defaultValue={club.store_code || ""} /></Field>
      <Field label="検索用かな"><input name="kana_name" defaultValue={club.kana_name || ""} /></Field>
      <Field label="店舗紹介文"><textarea name="appeal_text" defaultValue={club.appeal_text || ""} /></Field>
      <Field label="ロゴURL"><input name="logo_url" defaultValue={club.logo_url || ""} /></Field>
      <Field label="内装写真URL（改行区切り）"><textarea name="interior_photo_urls" defaultValue={(club.interior_photo_urls || []).join("\n")} /></Field>
      <Field label="Instagram URL"><input name="instagram_url" defaultValue={club.instagram_url || ""} /></Field>
      {extraFields.map(([key, label]) => <Field key={key} label={label}><input name={key} defaultValue={String(profile[key] || "")} /></Field>)}
    </div>
    <Button type="submit" disabled={saving}>{saving ? "保存中..." : "保存する"}</Button>
  </form></div>;
}

function OfferModal({ close, seeker, onSent }: {
  close: () => void;
  seeker: SeekerRecord | null;
  onSent?: (offer: SeekerPastOfferRecord) => void;
}) {
  const { selectedClub } = useAdminCapability();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [lineSent, setLineSent] = useState(true);
  const [lineReason, setLineReason] = useState("");
  const [formError, setFormError] = useState("");
  return <div className="modal-backdrop"><form className="offer-modal" onSubmit={async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const hourlyWage = Number(form.get("hourlyWage") || 0);
    const guaranteePeriod = String(form.get("guaranteePeriod") || "").trim();
    const comment = String(form.get("comment") || "").trim();
    const options = form.getAll("options").map(value => String(value));
    if (!hourlyWage || !guaranteePeriod || !comment) {
      setFormError("時給・保証期間・コメントを入力してください。");
      return;
    }
    setSending(true);
    setLineReason("");
    setFormError("");
    try {
      const response = await fetch("/api/line/offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seekerId: seeker?.id,
          clubId: selectedClub?.id || "",
          clubName: selectedClub?.display_name || "",
          lineUserId: seeker?.line_user_id || String(form.get("manualLineUserId") || "").trim(),
          hourlyWage,
          guaranteePeriod,
          comment,
          options,
        }),
      });
      const json = await response.json();
      if (!response.ok || json.ok === false) throw new Error(json.error || "オファー送信に失敗しました");
      setLineSent(Boolean(json.sent));
      const reason = String(json.reason || "");
      setLineReason(reason === "target_line_user_id_missing" ? "求職者のLINE userIdが未保存のため、DB保存のみ行いました。" : reason === "line_push_failed" ? `LINE Push送信に失敗しました: ${String(json.detail || "詳細不明")}` : reason === "line_access_token_missing" ? "LINE_CHANNEL_ACCESS_TOKENが未設定のため、DB保存のみ行いました。" : "");
      if (json.offerId) {
        const sentOffer = {
          id: String(json.offerId),
          club_name: String(json.clubName || "送信した店舗"),
          club_logo_url: json.clubLogoUrl || null,
          created_at: new Date().toISOString(),
          hourly_wage: hourlyWage,
          guarantee_period: guaranteePeriod,
          comment,
          status: "sent" as const,
          response_status: null,
          next_action: null,
          selected_date: null,
          offered_hourly_wage: hourlyWage,
          response_source: null,
          seeker_name: seeker?.nickname || "求職者",
          workflow_status: "unread",
          options,
        };
        onSent?.(sentOffer);
        try {
          const cacheKey = `maxvalue_sent_offers_${selectedClub?.id || "current"}`;
          const cached = safeArray(JSON.parse(window.sessionStorage.getItem(cacheKey) || "[]")) as Array<{ id?: unknown }>;
          window.sessionStorage.setItem(cacheKey, JSON.stringify([sentOffer, ...cached.filter(item => String(item.id) !== sentOffer.id)].slice(0, 50)));
        } catch {}
      }
      setSent(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "オファー送信に失敗しました");
    } finally {
      setSending(false);
    }
  }}><button type="button" className="modal-x" onClick={close}><X /></button>{sent ? <div className="success-state"><div><Check /></div><h2>{lineSent ? "オファーを送信しました" : "オファーを保存しました"}</h2><p>{lineSent ? "求職者のLINEへ条件カードを送信しました。" : (lineReason || "LINE送信は未完了ですが、DBにオファーを保存しました。")}</p><Button onClick={close}>閉じる</Button></div> : <><span className="eyebrow">NEW OFFER</span><h2>オファー条件</h2><p>LINE Flex Messageとして送信されます。</p>{formError && <p className="form-error">{formError}</p>}{!seeker?.line_user_id && <div className="line-send-warning"><Bell size={16}/> この求職者はLINE userIdが未保存です。Bubble rawから復元を試みます。必要な場合のみ手動補完してください。<input className="manual-line-input" name="manualLineUserId" placeholder="Uから始まるLINE userId" /></div>}<div className="offer-modal-scroll"><Field label="想定時給（半角数字）" required><div className="money-input"><span>¥</span><input name="hourlyWage" type="number" defaultValue={20000} required /></div></Field><Field label="保証期間" hint="基本3ヶ月以上のご提示を推奨しています" required><select name="guaranteePeriod" defaultValue="3ヶ月" required><option>1ヶ月</option><option>2ヶ月</option><option>3ヶ月</option><option>4ヶ月</option><option>5ヶ月</option><option>6ヶ月</option><option>6ヶ月以上</option></select></Field><Field label="追加条件（複数選択可）"><div className="offer-option-grid">{["家賃補助", "シフト柔軟", "永久保証", "送り無料", "日払い", "SNS支援"].map(option => <label key={option}><input type="checkbox" name="options" value={option}/><span>{option}</span></label>)}</div></Field><Field label="コメント（30字以内）" required><textarea name="comment" maxLength={30} placeholder="特別待遇などを入力" required /></Field></div><div className="offer-modal-footer"><Button type="submit" disabled={sending}>{sending ? "送信中..." : "オファーを送る"} <Send size={18}/></Button></div></>}</form></div>;
}

function SentOffers({ go }: { go: (s: Screen) => void }) {
  type ClubOffer = { id: string; seeker_name: string; hourly_wage: number; guarantee_period: string; comment: string; created_at: string; workflow_status: string; response?: Record<string, unknown>; options?: string[]; workflow?: Record<string, unknown> };
  const { selectedClub } = useAdminCapability();
  const [offers, setOffers] = useState<ClubOffer[]>([]);
  const [filter, setFilter] = useState("all");
  const [resultOffer, setResultOffer] = useState<ClubOffer | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const query = selectedClub?.id ? `?clubId=${encodeURIComponent(selectedClub.id)}` : "";
    try {
      const response = await fetch(`/api/club/offers${query}`, { cache: "no-store" });
      const data = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error(data?.error || "出したオファーを取得できませんでした。");
      if (requestId !== requestIdRef.current) return;
      const serverOffers = safeArray(data) as ClubOffer[];
      setOffers(serverOffers);
      window.sessionStorage.setItem(`maxvalue_sent_offers_${selectedClub?.id || "current"}`, JSON.stringify(serverOffers.slice(0, 50)));
      setMessage("");
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setMessage(error instanceof Error ? error.message : "出したオファーを取得できませんでした。");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [selectedClub?.id]);
  useEffect(() => {
    requestIdRef.current += 1;
    setOffers([]);
    setLoading(true);
    try {
      const cached = safeArray(JSON.parse(window.sessionStorage.getItem(`maxvalue_sent_offers_${selectedClub?.id || "current"}`) || "[]")) as ClubOffer[];
      if (cached.length) {
        setOffers(cached);
        setLoading(false);
      }
    } catch {}
    void load();
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 20000);
    return () => {
      requestIdRef.current += 1;
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [load, selectedClub?.id]);
  const filtered = offers.filter(offer => filter === "all" || offer.workflow_status === filter);
  const labels: Record<string, string> = { unread: "未読", interested: "関心あり", scheduled: "面接予定", interviewed: "面接済", rejected: "関心なし" };
  return <main className="app-shell soft-bg"><AppHeader title="出したオファー" /><section className="page-content"><div className="dashboard-hello"><div><span>OFFER STATUS</span><h1>オファー状況</h1></div></div>{message && <div className="inline-notice">{message}</div>}<div className="offer-status-filters">{[["all","すべて"],["interviewed","面接済"],["scheduled","面接予定"],["interested","関心あり"],["unread","未読"],["rejected","関心なし"]].map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}<b>{value === "all" ? offers.length : offers.filter(item => item.workflow_status === value).length}</b></button>)}</div><div className="sent-offer-list">{filtered.map(offer => <article key={offer.id} className="sent-offer-card"><div><small>{formatDateTime(offer.created_at)}</small><h2>{offer.seeker_name || "求職者"}</h2><span className={`status-chip ${offer.workflow_status}`}>{labels[offer.workflow_status] || offer.workflow_status}</span></div><strong>¥{formatYen(offer.hourly_wage)} / {offer.guarantee_period}</strong>{offer.options?.length ? <p>{offer.options.join(" ・ ")}</p> : null}<p>{offer.comment}</p>{["scheduled","interested"].includes(offer.workflow_status) && <Button kind="secondary" onClick={() => setResultOffer(offer)}>面接結果を入力</Button>}{offer.workflow_status === "interviewed" && <small>結果入力済み</small>}</article>)}</div>{loading && !offers.length ? <div className="empty-state compact"><LoaderCircle className="spin"/><h2>オファーを読み込み中です</h2></div> : !filtered.length && <div className="empty-state compact"><Send/><h2>該当するオファーはありません</h2></div>}</section>{resultOffer && <div className="modal-backdrop"><form className="interview-result-modal" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const outcome = { result: form.get("result"), hourly_wage: Number(form.get("hourly_wage") || 0), guarantee_period: form.get("guarantee_period"), options: form.getAll("result_options"), failure_reason: form.get("failure_reason"), reschedule: form.get("reschedule"), note: form.get("note") }; const response = await fetch("/api/club/offers", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ offerId: resultOffer.id, workflowStatus: "interviewed", outcome }) }); if (response.ok) { setMessage("面接結果を保存しました。"); setResultOffer(null); load(); } else setMessage("面接結果を保存できませんでした。"); }}><button type="button" className="modal-x" onClick={() => setResultOffer(null)}><X/></button><span className="eyebrow">INTERVIEW RESULT</span><h2>面接結果</h2><div className="offer-modal-scroll"><Field label="結果" required><select name="result" required><option value="">選択してください</option><option value="joined">入店</option><option value="hired_pending">採用・入店未定</option><option value="failed">不合格</option><option value="no_show">非参加</option></select></Field><Field label="時給"><input name="hourly_wage" type="number" defaultValue={resultOffer.hourly_wage}/></Field><Field label="保証期間"><input name="guarantee_period" defaultValue={resultOffer.guarantee_period}/></Field><Field label="オプション"><div className="offer-option-grid">{["家賃補助","シフト柔軟","永久保証","送り無料","日払い"].map(item => <label key={item}><input type="checkbox" name="result_options" value={item}/><span>{item}</span></label>)}</div></Field><Field label="不合格理由"><select name="failure_reason"><option value="">該当なし</option><option>スペック</option><option>パーソナリティ</option><option>要求待遇に合わない</option></select></Field><Field label="非参加時"><select name="reschedule"><option value="">該当なし</option><option value="request">再度日程調整を依頼</option><option value="close">再調整しない</option></select></Field><Field label="自由記述"><textarea name="note" rows={4}/></Field></div><div className="offer-modal-footer"><Button type="submit">保存する</Button></div></form></div>}<BottomNav role="club" screen="sentOffers" go={go}/></main>;
}

function ClubProfile({ go }: { go: (s: Screen) => void }) {
  const { selectedClub } = useAdminCapability();
  const [club, setClub] = useState<ClubRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (selectedClub) {
      setClub(selectedClub);
      return;
    }
    fetchClubs().then(items => setClub(safeArray(items)[0] || null)).catch(() => setClub(null));
  }, [selectedClub]);
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem("maxvalue_admin_club_id");
    window.location.href = "/?screen=landing";
  };
  const rows = club ? [["お店の魅力", club.appeal_text || "未登録"], ["地域", club.region], ["エリア", club.area], ["業態", club.business_type]] : [];
  const profile = (club?.profile || {}) as Record<string, unknown>;
  const permissionCode = String(profile.permission_code || club?.store_code || "");
  const inviteUrl = `https://maxvalue-seven.vercel.app/?screen=clubSignin&ref=${encodeURIComponent(permissionCode)}`;
  const requiredKeys = ["wage_range","backs","deductions","payday","business_hours","closed_days","address"];
  const completeness = requiredKeys.filter(key => Boolean(profile[key])).length;
  return <main className="app-shell soft-bg"><AppHeader title="店舗マイページ" /><section className="club-profile-hero"><div className="club-brand"><div className="club-logo big">{safeInitial(club?.display_name)}</div><div><span>{club ? `${club.area}・${club.business_type}` : "店舗データ読込中"}</span><h1>{club?.display_name || "店舗未選択"}</h1><p>{club?.store_code ? `STORE ID: ${club.store_code}` : "店舗マスタ準備中"}</p></div></div><div className="interior-strip">{[0,1,2].map(index => <div key={index} style={club?.interior_photo_urls?.[index] ? {backgroundImage:`url(${club.interior_photo_urls?.[index]})`, backgroundSize:"cover"} : undefined}/>)}</div></section><section className="page-content profile-content"><div className="section-title profile-title"><div><span>STORE PROFILE</span><h2>店舗情報</h2></div><button className="round-edit" onClick={() => setEditing(true)}>{completeness < requiredKeys.length ? "追加登録" : "編集"}</button></div>{completeness < requiredKeys.length && <div className="inline-notice">店舗情報を充実させると、求職者にお店の魅力が伝わりやすくなります。</div>}<div className="profile-table">{rows.length ? rows.map(([k,v])=><div key={k}><span>{k}</span><b>{v}</b></div>) : <div><span>店舗</span><b>店舗認証後に表示</b></div>}</div>{permissionCode && <div className="invite-card store-invite"><div><span><Users size={16}/> スタッフ登録用共有リンク</span><b>{inviteUrl}</b></div><button onClick={() => { copyText(inviteUrl); setCopied(true); }}>{copied ? <Check/> : <Copy/>}</button><p>このリンクから各スタッフがLINEログインすると、同じ店舗へ紐づきます。</p></div>}<Button kind="secondary" className="logout" onClick={logout}><LogOut size={18}/> ログアウト</Button></section>{editing && club && <AdminClubEditModal club={{...club, permission_code: permissionCode} as AdminClubRecord} close={() => setEditing(false)} saved={updated => { setClub(updated); setEditing(false); }}/>}<BottomNav role="club" screen="clubProfile" go={go}/></main>;
}

function AdminSignin({ go }: { go: (s: Screen) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const login = async () => {
    setError("");
    if (!code.trim()) {
      setError("管理コードを入力してください");
      return;
    }
    setStarting(true);
    try {
      const status = await fetch("/api/auth/line/status").then(response => response.json());
      if (status.configured) {
        const authorization = await fetch("/api/auth/admin/authorize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const result = await authorization.json().catch(() => ({}));
        if (!authorization.ok) {
          setError(result.error || "管理コードを確認できませんでした");
          return;
        }
        window.location.href = result.loginUrl;
        return;
      }
      setError("LINE Loginの設定を確認してください");
    } finally {
      setStarting(false);
    }
  };
  return <main className="admin-auth"><div className="admin-auth-card"><Logo light/><div className="admin-shield"><ShieldCheck/></div><span>ADMIN CONSOLE</span><h1>管理者ログイン</h1><p>管理コード確認後、LINEアカウントと管理者権限を紐付けます。</p><input value={code} onChange={e => { setCode(e.target.value); setError(""); }} placeholder="管理コード" /><Button disabled={starting} onClick={login}>{starting ? "LINE接続中..." : "ログイン"}</Button>{error && <small className="form-error">{error}</small>}<button onClick={()=>go("landing")}>サービスサイトへ戻る</button></div></main>;
}

function Sales({ go }: { go: (s: Screen) => void }) {
  const [data, setData] = useState<AdminSalesResponse | null>(null);
  const [view, setView] = useState<"home" | "cost" | "calendar" | "aim" | "result">("home");
  const [visitForResult, setVisitForResult] = useState<SalesVisitRecord | null>(null);
  const [salesMessage, setSalesMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [nameFilter, setNameFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [potentialFilter, setPotentialFilter] = useState("");
  const [clubFilter, setClubFilter] = useState("");
  useEffect(() => { fetchAdminSales().then(result => setData(normalizeSalesData(result))).catch(() => setData(normalizeSalesData(null))); }, []);
  const salesData = normalizeSalesData(data);
  const ratio = (value: number, total: number) => total ? `${Math.round((value / total) * 100)}%` : "0%";
  const filteredLeads = safeArray(salesData.leads).filter(lead =>
    (!nameFilter || normalizeSearch(`${lead.name} ${lead.club_name}`).includes(normalizeSearch(nameFilter))) &&
    (!staffFilter || lead.assigned_staff_name === staffFilter) &&
    (!potentialFilter || lead.potential === potentialFilter) &&
    (!clubFilter || lead.club_name === clubFilter)
  );
  const filteredOffers = safeArray(salesData.offers).filter(offer =>
    (!nameFilter || normalizeSearch(`${offer.user_name} ${offer.club_name}`).includes(normalizeSearch(nameFilter))) &&
    (!clubFilter || offer.club_name === clubFilter)
  );
  const staffOptions = Array.from(new Set(safeArray(salesData.leads).map(lead => lead.assigned_staff_name).filter(Boolean))) as string[];
  const potentialOptions = Array.from(new Set(safeArray(salesData.leads).map(lead => lead.potential).filter(Boolean))) as string[];
  const clubOptions = Array.from(new Set([...safeArray(salesData.leads).map(lead => lead.club_name), ...safeArray(salesData.offers).map(offer => offer.club_name)].filter(Boolean))) as string[];
  const validate = (form: HTMLFormElement, required: string[]) => {
    const missing = required.filter(name => !String(new FormData(form).get(name) || "").trim());
    setErrorFields(missing);
    if (missing[0]) {
      form.querySelector(`[name="${missing[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  };
  const refresh = () => fetchAdminSales().then(result => setData(normalizeSalesData(result))).catch(() => setData(normalizeSalesData(null)));
  const fieldClass = (name: string) => errorFields.includes(name) ? "field field-error" : "field";
  return <main className="app-shell sales-shell">
    <AppHeader title="営業管理" />
    <section className="page-content sales-home-content">
      <div className="sales-home-title">
        <div><span>SALES OPS</span><h1>営業ホーム</h1><p>人物・訪問・コストを一元管理</p></div>
        <Button kind="secondary" onClick={refresh}><CalendarDays size={17}/> 更新</Button>
      </div>
      <div className="sales-top-tabs">
        <button className={view === "cost" ? "active" : ""} onClick={() => setView("cost")}><WalletCards size={18}/> コスト分析</button>
        <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}><CalendarDays size={18}/> カレンダー</button>
        <button className={view === "aim" ? "active" : ""} onClick={() => setView("aim")}><ClipboardIcon/> 狙いフォーム</button>
      </div>
      {salesMessage && <div className="inline-notice">{salesMessage}</div>}
      {view !== "aim" && view !== "result" && <div className="sales-filter-card">
        <h2><Search size={20}/> 絞り込み</h2>
        <div className="sales-filter-grid">
          <input value={nameFilter} onChange={e => setNameFilter(e.target.value)} placeholder="名前・店舗で検索" />
          <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}><option value="">担当者（全員）</option>{staffOptions.map(item => <option key={item}>{item}</option>)}</select>
          <select value={potentialFilter} onChange={e => setPotentialFilter(e.target.value)}><option value="">ポテンシャル（全て）</option>{potentialOptions.map(item => <option key={item}>{item}</option>)}</select>
          <select value={clubFilter} onChange={e => setClubFilter(e.target.value)}><option value="">在籍店（全て）</option>{clubOptions.map(item => <option key={item}>{item}</option>)}</select>
        </div>
      </div>}
      {(view === "home" || view === "cost" || view === "calendar") && <>
        <div className="sales-kpis light">
          <article><span>総オファー</span><b>{salesData.totals.total}</b><small>実データ</small></article>
          <article><span>興味あり</span><b>{salesData.totals.interested}</b><small>{ratio(salesData.totals.interested, salesData.totals.total)}</small></article>
          <article><span>見送り</span><b>{salesData.totals.rejected}</b><small className="danger">{ratio(salesData.totals.rejected, salesData.totals.total)}</small></article>
          <article><span>未反応</span><b>{salesData.totals.no_response}</b><small>{ratio(salesData.totals.no_response, salesData.totals.total)}</small></article>
        </div>
        <SalesSection title="訪問履歴" icon={<CalendarDays />}>
          <div className="sales-visit-list">{safeArray(salesData.visits).map(visit => <article key={visit.id}>
            <time>{formatDate(visit.visit_date)}</time>
            <div><b>{visit.visit_purpose}</b><span>{visit.club_name} / {visit.assigned_staff_name}</span></div>
            <strong>¥{formatYen(visit.budget)}</strong>
            <button onClick={() => { setVisitForResult(visit); setView("result"); }}>結果フォーム</button>
          </article>)}</div>
        </SalesSection>
        <SalesSection title="アプリ未登録リード" icon={<Users />}>
          <div className="lead-table">{filteredLeads.map(lead => <article key={lead.id}>
            <b>{lead.club_name}</b><span>{lead.name}</span><small>{lead.age ? `${lead.age}歳` : "-"} / {lead.rank || "ランク未設定"} / {lead.potential || "未設定"}</small><small>{lead.scout_status || "スカウト未設定"}</small><small>{lead.assigned_staff_name || "担当未設定"}</small><button>ユーザー連携</button>
          </article>)}</div>
        </SalesSection>
        <SalesSection title="関心リアクション" icon={<Heart />}>
          <div className="admin-offer-table compact-offers">
            {filteredOffers.map(offer => <article key={offer.id}>
              <div><b>{offer.user_name}</b><span>{offer.club_name} / 担当者未設定</span></div>
              <strong className={`status-chip ${offer.status}`}>{offer.status === "interested" ? "興味あり" : offer.status === "rejected" ? "見送り" : "未反応"}</strong>
              <small>¥{formatYen(offer.hourly_wage)} / {offer.guarantee_period}</small>
              <small>{nextActionLabel(offer.next_action)} / {offer.selected_date ? `希望日 ${formatDate(offer.selected_date)}` : "日程未確定"} / {responseSourceLabel(offer.response_source)} / {responseStageLabel(offer.response_status)}</small>
              <time>{formatDateTime(offer.created_at)}</time>
            </article>)}
          </div>
        </SalesSection>
        <SalesSection title="人材一覧" icon={<CircleUserRound />}>
          <div className="reaction-list compact">
            {safeArray(salesData.by_user).map(row => <article key={row.name} className="reaction-row">
              <div><b>{row.name}</b><span>{row.total}件</span></div>
              <div className="reaction-bars"><i className="interested" style={{ width: ratio(row.interested, row.total) }} /><i className="rejected" style={{ width: ratio(row.rejected, row.total) }} /><i className="no-response" style={{ width: ratio(row.no_response, row.total) }} /></div>
              <small>興味あり {row.interested} / 見送り {row.rejected} / 未反応 {row.no_response}</small>
            </article>)}
          </div>
        </SalesSection>
      </>}
      {view === "aim" && <form className="sales-form-card" onSubmit={async event => {
        event.preventDefault();
        if (!validate(event.currentTarget, ["visitPurpose", "clubId", "seekerId", "budget", "assignedStaffName", "visitDate", "memo"])) return;
        const form = new FormData(event.currentTarget);
        setSaving(true);
        try {
          await postAdminSales("visit", Object.fromEntries(form));
          setSalesMessage("狙いフォームを保存しました。訪問履歴に反映します。");
          await refresh();
          setView("home");
        } catch (error) {
          setSalesMessage(error instanceof Error ? error.message : "保存に失敗しました");
        } finally {
          setSaving(false);
        }
      }}>
        <button type="button" className="back-mini" onClick={() => setView("home")}><ArrowLeft size={17}/> 戻る</button>
        <h2>狙いフォーム</h2><p>訪問前に記入してください</p>
        <div className={fieldClass("visitPurpose")}><span>訪問目的 <b className="required-mark">*</b></span><select name="visitPurpose"><option value="">選択してください</option><option>フリー新規開拓</option><option>既存店舗フォロー</option><option>紹介依頼</option><option>面接同行</option></select></div>
        <div className={fieldClass("clubId")}><span>店名 <b className="required-mark">*</b></span><input name="clubId" placeholder="店舗IDまたは店舗名" /></div>
        <div className={fieldClass("seekerId")}><span>ユーザー検索 <b className="required-mark">*</b></span><input name="seekerId" placeholder="求職者IDまたは名前" /></div>
        <div className={fieldClass("budget")}><span>予算（円） <b className="required-mark">*</b></span><input name="budget" inputMode="numeric" placeholder="例: 30000" /></div>
        <div className={fieldClass("assignedStaffName")}><span>担当者 <b className="required-mark">*</b></span><input name="assignedStaffName" placeholder="担当者名" /></div>
        <div className="field"><span>同行担当者（任意）</span><input name="companionStaffName" placeholder="なし" /></div>
        <div className={fieldClass("visitDate")}><span>訪問日 <b className="required-mark">*</b></span><input name="visitDate" type="date" /></div>
        <div className={fieldClass("memo")}><span>狙い・メモ <b className="required-mark">*</b></span><textarea name="memo" placeholder="今日の狙いを入力してください" /></div>
        {errorFields.length > 0 && <div className="form-error">必須項目を入力してください。</div>}
        <Button type="submit" disabled={saving}>{saving ? "保存中..." : "保存して営業開始 →"}</Button>
      </form>}
      {view === "result" && <form className="sales-form-card" onSubmit={async event => {
        event.preventDefault();
        if (!validate(event.currentTarget, ["expectedHires", "actualCost", "personName0", "personAge0", "personRank0", "personPotential0", "personNextAction0"])) return;
        const form = new FormData(event.currentTarget);
        const people = [0, 1, 2].map(index => ({
          clubId: form.get(`personClubId${index}`),
          name: form.get(`personName${index}`),
          age: form.get(`personAge${index}`),
          scoutStatus: form.get(`personScout${index}`),
          rank: form.get(`personRank${index}`),
          vision: form.get(`personVision${index}`),
          potential: form.get(`personPotential${index}`),
          nextAction: form.get(`personNextAction${index}`),
          offerClubId: form.get(`personOfferClubId${index}`),
          guaranteePeriod: form.get(`personGuarantee${index}`),
          memo: form.get(`personMemo${index}`),
        }));
        setSaving(true);
        try {
          await postAdminSales("result", {
            visitId: visitForResult?.id,
            expectedHires: form.get("expectedHires"),
            actualCost: form.get("actualCost"),
            receiptUrl: form.get("receiptUrl"),
            isFreeNewSales: form.get("isFreeNewSales") === "on",
            followUpEnabled: form.get("followUpEnabled") === "on",
            assignedStaffName: visitForResult?.assigned_staff_name,
            people,
          });
          setSalesMessage("結果フォームを保存しました。リード一覧に反映します。");
          await refresh();
          setVisitForResult(null);
          setView("home");
        } catch (error) {
          setSalesMessage(error instanceof Error ? error.message : "保存に失敗しました");
        } finally {
          setSaving(false);
        }
      }}>
        <button type="button" className="back-mini" onClick={() => setView("home")}><ArrowLeft size={17}/> 戻る</button>
        <h2>結果フォーム</h2><p>{visitForResult ? `${visitForResult.club_name} / ${visitForResult.visit_date}` : "訪問後に記入してください"}</p>
        <div className="receipt-upload"><span>領収書スキャン</span><input name="receiptUrl" placeholder="領収書画像URL（Storage移行まではURL入力）" /><small>2人担当の場合はスキップ可</small></div>
        <div className={fieldClass("expectedHires")}><span>獲得見込み人数 <b className="required-mark">*</b></span><select name="expectedHires"><option value="">人数を選択</option><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></div>
        <div className={fieldClass("actualCost")}><span>実コスト（円） <b className="required-mark">*</b></span><input name="actualCost" inputMode="numeric" placeholder="例: 30000" /></div>
        <label className="switch-line"><span>フリー新規営業</span><input name="isFreeNewSales" type="checkbox" /></label>
        <label className="switch-line"><span>追撃・御礼</span><input name="followUpEnabled" type="checkbox" /></label>
        {[0, 1, 2].map(index => <div key={index} className="result-person-card"><h3>基本情報 {index + 1}人目</h3>
          <div className="field"><span>在籍店 {index === 0 && <b className="required-mark">*</b>}</span><input name={`personClubId${index}`} defaultValue={visitForResult?.club_name || ""} /></div>
          <div className={fieldClass(`personName${index}`)}><span>名前 {index === 0 && <b className="required-mark">*</b>}</span><input name={`personName${index}`} placeholder="名前を入力" /></div>
          <div className={fieldClass(`personAge${index}`)}><span>年齢 {index === 0 && <b className="required-mark">*</b>}</span><input name={`personAge${index}`} inputMode="numeric" /></div>
          <div className="field"><span>スカウト有無</span><select name={`personScout${index}`}><option>未確認</option><option>あり</option><option>なし</option></select></div>
          <div className={fieldClass(`personRank${index}`)}><span>ランク {index === 0 && <b className="required-mark">*</b>}</span><select name={`personRank${index}`}><option value="">選択してください</option><option>S</option><option>A</option><option>B</option><option>C</option></select></div>
          <div className="field"><span>ビジョン</span><select name={`personVision${index}`}><option>選択してください</option><option>移籍したい</option><option>条件次第</option><option>現状維持</option></select></div>
          <div className={fieldClass(`personPotential${index}`)}><span>移籍ポテンシャル {index === 0 && <b className="required-mark">*</b>}</span><select name={`personPotential${index}`}><option value="">選択してください</option><option>高</option><option>中</option><option>低</option></select></div>
          <div className={fieldClass(`personNextAction${index}`)}><span>ネクストアクション {index === 0 && <b className="required-mark">*</b>}</span><input name={`personNextAction${index}`} placeholder="例: LINE追撃" /></div>
          <div className="field"><span>オファー店舗</span><input name={`personOfferClubId${index}`} placeholder="店舗IDまたは店舗名" /></div>
          <div className="field"><span>保証期間</span><input name={`personGuarantee${index}`} placeholder="3ヶ月" /></div>
          <div className="field"><span>メモ</span><textarea name={`personMemo${index}`} placeholder="メモを入力" /></div>
        </div>)}
        {errorFields.length > 0 && <div className="form-error">1人目の必須項目を入力してください。</div>}
        <Button type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
      </form>}
    </section>
    <BottomNav role="admin" screen="sales" go={go}/>
  </main>;
}

function ClipboardIcon() {
  return <span className="emoji-icon">📋</span>;
}

function SalesSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="sales-section"><h2>{icon}{title}</h2>{children}</section>;
}

function AppRouter() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [isAdmin, setIsAdmin] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [authenticatedRole, setAuthenticatedRole] = useState("");
  const [hasSeekerProfile, setHasSeekerProfile] = useState(false);
  const [selectedClub, setSelectedClub] = useState<ClubRecord | null>(null);
  const [clubChoices, setClubChoices] = useState<ClubRecord[]>([]);
  const [clubPickerOpen, setClubPickerOpen] = useState(false);
  const [clubPickerQuery, setClubPickerQuery] = useState("");
  const role: Role = useMemo(() => ["offers","gacha","profile","photoEdit","profileEdit","ambassadorSetup","ambassadorProfile"].includes(screen) ? "seeker" : ["clubSetup","talent","sentOffers","clubProfile"].includes(screen) ? "club" : ["adminUsers","adminClubs","sales"].includes(screen) ? "admin" : "guest", [screen]);
  const mode: AdminViewMode = screen === "ambassadorSetup" || screen === "ambassadorProfile" ? "ambassador" : role === "admin" ? "admin" : role === "club" ? "club" : "seeker";
  const go = useCallback((nextScreen: Screen) => {
    const next = isScreen(nextScreen) ? nextScreen : "landing";
    setScreen(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("screen", next);
      if (selectedClub?.id) url.searchParams.set("clubId", selectedClub.id);
      window.history.replaceState(null, "", url);
    }
  }, [selectedClub?.id]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("screen");
    const source = new URLSearchParams(window.location.search).get("src");
    if (source === "ig" && requested === "signin") setScreen("instagramGate");
    else if (isScreen(requested)) setScreen(requested);
    else if (requested) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  useEffect(() => {
    fetch("/api/auth/line/status", { cache: "no-store" })
      .then(response => response.json())
      .then(async status => {
        const admin = Boolean(status.capabilities?.isAdmin);
        setIsAdmin(admin);
        setAuthenticatedRole(String(status.profile?.db_role || status.profile?.role || ""));
        setHasSeekerProfile(Boolean(status.capabilities?.hasSeekerProfile));
        const requestedClubId = new URLSearchParams(window.location.search).get("clubId") ||
          localStorage.getItem("maxvalue_admin_club_id") || status.capabilities?.selectedClubId || "";
        if (requestedClubId) {
          const clubs = await fetchClubs().catch(() => []);
          setClubChoices(safeArray(clubs));
          setSelectedClub(safeArray(clubs).find(club => club.id === requestedClubId) || null);
        }
      })
      .catch(() => undefined)
      .finally(() => setAuthResolved(true));
  }, []);
  useEffect(() => {
    if (!authResolved) return;
    if (adminProtectedScreens.includes(screen) && !isAdmin) {
      go("adminSignin");
      return;
    }
    if (clubProtectedScreens.includes(screen) && !["club", "club_staff", "admin"].includes(authenticatedRole)) {
      go("clubSignin");
      return;
    }
    if (ambassadorProtectedScreens.includes(screen) && !["ambassador", "admin"].includes(authenticatedRole)) {
      go("signin");
      return;
    }
    if (seekerProtectedScreens.includes(screen) && !authenticatedRole && !isAdmin) {
      go("signin");
    }
  }, [authResolved, authenticatedRole, go, isAdmin, screen]);
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);
  const switchMode = useCallback((nextMode: AdminViewMode) => {
    if (!isAdmin) return;
    if (nextMode === "admin") go("adminUsers");
    if (nextMode === "seeker") go(hasSeekerProfile ? "profile" : "setup");
    if (nextMode === "ambassador") go("ambassadorProfile");
    if (nextMode === "club") {
      setClubPickerOpen(true);
      if (!clubChoices.length) fetchClubs().then(items => setClubChoices(safeArray(items))).catch(() => setClubChoices([]));
    }
  }, [clubChoices.length, go, hasSeekerProfile, isAdmin]);
  const chooseClub = async (club: ClubRecord) => {
    const response = await fetch("/api/session/club", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clubId: club.id }),
    });
    if (!response.ok) return;
    setSelectedClub(club);
    localStorage.setItem("maxvalue_admin_club_id", club.id);
    setClubPickerOpen(false);
    setClubPickerQuery("");
    const url = new URL(window.location.href);
    url.searchParams.set("clubId", club.id);
    url.searchParams.set("screen", "talent");
    window.history.replaceState(null, "", url);
    setScreen("talent");
  };

  let content: ReactNode;
  if (screen === "landing") content = <Landing go={go}/>;
  else if (screen === "signin") content = <Signin go={go}/>;
  else if (screen === "friendAdd") content = <FriendAdd go={go}/>;
  else if (screen === "instagramGate") content = <InstagramGate go={go}/>;
  else if (screen === "clubSignin") content = <Signin go={go} club/>;
  else if (screen === "adminSignin") content = <AdminSignin go={go}/>;
  else if (screen === "setup") content = <Setup go={go}/>;
  else if (screen === "clubSetup") content = <Setup go={go} club/>;
  else if (screen === "offers") content = <Offers go={go}/>;
  else if (screen === "gacha") content = <Gacha go={go}/>;
  else if (screen === "profile") content = <Profile go={go}/>;
  else if (screen === "photoEdit") content = <PhotoEdit go={go}/>;
  else if (screen === "profileEdit") content = <ProfileEdit go={go}/>;
  else if (screen === "ambassadorSetup") content = <AmbassadorSetup go={go}/>;
  else if (screen === "ambassadorProfile") content = <AmbassadorProfile go={go}/>;
  else if (screen === "talent") content = <Talent go={go}/>;
  else if (screen === "adminUsers") content = <Talent go={go} admin/>;
  else if (screen === "adminClubs") content = <AdminClubs go={go}/>;
  else if (screen === "sentOffers") content = <SentOffers go={go}/>;
  else if (screen === "clubProfile") content = <ClubProfile go={go}/>;
  else content = <Sales go={go}/>;

  const visibleClubChoices = clubChoices.filter(club => matchesClubSearch(club, clubPickerQuery));
  return <AdminCapabilityContext.Provider value={{ isAdmin, mode, selectedClub, switchMode }}>{content}{clubPickerOpen && <div className="modal-backdrop admin-club-picker"><div className="club-picker-modal"><button type="button" className="modal-x" onClick={() => setClubPickerOpen(false)}><X/></button><span className="eyebrow">STORE CONTEXT</span><h2>表示する店舗を選択</h2><p>管理者は全店舗の画面を確認できます。</p><div className="search-box"><Search/><input value={clubPickerQuery} onChange={event => setClubPickerQuery(event.target.value)} placeholder="店舗名・地域・エリアで検索"/></div><div className="club-picker-list">{visibleClubChoices.map(club => <button type="button" key={club.id} className={selectedClub?.id === club.id ? "active" : ""} onClick={() => chooseClub(club)}><div className="club-logo">{safeInitial(club.display_name)}</div><span><b>{club.display_name}</b><small>{club.region} / {club.area}</small></span><ChevronRight/></button>)}</div></div></div>}</AdminCapabilityContext.Provider>;
}

export default function Page() {
  return <AppErrorBoundary><AppRouter /></AppErrorBoundary>;
}
