# Wrangler CLI セットアップガイド

Cloudflare Pages のデプロイメント管理に必要な wrangler CLI のセットアップ手順です。

## 1. wrangler のインストール

```bash
npm install -g wrangler
```

または、プロジェクトローカルにインストール済みの場合は `npx wrangler` で実行できます。

## 2. Cloudflare API Token の取得

1. [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) にアクセス
2. 「Create Token」をクリック
3. 「Edit Cloudflare Workers」テンプレートを選択、または以下の権限でカスタムトークンを作成：
   - **Account** > **Cloudflare Pages** > **Edit**
   - **Zone** > **Zone** > **Read**（必要に応じて）

4. トークンをコピー

## 3. Account ID の取得

Cloudflare Dashboard の URL から Account ID を確認できます：

```
https://dash.cloudflare.com/<ACCOUNT_ID>/pages
```

この `<ACCOUNT_ID>` の部分（32文字の英数字）をメモしてください。

## 4. 環境変数の設定

プロジェクトルートに `.env.local` ファイルを作成：

```bash
# .env.local
export CLOUDFLARE_API_TOKEN="your-api-token-here"
export CLOUDFLARE_ACCOUNT_ID="your-account-id-here"
```

**重要**: このファイルは `.gitignore` に含まれており、git にコミットされません。

## 5. 使用方法

### 環境変数の読み込み

wrangler コマンドを実行する前に、環境変数を読み込みます：

```bash
source .env.local
```

### デプロイメント一覧の確認

```bash
wrangler pages deployment list --project-name=chronicle
```

**注意**: プロジェクト名は `chronicle` です（`chronicle-969` はドメイン名）。

### デプロイメントの削除

wrangler v4.x では `deployment delete` コマンドが廃止されたため、Cloudflare API を直接使用します：

```bash
curl -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/chronicle/deployments/<deployment-id>?force=true" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
```

## Claude Code での使用

`/cleanup-previews` コマンドを使用すると、対話的にプレビューデプロイメントを削除できます。

```
/cleanup-previews
```

## トラブルシューティング

### 認証エラーが発生する場合

```bash
# トークンが正しく設定されているか確認
echo $CLOUDFLARE_API_TOKEN
echo $CLOUDFLARE_ACCOUNT_ID

# 再度読み込み
source .env.local
```

### 「Project not found」エラー

プロジェクト名が正しいか確認してください。正しいプロジェクト名は `chronicle` です。

```bash
# アカウント内のプロジェクト一覧
wrangler pages project list
```

### 「/memberships」エラー

`CLOUDFLARE_ACCOUNT_ID` 環境変数が設定されていない可能性があります。`.env.local` に追加してください。

## 参考リンク

- [Wrangler CLI - Cloudflare Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Pages Commands - Cloudflare Docs](https://developers.cloudflare.com/workers/wrangler/commands/#pages)
- [Cloudflare API - Pages Deployments](https://developers.cloudflare.com/api/resources/pages/subresources/deployments/)
