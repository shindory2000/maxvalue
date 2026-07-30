import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

    const form = await request.formData();
    const file = form.get("file");
    const lineUserId = String(form.get("lineUserId") || "");
    const slot = String(form.get("slot") || "photo");
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
    const authenticatedLineUserId = request.cookies.get("maxvalue_line_user_id")?.value || "";
    if (!authenticatedLineUserId) return NextResponse.json({ error: "LINEログインが必要です" }, { status: 401 });
    if (!lineUserId || lineUserId !== authenticatedLineUserId) {
      return NextResponse.json({ error: "ログイン情報が一致しません" }, { status: 403 });
    }
    const isVerificationVideo = slot === "face_verification";
    const fileExtension = file.name.split(".").pop()?.toLowerCase() || "";
    const fallbackMimeByExtension: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
      heic: "image/heic", heif: "image/heif", webm: "video/webm", mp4: "video/mp4",
      mov: "video/quicktime",
    };
    const rawContentType = file.type || fallbackMimeByExtension[fileExtension] || "";
    const contentType = rawContentType.split(";")[0].trim().toLowerCase();
    const allowedMimeTypes = isVerificationVideo
      ? new Set(["video/webm", "video/mp4", "video/quicktime"])
      : new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
    if (!allowedMimeTypes.has(contentType)) {
      return NextResponse.json({ error: isVerificationVideo ? "WebM / MP4 / MOV の動画だけアップロードできます" : "JPEG / PNG / WebP / HEIC の画像だけアップロードできます" }, { status: 400 });
    }
    const maxSize = isVerificationVideo ? 30 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: isVerificationVideo ? "動画サイズは30MB以下にしてください" : "画像サイズは10MB以下にしてください" }, { status: 400 });
    }

    const fallbackExt = isVerificationVideo ? (contentType === "video/mp4" ? "mp4" : contentType === "video/quicktime" ? "mov" : "webm") : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : contentType === "image/heic" ? "heic" : contentType === "image/heif" ? "heif" : "jpg";
    const rawExt = file.name.split(".").pop() || fallbackExt;
    const ext = rawExt.replace(/[^a-z0-9]/gi, "").toLowerCase() || fallbackExt;
    const safeLineUserId = lineUserId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "temporary";
    const safeSlot = slot.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "photo";
    const path = `${safeLineUserId}/${safeSlot}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("user-images")
      .upload(path, file, { upsert: true, contentType });
    if (error) {
      const detail = error.message || "storage upload failed";
      const message = detail.toLowerCase().includes("bucket")
        ? "写真保存先のStorage bucket（user-images）が未設定です。"
        : "写真アップロードに失敗しました。時間を置いて再度お試しください。";
      console.error("[storage-upload] upload failed", { detail, type: contentType, size: file.size, slot });
      return NextResponse.json({ error: message, detail }, { status: 500 });
    }

    const { data } = supabase.storage.from("user-images").getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error("[storage-upload] failed", { detail });
    return NextResponse.json({ error: "写真アップロードに失敗しました。", detail }, { status: 500 });
  }
}
