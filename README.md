# MAXVALUE

Next.js + Supabaseで構築したMAXVALUEのWebアプリです。このGitHubリポジトリを唯一の編集元として扱います。

## 編集ルール

- Fable、Codex、その他の開発ツールは、必ずこのGitHubリポジトリを読み込んで編集します。
- `main` は本番用です。変更は作業ブランチで行い、確認後にPull Requestで `main` へ反映します。
- Vercelはこのリポジトリの `main` を本番デプロイ元にします。
- トップページの文言、ストーリー、会社情報、利用規約、プライバシーポリシーは `content/site-content.ts` へ集約しています。
- `.env.local`、LINE・Supabase・管理コード等の秘密情報はGitHubへ保存しません。

## 起動・確認

```bash
npm install
npm run dev
```

変更前後の最低限の確認:

```bash
npm run typecheck
npm run build
```

## 必要な環境変数

値は `.env.local` とVercelに設定し、GitHubへコミットしません。

```bash
NEXT_PUBLIC_APP_URL=https://maxvalue-seven.vercel.app
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...
LINE_MESSAGING_CHANNEL_ID=...
LINE_MESSAGING_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
NEXT_PUBLIC_LINE_FRIEND_URL=...
ADMIN_ACCESS_CODE=...
```

## データベース

Supabaseの定義と変更履歴は `supabase/` に保存しています。本番へ適用する前に対象migrationを確認してください。

## 公開前チェック

- 利用規約・プライバシーポリシーは `content/site-content.ts` に集約しています。公開前に弁護士確認済み文面へ差し替えてください。
- LINEログイン後の求職者・店舗・アンバサダー・管理者フローは、各権限の実アカウントで確認してください。
- `npm run typecheck` と `npm run build` が完了してから本番反映してください。
