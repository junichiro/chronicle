---
name: longrun
description: ラベル longrun の付いた GitHub issue を、人間の入力を待たずに片っ端から片づける長時間の自律処理。issue ごとに作業ブランチで実装・確認し、main 宛ての PR を作る。CI が通ると GitHub Actions がマージする。途中で見つけた課題は issue に起こしてキューに積み、それも片づける。「longrun を回して」「issue を片っ端から片づけて」「放っておくから issue を進めておいて」と頼まれたとき、または routine から起動されたときに使う。
---

# longrun

人間は見ていません。**質問しない・確認を待たない・選択肢を提示して止まらない**こと。判断に迷ったら、下の「迷ったとき」に従って自分で決めるか、その issue を締めて次へ進みます。

GitHub の操作はすべて `node .claude/longrun/bin/longrun.mjs <コマンド>`（以下 `longrun`）で行います。`gh issue` と `gh pr` はクラウドでは使えません。結果は JSON で返ります。

## 守ること

- リポジトリの `CLAUDE.md` の決まりに従う。確認コマンド・テストの書き方・コミットの書き方はそこに書いてある
- `main` と `main` には直接 push しない。force push もしない（hook が拒否する）
- 自分ではマージしない。main 宛ての `draft/` の PR は、CI がすべて成功すると GitHub Actions（longrun-automerge）がマージする。エージェントは `longrun wait` で決着を待つ
- 1 つの PR は 1 つの issue だけを扱う。issue の範囲の外にある課題は直さず、`longrun spawn` で issue に起こす
- 鍵やトークンを commit せず、ログにも出さない

## 手順

1. `longrun start` を実行する。`ok: false` なら理由をそのまま報告し、下の「終わるとき」に従って終わる
2. `longrun next` を実行する
   - `done: true` なら `longrun end --reason "<理由>"` を実行し、下の「終わるとき」に従って終わる
   - `issue` が返ったら、3 からその issue を片づける
3. 最新の main から作業ブランチを切る
   ```bash
   git fetch origin main
   git switch -c draft/issue-<番号> origin/main
   ```
4. issue を読んで実装する。新しい振る舞いにはテストを先に書く
5. 確認コマンドを、すべてローカルで実行して通す。`.claude/longrun/config.json` の `verify` にあればそれを、なければ `CLAUDE.md` にある CI と同じ確認コマンドを使う
6. サブエージェント `longrun-reviewer` に、issue の番号と本文を渡してレビューさせる。「直すべき」と言われた点は直し、5 からやり直す
7. commit して作業ブランチを push し、PR を作る
   ```bash
   git push -u origin draft/issue-<番号>
   longrun pr --branch draft/issue-<番号> --title "<タイトル>" --body-file <本文のファイル>
   ```
   PR の本文には、何を・なぜ変えたか、どう確かめたか、置いた仮定を書く
8. `longrun wait --pr <PR 番号>` を実行し、マージされるのを待つ（最大 9 分で返る）
   - `merged: true` なら 9 へ
   - `awaitingHuman: true` なら 9 の「マージできた」と同じく `--ok` で締める。`config.json` の `components.automerge` が `false` のときに、CI がすべて通ると返る。マージは人間が行い、マージされると PR の `Closes` で issue が閉じる。それまで issue にはラベル `longrun:awaiting-merge` が付き、次の run では選ばれない
   - `pending: true` なら、もう一度 `longrun wait` を実行する。CI の実行と自動マージには合わせて 10〜20 分かかることがある
   - CI が失敗したら、原因を直して push し、もう一度 `longrun wait` を実行する。同じ issue で 3 回直しても通らなければ 9 の `--failed` に進む
   - 自動マージに失敗した（main との衝突など）と返ったら、`git fetch origin main && git rebase origin/main` で直して、`git push --force-with-lease` し、もう一度 `longrun wait` を実行する
9. issue を締める
   - マージできた（または `awaitingHuman: true`）: `longrun finish --ok --note "<何をしたかを 1〜3 行で>"`
   - 片づけられなかった: `longrun finish --failed --note "<何を試し、何が問題だったか>"`
   - 人間の判断が要る: `longrun finish --needs-human --note "<決めてほしいことと選択肢>"`
10. 2 に戻る

途中で issue の範囲外の課題を見つけたら、いつでも `longrun spawn --title "<タイトル>" --body-file <本文のファイル>` で起票します。本文には、見つけた場所・何が問題か・どう直すとよさそうかを書きます。作成数と深さの上限は `longrun` が守ります。上限に達した課題は、issue にならず記録用 issue に残ります。

Stop hook が「まだ続けて」と返したら、その指示に従って続けます。

## 終わるとき

どの終わり方でも（`start` が `ok: false`、`next` が `done: true`、続けられないエラー）、最後の返答は次の形にします。人間はこの返答を見て、セッションをアーカイブしてよいかを決めます。

1. 片づけた issue と PR、人間の判断待ちにした issue、終わった理由を短く書く
2. 返答のいちばん最後の行に、次の文を一字も変えずに出す

   ```
   ✅ longrun の run が終わりました。結果は GitHub に残っているので、このセッションはアーカイブして大丈夫です。
   ```

続けられないエラーで終わるときも、先に `longrun end --reason "<理由>"` でロックを外してから出します（`start` が `ok: false` のときは、ロックを書いていないので要りません）。

## 迷ったとき

| 状況 | どうするか |
|---|---|
| 仕様の解釈が複数ある | 変更が小さく、あとから戻しやすいほうを選び、仮定を PR に書く |
| プロダクトの方針・見た目の好み・料金・外部サービスの契約など、人間が決めるべきこと | 実装せずに `--needs-human` で締める。決めてほしいことと選択肢を書く |
| 秘密情報・本番環境・データの削除が要る | 実装せずに `--needs-human` で締める |
| issue が大きすぎる | 最初の一歩だけを片づけ、残りは `spawn` で分けて起票する |
| テストが手元の環境のせいで動かない | 試したことを書いて `--failed` で締める |

## 記録

結果は、その日の記録用 issue（ラベル `longrun:journal`）にコメントで残ります。人間はそれを読み、main を main にマージするかどうかを決めます。
