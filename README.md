# Chronicle

技術と日常の記録。個人的な技術ブログです。

## サイト情報

- **URL**: https://chronicle.junichiro.co.uk/
- **フレームワーク**: [Astro](https://astro.build/) + [AstroPaper](https://github.com/satnaing/astro-paper)
- **ホスティング**: [Cloudflare Pages](https://pages.cloudflare.com/)

## 特徴

- ダークモード対応
- レスポンシブデザイン
- シンタックスハイライト
- 高速なページ読み込み
- 静的検索機能 (Pagefind)
- OGP画像の自動生成

## ローカル開発

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev
# http://localhost:4321/

# ビルド
npm run build

# ビルドのプレビュー
npm run preview
```

## 記事の追加

`src/data/blog/` ディレクトリに Markdown ファイルを作成します。

```yaml
---
author: junichiro
pubDatetime: 2025-12-27T10:00:00+09:00
title: 記事のタイトル
slug: article-slug
featured: false
draft: false
tags:
  - タグ1
  - タグ2
description: 記事の説明文
---

本文をここに記述...
```

## ライセンス

MIT License
