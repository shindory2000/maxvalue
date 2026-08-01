import { createHmac, timingSafeEqual } from "crypto";

const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_BOT_PROFILE_URL = "https://api.line.me/v2/bot/profile";

export type LineProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
};

export type OfferFlexInput = {
  offerId?: string;
  clubName: string;
  staffName: string;
  hourlyWage: number;
  guaranteePeriod: string;
  comment: string;
  options?: string[];
};

export type OfferActionChoiceInput = {
  offerId: string;
  hourlyWage: number;
};

export type AdminMessageFlexInput = {
  title?: string;
  message: string;
};

export function getLineConfig() {
  return {
    channelId: process.env.LINE_LOGIN_CHANNEL_ID || process.env.LINE_CHANNEL_ID || "",
    channelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET || "",
    messagingChannelId: process.env.LINE_MESSAGING_CHANNEL_ID || "",
    messagingChannelSecret: process.env.LINE_MESSAGING_CHANNEL_SECRET || "",
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
    // Prefer the explicit webhook secret. In LINE this is usually the
    // Messaging API channel secret, but keeping it separate avoids mixing it
    // up with the LINE Login channel secret.
    webhookSecret: process.env.LINE_WEBHOOK_SECRET || process.env.LINE_MESSAGING_CHANNEL_SECRET || "",
    friendUrl: process.env.NEXT_PUBLIC_LINE_FRIEND_URL || process.env.LINE_FRIEND_URL || "",
    redirectUri:
      process.env.LINE_REDIRECT_URI ||
      `${process.env.NEXT_PUBLIC_APP_URL || "https://maxvalue-seven.vercel.app"}/api/auth/line/callback`,
  };
}

export type LineOAuthStatePayload = {
  nonce: string;
  returnTo: string;
  role: "seeker" | "club_staff" | "ambassador" | "admin";
  clubCode?: string;
  referralCode?: string;
  redirectUri: string;
  issuedAt: number;
};

function getOAuthStateSecret() {
  const config = getLineConfig();
  return config.channelSecret || process.env.ADMIN_ACCESS_CODE || "";
}

export function createLineOAuthState(payload: LineOAuthStatePayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getOAuthStateSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyLineOAuthState(value?: string | null): LineOAuthStatePayload | null {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", getOAuthStateSecret()).update(encoded).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LineOAuthStatePayload;
    if (!payload.nonce || !payload.returnTo || !payload.redirectUri || !payload.issuedAt) return null;
    if (Date.now() - payload.issuedAt > 10 * 60 * 1000 || payload.issuedAt > Date.now() + 60_000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isLineLoginConfigured() {
  const config = getLineConfig();
  return Boolean(config.channelId && config.channelSecret && config.redirectUri);
}

export function buildLineAuthorizeUrl(
  state: string,
  redirectUri = getLineConfig().redirectUri,
  options: { promptFriendAdd?: boolean } = {},
) {
  const config = getLineConfig();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.channelId,
    redirect_uri: redirectUri,
    state,
    scope: "profile openid",
  });
  // Let LINE handle friend addition inside the OAuth flow. This keeps users
  // in one continuous journey and returns them to our callback automatically.
  if (options.promptFriendAdd) query.set("bot_prompt", "aggressive");
  return `${LINE_AUTHORIZE_URL}?${query}`;
}

export async function exchangeLineCode(code: string, redirectUri = getLineConfig().redirectUri) {
  const config = getLineConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.channelId,
    client_secret: config.channelSecret,
  });
  const response = await fetch(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`LINE token exchange failed: ${response.status}`);
  return response.json() as Promise<{ access_token: string; id_token?: string }>;
}

export async function fetchLineProfile(accessToken: string): Promise<LineProfile> {
  const response = await fetch(LINE_PROFILE_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`LINE profile fetch failed: ${response.status}`);
  return response.json() as Promise<LineProfile>;
}

export function buildOfferFlexMessage(input: OfferFlexInput) {
  const wage = Number(input.hourlyWage || 0).toLocaleString("ja-JP");
  const interestedAction = input.offerId
    ? { type: "postback", label: "興味あり", data: `offer_id=${input.offerId}&status=interested`, displayText: "興味あり" }
    : { type: "message", label: "興味あり", text: "興味あり" };
  const rejectedAction = input.offerId
    ? { type: "postback", label: "今回は見送る", data: `offer_id=${input.offerId}&status=rejected`, displayText: "今回は見送る" }
    : { type: "message", label: "今回は見送る", text: "今回は見送る" };
  return {
    type: "flex",
    altText: `${input.clubName}からオファーが届きました`,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "26px",
        backgroundColor: "#fbf7ef",
        contents: [
          { type: "text", text: "お店から", size: "xs", color: "#9a8870", weight: "bold" },
          { type: "text", text: input.clubName, size: "xxl", weight: "bold", color: "#171717", margin: "md", wrap: true },
          { type: "text", text: `担当：${input.staffName || "店舗スタッフ"}`, size: "sm", color: "#7c766f", margin: "sm" },
          {
            type: "box",
            layout: "vertical",
            margin: "xl",
            paddingAll: "22px",
            cornerRadius: "22px",
            backgroundColor: "#24211e",
            contents: [
              { type: "text", text: "OFFER", size: "xxs", weight: "bold", color: "#c8a96a" },
              { type: "text", text: `時給 ${wage} 円`, size: "xxl", weight: "bold", color: "#ffffff", margin: "sm" },
              { type: "separator", margin: "lg", color: "#c8a96a55" },
              { type: "text", text: `保証期間 ${input.guaranteePeriod}`, size: "xl", weight: "bold", color: "#ffffff", margin: "lg" },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            paddingAll: "14px",
            cornerRadius: "16px",
            backgroundColor: "#ffffff",
            contents: [
              { type: "text", text: input.comment || "よろしく", wrap: true, size: "md", color: "#4b4b4b" },
            ],
          },
          ...(input.options?.length ? [{
            type: "box",
            layout: "vertical",
            margin: "md",
            paddingAll: "14px",
            cornerRadius: "16px",
            backgroundColor: "#efe8dc",
            contents: [
              { type: "text", text: "SPECIAL CONDITIONS", size: "xxs", weight: "bold", color: "#9a8870" },
              { type: "text", text: input.options.join(" ・ "), wrap: true, size: "sm", color: "#24211e", margin: "sm", weight: "bold" },
            ],
          }] : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        backgroundColor: "#fbf7ef",
        paddingAll: "20px",
        contents: [
          { type: "button", style: "primary", color: "#85c7dc", action: interestedAction },
          { type: "button", style: "secondary", action: rejectedAction },
        ],
      },
    },
  };
}

export function buildOfferActionChoiceFlexMessage(input: OfferActionChoiceInput) {
  const wage = Number(input.hourlyWage || 0).toLocaleString("ja-JP");
  return {
    type: "flex",
    altText: "次のアクションを選択してください",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "24px",
        backgroundColor: "#fbf7ef",
        contents: [
          { type: "text", text: "ありがとうございます", size: "xs", weight: "bold", color: "#9a8870" },
          { type: "text", text: "ご希望の進め方を選んでください", wrap: true, size: "xl", weight: "bold", color: "#171717", margin: "md" },
          { type: "text", text: "どちらを選んでも、次に日程選択へ進みます。", wrap: true, size: "sm", color: "#7c766f", margin: "md" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        backgroundColor: "#fbf7ef",
        paddingAll: "20px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#24211e",
            action: {
              type: "postback",
              label: "面接を希望する",
              data: `offer_id=${input.offerId}&action=select_next_action&next_action=consultation_only`,
              displayText: "面接を希望する",
            },
          },
          {
            type: "button",
            style: "primary",
            color: "#85c7dc",
            action: {
              type: "postback",
              label: `体験入店する（${wage}円）`,
              data: `offer_id=${input.offerId}&action=select_next_action&next_action=trial_shift`,
              displayText: `体験入店する（体験時給 ${wage}円）`,
            },
          },
        ],
      },
    },
  };
}

export function buildOfferDatePickerFlexMessage(input: OfferActionChoiceInput & { nextAction: string }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://maxvalue-seven.vercel.app";
  const scheduleUrl = new URL(appUrl);
  scheduleUrl.searchParams.set("screen", "offers");
  scheduleUrl.searchParams.set("scheduleOffer", input.offerId);
  scheduleUrl.searchParams.set("nextAction", input.nextAction);
  return {
    type: "flex",
    altText: "希望日を選択してください",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "24px",
        backgroundColor: "#fbf7ef",
        contents: [
          { type: "text", text: "日程選択", size: "xs", weight: "bold", color: "#9a8870" },
          { type: "text", text: "アプリで希望日を選んでください", wrap: true, size: "xl", weight: "bold", color: "#171717", margin: "md" },
          { type: "text", text: "アプリと同じ日程調整画面が開きます。20時以降（日曜日を除く）でご希望日をお送りください。", wrap: true, size: "sm", color: "#7c766f", margin: "md" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#fbf7ef",
        paddingAll: "20px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#85c7dc",
            action: {
              type: "uri",
              label: "アプリで希望日を選ぶ",
              uri: scheduleUrl.toString(),
            },
          },
        ],
      },
    },
  };
}

export function buildAdminMessageFlexMessage(input: AdminMessageFlexInput) {
  return {
    type: "flex",
    altText: "MAXVALUE運営からメッセージが届きました",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "24px",
        backgroundColor: "#fbf7ef",
        contents: [
          { type: "text", text: "MAXVALUE運営から", size: "xs", weight: "bold", color: "#9a8870" },
          { type: "text", text: input.title || "お知らせ", size: "xl", weight: "bold", color: "#171717", margin: "md", wrap: true },
          {
            type: "box",
            layout: "vertical",
            margin: "lg",
            paddingAll: "16px",
            cornerRadius: "16px",
            backgroundColor: "#ffffff",
            contents: [{ type: "text", text: input.message, wrap: true, size: "md", color: "#3d3d3d" }],
          },
        ],
      },
    },
  };
}

export function verifyLineSignature(body: string, signature: string | null) {
  const secret = getLineConfig().webhookSecret;
  // Fail closed: a webhook without a configured secret must never be trusted.
  if (!secret) return false;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("base64");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function sendLinePushMessage(to: string, messages: unknown[]) {
  const token = getLineConfig().channelAccessToken;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
  const response = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!response.ok) throw new Error(`LINE push failed: ${response.status} ${await response.text()}`);
}

export async function sendLineReplyMessage(replyToken: string, messages: unknown[]) {
  const token = getLineConfig().channelAccessToken;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
  const response = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!response.ok) throw new Error(`LINE reply failed: ${response.status} ${await response.text()}`);
}

export async function fetchLineBotProfile(userId: string): Promise<Partial<LineProfile>> {
  const token = getLineConfig().channelAccessToken;
  if (!token || !userId) return {};
  const response = await fetch(`${LINE_BOT_PROFILE_URL}/${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return {};
  return response.json() as Promise<Partial<LineProfile>>;
}

export const lineEndpoints = {
  authorize: LINE_AUTHORIZE_URL,
  token: LINE_TOKEN_URL,
  profile: LINE_PROFILE_URL,
  push: LINE_PUSH_URL,
  reply: LINE_REPLY_URL,
};
