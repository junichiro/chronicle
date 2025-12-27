---
description: 不要なプレビューデプロイメントを削除する
---

# /cleanup-previews コマンド

Cloudflare Pages の不要なプレビューデプロイメントを削除します。

## 前提条件

- wrangler CLI がインストールされていること
- `.env.local` に以下が設定されていること：
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`

設定方法は `docs/wrangler-setup.md` を参照してください。

## 実行手順

### 1. 環境変数の読み込み

```bash
source .env.local
```

### 2. デプロイメント一覧の取得

```bash
wrangler pages deployment list --project-name=chronicle
```

**注意**: プロジェクト名は `chronicle` です（`chronicle-969` はドメイン名）。

### 3. 削除候補の判断

以下の基準でプレビューデプロイメントを削除候補とする：

1. **Environment が Preview であること**（Production は削除しない）
2. **リモートブランチが存在しないこと**（マージ済み）

リモートブランチの確認：
```bash
git fetch --prune
git branch -r
```

### 4. ユーザーに確認

一覧をユーザーに提示し、削除対象を確認してください：

- 本番（Production）デプロイメントは削除しない
- 削除対象を明示的に確認する

### 5. 削除の実行

wrangler v4.x では `deployment delete` コマンドが廃止されたため、Cloudflare API を直接使用します。

ユーザーが確認した後、対象のデプロイメントを削除：

```bash
source .env.local
curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/chronicle/deployments/<deployment-id>?force=true" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
```

複数削除する場合は、各デプロイメント ID に対して実行してください。

### 6. 完了報告

```
プレビューデプロイメントを削除しました。

削除済み:
- <branch-name>: <deployment-id>
- ...

残りのデプロイメント数: X
```

## 注意事項

- **本番デプロイメントは削除しないでください**
- 削除は取り消せません。実行前に必ずユーザーの確認を得てください
- `?force=true` パラメータにより、エイリアス付きデプロイメントも削除可能です
