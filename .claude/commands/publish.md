---
description: ドラフト記事をレビュー後、mainブランチにマージして公開する
---

# /publish コマンド

このコマンドは、ドラフト記事をレビューし、問題がなければ main ブランチにマージして公開します。

## 実行手順

### 1. 現在のブランチ確認

```bash
git branch --show-current
```

draft/ ブランチにいることを確認。main ブランチにいる場合は、公開対象のドラフトブランチを確認してください。

### 2. 記事のレビュー

`article-reviewer` サブエージェントを使用して、記事の品質チェックを行ってください。

チェック項目：
- Front matter の正確性
- Markdown 構文の有効性
- コード例の正確性
- 日本語の品質
- 構成と流れ

### 3. レビュー結果の報告

レビュー結果をユーザーに報告：

- **公開可能**: 問題がなければ次のステップへ
- **要修正**: 問題点と修正案を提示し、修正後に再レビュー

### 4. main へのマージ

ユーザーの公開承認を得てから実行：

```bash
# main に切り替え
git checkout main

# 最新を取得
git pull origin main

# ドラフトブランチをマージ
git merge draft/<slug>

# プッシュ
git push origin main
```

### 5. クリーンアップ

```bash
# ローカルのドラフトブランチを削除
git branch -d draft/<slug>

# リモートのドラフトブランチを削除
git push origin --delete draft/<slug>
```

### 6. 公開完了の案内

```
記事を公開しました！

公開URL: https://chronicle-969.pages.dev/posts/<slug>/

Cloudflare Pages のデプロイが完了するまで 1-2 分かかる場合があります。
```
