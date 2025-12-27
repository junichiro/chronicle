# Chronicle - Personal Tech Blog

Cloudflare Pages + Jekyll + Chirpy テーマで構築された個人ブログ

## サイト情報

- **URL**: https://chronicle-969.pages.dev/
- **リポジトリ**: https://github.com/junichiro/chronicle
- **ホスティング**: Cloudflare Pages
- **テーマ**: [Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy)
- **言語設定**: 日本語 (ja-JP)
- **タイムゾーン**: Asia/Tokyo

## ディレクトリ構成

```
chronicle/
├── _posts/              # 記事を置くディレクトリ
│   └── YYYY-MM-DD-slug.md
├── _drafts/             # 下書き（公開されない）
├── _tabs/               # サイドバーのページ（About, Archives等）
├── _data/               # サイト設定データ
├── _config.yml          # サイト全体の設定
├── assets/              # 画像などの静的ファイル
│   └── img/
└── CLAUDE.md            # このファイル
```

## 記事の書き方

### ファイル命名規則

```
_posts/YYYY-MM-DD-slug.md
```

- `YYYY-MM-DD`: 公開日
- `slug`: URL用の識別子（英数字とハイフン）

**重要**: 日付は必ず `date` コマンドで現在日時を確認してから使用すること。

### Front Matter（必須）

記事の先頭に YAML 形式でメタデータを記述：

```yaml
---
title: 記事のタイトル
date: 2025-12-27 10:00:00 +0900
categories: [カテゴリ1, カテゴリ2]
tags: [タグ1, タグ2]
---
```

### Front Matter（オプション）

```yaml
---
title: 記事のタイトル
date: 2025-12-27 10:00:00 +0900
categories: [Tech, Programming]
tags: [rust, web, tutorial]

# オプション設定
pin: true              # トップページに固定表示
toc: true              # 目次を表示（デフォルト: true）
comments: true         # コメント機能（デフォルト: true）
math: true             # 数式レンダリングを有効化
mermaid: true          # Mermaid図を有効化

# アイキャッチ画像
image:
  path: /assets/img/posts/example.jpg
  alt: 画像の説明文
---
```

### 本文の書き方（Markdown）

```markdown
## 見出し2

本文テキスト。**太字**や*イタリック*が使えます。

### 見出し3

- リスト項目1
- リスト項目2

1. 番号付きリスト
2. 番号付きリスト

> 引用文

[リンクテキスト](https://example.com)

![画像の説明](/assets/img/posts/image.jpg)

コードブロック：

```python
def hello():
    print("Hello, World!")
```
```

### 画像の配置

画像は `assets/img/` 以下に配置：

```
assets/
└── img/
    ├── posts/          # 記事用画像
    │   └── 2025/
    │       └── example.jpg
    └── favicons/       # ファビコン
```

記事内での参照：

```markdown
![説明](/assets/img/posts/2025/example.jpg)
```

## 記事の公開手順

```bash
# 1. 記事ファイルを作成
# 2. コミット & プッシュ
git add _posts/YYYY-MM-DD-slug.md
git commit -m "Add: 記事タイトル"
git push

# 3. Cloudflare Pages が自動でビルド・デプロイ（1-2分）
```

## 下書きとプレビュー

Cloudflare PagesではブランチごとにプレビューURLが発行されるため、下書きの確認が簡単にできる。

### 方法1: ブランチプレビュー（推奨）

```bash
# 1. ドラフト用ブランチを作成
git checkout -b draft/my-new-post

# 2. _posts/ に記事を作成（通常通り）
# 3. コミット & プッシュ
git add _posts/2025-12-27-my-new-post.md
git commit -m "Draft: 新しい記事"
git push -u origin draft/my-new-post

# → 自動でプレビューURLが発行される
# 例: https://draft-my-new-post.chronicle-969.pages.dev/

# 4. 確認後、mainにマージして公開
git checkout main
git merge draft/my-new-post
git push
git branch -d draft/my-new-post
```

### 方法2: _drafts ディレクトリ

`_drafts/` に置いた記事は公開されない（ローカルプレビュー用）：

```
_drafts/
└── my-draft-post.md    # 日付プレフィックス不要
```

## カテゴリとタグ

### カテゴリ

階層構造を表現できる（最大2階層推奨）：

```yaml
categories: [Tech, Rust]     # Tech > Rust
categories: [Life]           # Life
```

### タグ

フラットな分類。複数指定可能：

```yaml
tags: [rust, web, backend, tutorial]
```

## Chirpy テーマの機能

### プロンプト（注意書きブロック）

```markdown
> 情報メッセージ
{: .prompt-info }

> ヒント
{: .prompt-tip }

> 警告
{: .prompt-warning }

> 危険
{: .prompt-danger }
```

### ファイル名の表示

コードブロックにファイル名を表示：

````markdown
```python
def hello():
    print("Hello!")
```
{: file="hello.py" }
````

### 数式（MathJax）

Front Matter で `math: true` を設定後：

```markdown
インライン数式: $E = mc^2$

ブロック数式:
$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$
```

### Mermaid 図

Front Matter で `mermaid: true` を設定後：

````markdown
```mermaid
graph LR
    A[開始] --> B[処理]
    B --> C[終了]
```
````

## 設定ファイル

### _config.yml の主要設定

```yaml
title: Chronicle              # サイトタイトル
tagline: Personal Tech Blog   # サブタイトル
description: 技術と日常の記録  # サイト説明
url: "https://chronicle-969.pages.dev"
baseurl: ""
lang: ja-JP
timezone: Asia/Tokyo
```

### アバター設定

`_config.yml` の `avatar` に画像パスを設定：

```yaml
avatar: /assets/img/avatar.jpg
```

## Cloudflare Pages 設定

### 環境変数

Cloudflareダッシュボードで設定済み：

| Variable | Value |
|----------|-------|
| `BUNDLE_WITHOUT` | `test` |

### ビルド設定

| 項目 | 値 |
|------|-----|
| Framework preset | Jekyll |
| Build command | `jekyll build` |
| Build output directory | `_site` |

## ローカルプレビュー（オプション）

```bash
# Ruby と Bundler が必要
bundle install
bundle exec jekyll serve

# http://127.0.0.1:4000/ でプレビュー
```

ドラフトを含めてプレビュー：

```bash
bundle exec jekyll serve --drafts
```

## 参考リンク

- [Chirpy公式ドキュメント](https://chirpy.cotes.page/)
- [Jekyll公式ドキュメント](https://jekyllrb.com/docs/)
- [Chirpy Writing Guide](https://chirpy.cotes.page/posts/write-a-new-post/)
- [Cloudflare Pages](https://pages.cloudflare.com/)
