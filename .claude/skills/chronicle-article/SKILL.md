---
name: chronicle-article
description: Chronicleブログの記事作成ワークフロー。議論を記事にしたい、ブログに書きたい、記事を作成したい、という要望があった時に使用。
---

# Chronicle 記事作成スキル

このスキルは、Chronicleブログ（https://chronicle-969.pages.dev/）への記事作成を支援します。

## トリガーワード

以下のような発言があった場合にこのスキルを使用：
- 「記事にしたい」「記事にまとめたい」
- 「ブログに書きたい」「ブログにしたい」
- 「これを公開したい」
- 「ドラフトを作って」

## ワークフロー

### 1. 日付の確認（必須）

```bash
date +%Y-%m-%d
```

記事のファイル名とFront Matterに使用する日付を必ず確認する。

### 2. 記事構成の提案

`article-planner` サブエージェントを使用して：
- 会話内容を分析
- 記事構成を提案
- タイトル候補を提示
- カテゴリ・タグを提案

### 3. ユーザー確認

構成案についてユーザーの確認を取る：
- タイトルの選択
- 構成の調整
- 追加したい内容

### 4. 記事の執筆

`article-writer` サブエージェントを使用して：
- Markdown形式で記事を執筆
- `_posts/YYYY-MM-DD-slug.md` に保存

### 5. ドラフトブランチの作成

```bash
# ブランチ名を生成（slugから）
git checkout -b draft/SLUG

# 記事をコミット
git add _posts/YYYY-MM-DD-slug.md
git commit -m "Draft: 記事タイトル"
git push -u origin draft/SLUG
```

### 6. プレビューURLの案内

Cloudflare Pagesが自動でプレビューURLを発行：
```
https://draft-SLUG.chronicle-969.pages.dev/
```

## ファイル形式

### Front Matter

```yaml
---
title: 記事タイトル
date: YYYY-MM-DD HH:MM:SS +0900
categories: [カテゴリ1, カテゴリ2]
tags: [タグ1, タグ2, タグ3]
---
```

### ファイル命名規則

```
_posts/YYYY-MM-DD-slug.md
```

- `YYYY-MM-DD`: 公開日（dateコマンドで確認した日付）
- `slug`: 英数字とハイフンのみ（日本語不可）

## 注意事項

1. **日付は必ずコマンドで確認** - 記憶に頼らない
2. **slugは英語で** - URLに使用されるため
3. **ブランチ名はdraft/で始める** - プレビュー用
4. **画像は assets/img/posts/YYYY/ に配置**

## 関連ファイル

- 記事テンプレート: CLAUDE.md参照
- 設定: _config.yml
- テーマ機能: Chirpyドキュメント参照
