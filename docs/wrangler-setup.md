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

## 3. 環境変数の設定

プロジェクトルートに `.env.local` ファイルを作成：

```bash
# .env.local
export CLOUDFLARE_API_TOKEN="your-api-token-here"
```

**重要**: このファイルは `.gitignore` に含まれており、git にコミットされません。

## 4. 使用方法

### 環境変数の読み込み

wrangler コマンドを実行する前に、環境変数を読み込みます：

```bash
source .env.local
```

### デプロイメント一覧の確認

```bash
wrangler pages deployment list --project-name=chronicle-969
```

### デプロイメントの削除

```bash
wrangler pages deployment delete <deployment-id> --project-name=chronicle-969
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

# 再度読み込み
source .env.local
```

### 「Project not found」エラー

プロジェクト名が正しいか確認してください。Cloudflare Dashboard で確認できます。

```bash
# アカウント内のプロジェクト一覧
wrangler pages project list
```

## 参考リンク

- [Wrangler CLI - Cloudflare Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Pages Commands - Cloudflare Docs](https://developers.cloudflare.com/workers/wrangler/commands/#pages)
