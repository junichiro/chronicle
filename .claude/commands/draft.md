# Chronicle ドラフト記事作成

これまでの会話内容をブログ記事としてドラフト化します。

## 実行手順

1. **現在日時を確認**
   ```bash
   date "+%Y-%m-%d %H:%M:%S"
   ```

2. **article-planner サブエージェントで構成を提案**
   - 会話内容を分析
   - 記事構成を設計
   - タイトル候補を3つ提示
   - カテゴリ・タグを提案

3. **ユーザーに確認**
   - タイトルを選択してもらう
   - 構成について調整があれば反映

4. **article-writer サブエージェントで執筆**
   - Markdown形式で記事を作成
   - `_posts/YYYY-MM-DD-slug.md` に保存

5. **ドラフトブランチを作成してプッシュ**
   ```bash
   git checkout -b draft/SLUG
   git add _posts/YYYY-MM-DD-slug.md
   git commit -m "Draft: 記事タイトル"
   git push -u origin draft/SLUG
   ```

6. **プレビューURLを案内**
   - Cloudflare Pagesが自動でビルド
   - `https://draft-SLUG.chronicle-969.pages.dev/` でプレビュー可能

## 引数

- `$ARGUMENTS`: オプションでタイトルやトピックを指定可能

## 出力

- ドラフト記事ファイル（`_posts/` 内）
- プレビューURL
- 次のステップ（`/publish` で公開）
