---
description: 不要なプレビューデプロイメントを削除する
---

# /cleanup-previews コマンド

Cloudflare Pages の不要なプレビューデプロイメントを削除します。

## 前提条件

- wrangler CLI がインストールされていること
- `.env.local` に `CLOUDFLARE_API_TOKEN` が設定されていること

設定方法は `docs/wrangler-setup.md` を参照してください。

## 実行手順

### 1. 環境変数の読み込み

```bash
source .env.local
```

### 2. デプロイメント一覧の取得

```bash
wrangler pages deployment list --project-name=chronicle-969
```

出力例：
```
Deployment ID: abc123
Branch: draft/my-post
URL: https://abc123.chronicle-969.pages.dev
Created: 2025-01-15T10:00:00Z
```

### 3. ユーザーに確認

一覧をユーザーに提示し、削除対象を確認してください：

- 本番（production）デプロイメントは削除しない
- 削除対象を明示的に確認する

### 4. 削除の実行

ユーザーが確認した後、対象のデプロイメントを削除：

```bash
wrangler pages deployment delete <deployment-id> --project-name=chronicle-969
```

複数削除する場合は、各デプロイメント ID に対して実行してください。

### 5. 完了報告

```
プレビューデプロイメントを削除しました。

削除済み:
- <branch-name>: <deployment-id>
- ...

残りのデプロイメント数: X
```

## 注意事項

- **本番デプロイメントは削除しないでください**
- エイリアス付きデプロイメント（staging など）は `--force` オプションが必要な場合があります
- 削除は取り消せません。実行前に必ずユーザーの確認を得てください
