# Chronicle - Personal Tech Blog

Cloudflare Pages + Astro + AstroPaper テーマで構築された個人ブログ

## サイト情報

- **URL**: https://chronicle.junichiro.co.uk/
- **リポジトリ**: https://github.com/junichiro/chronicle
- **ホスティング**: Cloudflare Pages
- **フレームワーク**: [Astro](https://astro.build/)
- **テーマ**: [AstroPaper](https://github.com/satnaing/astro-paper)
- **言語設定**: 日本語 (ja)
- **タイムゾーン**: Asia/Tokyo

## ディレクトリ構成

```
chronicle/
├── src/
│   ├── data/
│   │   └── blog/          # 記事を置くディレクトリ
│   │       └── slug.md
│   ├── pages/             # ページコンポーネント
│   ├── components/        # 再利用可能なコンポーネント
│   ├── layouts/           # レイアウトコンポーネント
│   ├── config.ts          # サイト設定
│   └── constants.ts       # ソーシャルリンク等の定数
├── public/                # 静的ファイル
├── astro.config.ts        # Astro設定
└── CLAUDE.md              # このファイル
```

## 記事の書き方

### ファイル命名規則

```
src/data/blog/slug.md
```

- `slug`: URL用の識別子（英数字とハイフン）
- 日付はファイル名ではなく、Front Matter の `pubDatetime` で指定

**重要**: 日付は必ず `date` コマンドで現在日時を確認してから使用すること。

### Front Matter（必須）

記事の先頭に YAML 形式でメタデータを記述：

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
description: 記事の説明文（SEO用）
---
```

### Front Matter（オプション）

```yaml
---
author: junichiro
pubDatetime: 2025-12-27T10:00:00+09:00
modDatetime: 2025-12-28T10:00:00+09:00  # 更新日時
title: 記事のタイトル
slug: article-slug
featured: true       # トップページの Featured に表示
draft: false         # true にすると公開されない
tags:
  - typescript
  - web
  - tutorial
description: 記事の説明文
ogImage: /assets/og-image.jpg  # OGP画像（省略可）
canonicalURL: https://example.com/original  # 正規URL（転載時）
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

![画像の説明](/assets/images/image.jpg)

コードブロック：

```python
def hello():
    print("Hello, World!")
```
```

### 太字（強調）の書き方

日本語テキスト内で太字（`**text**`）を使用する場合、 **前後に半角スペースを入れる** ：

```markdown
# NG: パーサーが認識しない場合がある
GTO理論における**最小ディフェンス頻度**の数学的基礎

# OK: 確実にレンダリングされる
GTO理論における **最小ディフェンス頻度** の数学的基礎
```

これは一部の Markdown パーサーが日本語文字と `**` が直接隣接している場合に正しく解析できないためです。

### 数式（MathJax）

数式を含む記事では MathJax を使用して美しく表示します。

**基本ルール** :
- **ブロック数式を優先** : できる限りインライン数式 (`$...$`) は避け、ブロック数式 (`$$...$$`) を使用
- **インラインは最小限** : 変数名や短い記号（$x$、$n$、$\pi$ など）のみインラインで使用
- 数式を含む内容は視認性を重視

```markdown
## ブロック数式（推奨）

オイラーの等式：

$$
e^{i\pi} + 1 = 0
$$

二次方程式の解の公式：

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

## インライン数式（変数や短い記号のみ）

変数 $n$ が十分大きいとき、$x$ の値は収束します。
```

**利用可能な記法**:
- 分数: `\frac{a}{b}`
- 根号: `\sqrt{x}`, `\sqrt[n]{x}`
- 上付き/下付き: `x^2`, `x_i`
- 総和/積分: `\sum_{i=1}^{n}`, `\int_{a}^{b}`
- ギリシャ文字: `\alpha`, `\beta`, `\pi` など
- 行列: `\begin{pmatrix} ... \end{pmatrix}`

### メディアの挿入（画像・動画・音声）

記事にメディアファイルを挿入する方法を説明します。

#### ディレクトリ構成

メディアファイルは `public/assets/` 以下に配置：

```
public/
└── assets/
    ├── images/        # 画像ファイル（jpg, png, gif, webp, svg）
    │   └── example.jpg
    ├── videos/        # 動画ファイル（mp4, webm）
    │   └── demo.mp4
    └── audio/         # 音声ファイル（mp3, wav, ogg）
        └── podcast.mp3
```

#### 画像

基本的な挿入：

```markdown
![画像の説明](/assets/images/example.jpg)
```

サイズ指定（HTML を使用）：

```html
<img src="/assets/images/example.jpg" alt="説明" width="600">
```

キャプション付き（figure タグ）：

```html
<figure>
  <img src="/assets/images/screenshot.png" alt="スクリーンショット">
  <figcaption>図1: アプリケーションのダッシュボード画面</figcaption>
</figure>
```

#### GIF アニメーション

通常の画像と同じ方法で挿入可能：

```markdown
![デモアニメーション](/assets/images/demo.gif)
```

#### 動画

**ローカル動画ファイル:**

```html
<video controls width="100%">
  <source src="/assets/videos/demo.mp4" type="video/mp4">
  お使いのブラウザは動画タグをサポートしていません。
</video>
```

オプション属性：
- `controls`: 再生コントロールを表示
- `autoplay`: 自動再生（`muted` と併用推奨）
- `loop`: ループ再生
- `muted`: ミュート状態で開始
- `poster="/assets/images/thumbnail.jpg"`: サムネイル画像

**YouTube 埋め込み:**

```html
<iframe
  width="560"
  height="315"
  src="https://www.youtube.com/embed/VIDEO_ID"
  title="動画タイトル"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen>
</iframe>
```

レスポンシブ対応（推奨）：

```html
<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
  <iframe
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
    src="https://www.youtube.com/embed/VIDEO_ID"
    title="動画タイトル"
    frameborder="0"
    allowfullscreen>
  </iframe>
</div>
```

**Vimeo 埋め込み:**

```html
<iframe
  src="https://player.vimeo.com/video/VIDEO_ID"
  width="640"
  height="360"
  frameborder="0"
  allowfullscreen>
</iframe>
```

#### 音声

```html
<audio controls>
  <source src="/assets/audio/podcast.mp3" type="audio/mpeg">
  お使いのブラウザは音声タグをサポートしていません。
</audio>
```

#### 注意事項

- **ファイルサイズ**: Git リポジトリには大きなファイル（目安: 10MB以上）を避ける
  - 大きな動画は YouTube/Vimeo にアップロードして埋め込み推奨
  - 必要なら Git LFS の利用を検討
- **画像最適化**: 可能なら WebP 形式を使用（ファイルサイズ削減）
- **アクセシビリティ**: 画像には必ず `alt` 属性で説明を記述
- **パス**: `public/` 配下のファイルは URL で `/` から始まるパスで参照

#### Claude Code へのメディアの渡し方

記事にメディアを挿入したい場合、以下の方法で Claude Code に伝えてください。

**ローカルファイルを使う場合:**

```
「~/Downloads/screenshot.png を記事に入れて」
「/tmp/demo.mp4 を動画として挿入して」
「デスクトップにある diagram.svg を使いたい」
```

→ Claude Code がファイルを `public/assets/` にコピーし、記事に挿入します。

**YouTube/Vimeo を埋め込む場合:**

```
「この動画を埋め込んで: https://www.youtube.com/watch?v=xxxxx」
「Vimeo の動画を入れたい: https://vimeo.com/123456789」
```

→ Claude Code が適切な埋め込みコードを生成します。

**外部画像 URL を使う場合:**

```
「この画像を使いたい: https://example.com/image.png」
```

→ Claude Code が画像をダウンロードして `public/assets/images/` に保存し、記事に挿入します。

**Claude Code にできないこと:**

- 画像の生成（DALL-E 等の画像生成 AI ではない）
- スクリーンショットの自動撮影（ユーザーが撮影して渡す必要あり）
- 動画の撮影・編集

## 記事の公開手順

```bash
# 1. 記事ファイルを作成
# 2. コミット & プッシュ
git add src/data/blog/new-article.md
git commit -m "Add: 記事タイトル"
git push

# 3. Cloudflare Pages が自動でビルド・デプロイ（1-2分）
```

## 下書きとプレビュー

### 方法1: ブランチプレビュー（推奨）

```bash
# 1. ドラフト用ブランチを作成
git checkout -b draft/my-new-post

# 2. src/data/blog/ に記事を作成
# 3. コミット & プッシュ
git add src/data/blog/my-new-post.md
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

### 方法2: draft: true

Front Matter で `draft: true` を設定すると、本番環境では公開されない：

```yaml
---
draft: true
---
```

## タグ

フラットな分類。複数指定可能：

```yaml
tags:
  - rust
  - web
  - backend
  - tutorial
```

## 設定ファイル

### src/config.ts の主要設定

```typescript
export const SITE = {
  website: "https://chronicle.junichiro.co.uk/",
  author: "junichiro",
  profile: "https://github.com/junichiro",
  desc: "技術と日常の記録",
  title: "Chronicle",
  ogImage: "og-image.jpg",
  lightAndDarkMode: true,
  postPerIndex: 5,
  postPerPage: 10,
  lang: "ja",
  timezone: "Asia/Tokyo",
} as const;
```

### src/constants.ts

ソーシャルリンクの設定：

```typescript
export const SOCIALS: Social[] = [
  {
    name: "GitHub",
    href: "https://github.com/junichiro",
    linkTitle: `${SITE.title} on GitHub`,
    icon: IconGitHub,
  },
] as const;
```

## Cloudflare Pages 設定

### ビルド設定

| 項目 | 値 |
|------|-----|
| Framework preset | Astro |
| Build command | `npm run build` |
| Build output directory | `dist` |

### 環境変数

必要に応じて設定：

| Variable | Value |
|----------|-------|
| `NODE_VERSION` | `20` |

## ローカルプレビュー

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# http://localhost:4321/ でプレビュー
```

ビルド確認：

```bash
npm run build
npm run preview
```

## Claude Code ワークフロー

このプロジェクトでは、Claude Code との壁打ちから記事を作成するワークフローが構築されています。

### コンセプト

```
┌─────────────────────────────────────────────────────┐
│  メイン会話（Claude Code セッション）               │
│                                                     │
│  あなた ←→ Claude                                   │
│  ・技術的な議論、アイデア出し                       │
│  ・問題の深掘り、解決策の検討                       │
│  ・学んだことの整理                                 │
│                                                     │
│  → 「これ記事にしたい」                             │
│                                                     │
└─────────────────────────────────────────────────────┘
         │
         ▼
    Sub-agents（記事作成専門チーム）が起動
         │
         ├── article-planner: 構成を提案
         ├── article-writer: 記事を執筆
         └── article-reviewer: 品質チェック
         │
         ▼
    Cloudflare Pages でプレビュー → 公開
```

**壁打ちの相手**: Claude（メインの会話で直接対話）
**壁打ちの場所**: この Claude Code セッション内

### 記事作成の流れ

```
壁打ち・議論 → 「記事にしたい」 → 構成確認 → 執筆 → プレビュー → 公開
```

### 利用可能なコマンド

| コマンド | 説明 |
|----------|------|
| `/draft` | 会話内容からドラフト記事を作成し、プレビューブランチにプッシュ |
| `/publish` | ドラフトをレビュー後、main にマージして公開 |

### Sub-agents

| エージェント | 役割 |
|-------------|------|
| `article-planner` | 議論を分析し、記事構成を提案 |
| `article-writer` | 構成に基づいて Markdown 記事を執筆 |
| `article-reviewer` | 記事をレビューし、改善提案を行う |
| `article-formatter` | 外部のMarkdown/テキストをブログ形式に変換 |

### トリガーワード

以下のような発言で自動的に記事作成ワークフローが開始：

- 「記事にしたい」「記事にまとめたい」
- 「ブログに書きたい」「ブログにしたい」
- 「これを公開したい」

### ディレクトリ構成（Claude Code 関連）

```
.claude/
├── agents/
│   ├── article-planner.md    # 構成提案エージェント
│   ├── article-writer.md     # 執筆エージェント
│   ├── article-reviewer.md   # レビューエージェント
│   └── article-formatter.md  # 外部コンテンツ変換エージェント
├── skills/
│   └── chronicle-article/
│       └── SKILL.md          # 記事作成スキル（自動トリガー）
└── commands/
    ├── draft.md              # /draft コマンド
    └── publish.md            # /publish コマンド
```

## 参考リンク

- [AstroPaper公式](https://github.com/satnaing/astro-paper)
- [Astro公式ドキュメント](https://docs.astro.build/)
- [Cloudflare Pages](https://pages.cloudflare.com/)
