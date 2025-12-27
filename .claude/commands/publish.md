# Chronicle 記事公開

ドラフトブランチの記事をレビューし、mainブランチにマージして公開します。

## 実行手順

1. **現在のブランチを確認**
   ```bash
   git branch --show-current
   git status
   ```

2. **ドラフトブランチにいることを確認**
   - `draft/` で始まるブランチであること
   - mainの場合は処理を中止

3. **article-reviewer サブエージェントでレビュー**
   - `_posts/` 内の記事ファイルを読み込み
   - 品質チェックを実施
   - 改善提案を提示

4. **レビュー結果をユーザーに報告**
   - 必須修正があれば対応
   - 公開可否を確認

5. **公開処理**
   ```bash
   # mainに切り替え
   git checkout main
   git pull origin main

   # ドラフトブランチをマージ
   git merge draft/SLUG

   # プッシュ
   git push origin main

   # ドラフトブランチを削除
   git branch -d draft/SLUG
   git push origin --delete draft/SLUG
   ```

6. **公開完了を報告**
   - 本番URL: `https://chronicle-969.pages.dev/posts/SLUG/`
   - デプロイ完了まで1-2分

## 引数

- `$ARGUMENTS`: なし（現在のドラフトブランチを公開）

## 前提条件

- `/draft` コマンドでドラフトが作成済み
- `draft/` ブランチにいること

## 出力

- 記事がmainにマージされる
- ドラフトブランチが削除される
- 本番URLが案内される
