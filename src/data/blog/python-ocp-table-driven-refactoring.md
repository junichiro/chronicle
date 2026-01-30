---
author: junichiro
pubDatetime: 2026-01-30T17:15:23+09:00
title: "if/elif・switch/case・when の連鎖は「拡張に閉じていない」— Python の MIME タイプ判定で学ぶ Open/Closed Principle"
slug: python-ocp-table-driven-refactoring
featured: true
draft: false
tags:
  - python
  - design-pattern
  - refactoring
  - testing
  - typescript
  - kotlin
  - ruby
description: "if/elif・switch/case・when による条件分岐が OCP 違反になる理由を、Python の MIME タイプ判定を題材にテーブル駆動方式で解決する方法を解説"
---

## はじめに

「新しい画像フォーマットに対応してほしい」

こう言われたとき、あなたのコードは **辞書にエントリを1行足すだけ** で済みますか？ それとも、 **関数本体の if/elif を書き換えて、既存テストが壊れないか祈る** ことになりますか？

この記事では、Python の MIME タイプ判定処理を題材に、 **Open/Closed Principle（開放閉鎖原則、以下 OCP）** の考え方と、テストがどう変わるかまで含めて初学者向けに解説します。

### この記事で学べること

- OCP の本質と、if/elif チェーンがなぜ問題になるのか
- **同じ問題が switch/case や Kotlin の when にも存在する** こと
- 辞書（dict）を使ったリファクタリングの具体例
- リファクタリング前後で **テストの壊れやすさがどう変わるか**

### 対象読者

- OCP を聞いたことはあるが、実際のコードでどう適用するかわからない方
- 「if/elif が多いコードは良くない」と聞くが、なぜなのか腑に落ちていない方
- Python でテストしやすいコードの書き方を学びたい方
- Python 以外の言語（JavaScript, TypeScript, Kotlin, Ruby, Java など）を使っている方

---

## 1. リファクタリング前のコード

URL やレスポンスの Content-Type から MIME タイプを判定する処理です。画像・動画を扱うサービスではよくあるパターンです。

```python
def detect_mime_type(content_type: str, url: str) -> str:
    lower_url = url.lower()

    if "video" in content_type or any(
        ext in lower_url for ext in (".mp4", ".mov", ".webm")
    ):
        mime_type = "video/mp4"
    elif "png" in content_type or lower_url.endswith(".png"):
        mime_type = "image/png"
    elif "gif" in content_type or lower_url.endswith(".gif"):
        mime_type = "image/gif"
    elif "webp" in content_type or lower_url.endswith(".webp"):
        mime_type = "image/webp"
    else:
        mime_type = "image/jpeg"

    return mime_type
```

### 何が問題なのか？

一見シンプルに見えますが、このコードには **OCP 違反** の典型的な構造があります。

#### 問題 1: 新しいフォーマット追加のたびに関数本体を修正する

例えば `.avif` に対応するとしましょう。やることは「elif を1つ追加する」です。

```python
    # 既存の elif の間のどこかに追加する
    elif "avif" in content_type or lower_url.endswith(".avif"):
        mime_type = "image/avif"
```

これは **関数の内部ロジックを直接変更している** ということです。OCP では「拡張に対して開いていて、修正に対して閉じている」ことが求められますが、このコードは拡張するたびに修正が必要です。

#### 問題 2: elif の挿入位置が既存の動作に影響する

if/elif は **上から順に評価される** ため、分岐の追加位置によっては既存の動作が変わる可能性があります。

例えば、将来 content_type に `"avif"` と `"webp"` の両方のキーワードが含まれるようなエッジケースがあった場合、`avif` の elif を `webp` の前に置くか後に置くかで結果が変わります。

#### 問題 3: 判定ルールの形がバラバラ

`video` だけ `any()` で複数拡張子をチェックしていますが、他は `endswith()` で1つずつチェックしています。分岐が増えるほど、こうした **ルールの不一致** が見えにくくなります。

---

## 2. リファクタリング後のコード

判定ロジックとデータを分離します。

```python
from typing import Optional

EXTENSION_TO_MIME: dict[str, str] = {
    ".mp4": "video/mp4",
    ".mov": "video/mp4",
    ".webm": "video/mp4",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

CONTENT_TYPE_TO_MIME: dict[str, str] = {
    "video": "video/mp4",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
}


def detect_mime_type(content_type: str, url: str) -> Optional[str]:
    lower_url = url.lower()

    for ext, mime in EXTENSION_TO_MIME.items():
        if lower_url.endswith(ext):
            return mime

    content_type_lower = content_type.lower()
    for keyword, mime in CONTENT_TYPE_TO_MIME.items():
        if keyword in content_type_lower:
            return mime

    return None
```

### 何が変わったのか？

| 観点 | Before | After |
|------|--------|-------|
| 新フォーマット追加 | elif を関数内に追記 | 辞書にエントリを追加 |
| ロジックの修正 | 必要 | 不要 |
| ルールの一貫性 | バラバラ（any, endswith が混在） | 統一（拡張子は endswith、content_type は in） |
| video の特別扱い | elif 内に `any()` で特殊処理 | `.mp4`, `.mov`, `.webm` を個別エントリとして表現 |

特に `video` の扱いが改善されています。元のコードでは video だけ `any()` で複数拡張子をチェックするという **例外的な判定方法** でしたが、リファクタリング後は他の拡張子と同じ形式（辞書のエントリ）で表現されています。

---

## 3. テストで見る OCP の効果

リファクタリングの価値は、コードの見た目だけではなく、 **テストの壊れやすさ** に表れます。

### Before: if/elif チェーンのテスト

```python
class TestDetectMimeType:
    def test_mp4の動画を検出できる(self):
        result = detect_mime_type("", "https://example.com/video.mp4")
        assert result == "video/mp4"

    def test_movの動画を検出できる(self):
        result = detect_mime_type("", "https://example.com/video.mov")
        assert result == "video/mp4"

    def test_content_typeがvideoの場合に動画を検出できる(self):
        result = detect_mime_type("video/quicktime", "https://example.com/file")
        assert result == "video/mp4"

    def test_pngを検出できる(self):
        result = detect_mime_type("", "https://example.com/image.png")
        assert result == "image/png"

    def test_gifを検出できる(self):
        result = detect_mime_type("", "https://example.com/image.gif")
        assert result == "image/gif"

    def test_webpを検出できる(self):
        result = detect_mime_type("", "https://example.com/image.webp")
        assert result == "image/webp"

    def test_不明な形式の場合はjpegを返す(self):
        result = detect_mime_type("application/octet-stream", "https://example.com/file")
        assert result == "image/jpeg"
```

各 elif 分岐に1つずつテストが対応しています。テストが **ロジックの分岐構造と1対1で結合している** 状態です。

#### `.avif` 対応時に起きること

1. `detect_mime_type` 関数に elif を追加する
2. テストを追加する

```python
    def test_avifを検出できる(self):
        result = detect_mime_type("", "https://example.com/image.avif")
        assert result == "image/avif"
```

3. **既存テストが壊れないことを確認する** — elif の挿入位置次第で既存の分岐の到達可能性が変わるため、全テストの再確認が必要

つまり、 **新しい MIME タイプを追加するたびに、既存テストとの相互作用を考慮する必要がある** ということです。

### After: 辞書ベースのテスト

テストを **「ロジックのテスト」** と **「データのテスト」** に分離します。

```python
class TestDetectMimeType:
    """判定ロジックのテスト"""

    def test_拡張子からMIMEタイプを検出できる(self):
        result = detect_mime_type("", "https://example.com/image.png")
        assert result == "image/png"

    def test_content_typeからMIMEタイプを検出できる(self):
        result = detect_mime_type("image/png", "https://example.com/file")
        assert result == "image/png"

    def test_拡張子がcontent_typeより優先される(self):
        result = detect_mime_type("image/gif", "https://example.com/image.png")
        assert result == "image/png"

    def test_大文字のURLでも検出できる(self):
        result = detect_mime_type("", "https://example.com/IMAGE.PNG")
        assert result == "image/png"

    def test_大文字のcontent_typeでも検出できる(self):
        result = detect_mime_type("IMAGE/PNG", "https://example.com/file")
        assert result == "image/png"

    def test_該当なしの場合はNoneを返す(self):
        result = detect_mime_type("application/octet-stream", "https://example.com/file")
        assert result is None


class TestMimeTypeMappings:
    """辞書の網羅性テスト（データのテスト）"""

    @pytest.mark.parametrize("ext,expected", [
        (".mp4", "video/mp4"),
        (".mov", "video/mp4"),
        (".webm", "video/mp4"),
        (".png", "image/png"),
        (".gif", "image/gif"),
        (".webp", "image/webp"),
    ])
    def test_拡張子マッピングが正しい(self, ext, expected):
        assert EXTENSION_TO_MIME[ext] == expected

    @pytest.mark.parametrize("keyword,expected", [
        ("video", "video/mp4"),
        ("png", "image/png"),
        ("gif", "image/gif"),
        ("webp", "image/webp"),
    ])
    def test_content_typeマッピングが正しい(self, keyword, expected):
        assert CONTENT_TYPE_TO_MIME[keyword] == expected
```

#### `.avif` 対応時に起きること

1. 辞書にエントリを追加する

```python
EXTENSION_TO_MIME: dict[str, str] = {
    # ... 既存エントリ ...
    ".avif": "image/avif",  # 追加
}

CONTENT_TYPE_TO_MIME: dict[str, str] = {
    # ... 既存エントリ ...
    "avif": "image/avif",  # 追加
}
```

2. `parametrize` にエントリを追加する

```python
    @pytest.mark.parametrize("ext,expected", [
        # ... 既存エントリ ...
        (".avif", "image/avif"),  # 追加
    ])
```

3. **`TestDetectMimeType` のテストは一切触らない** — `detect_mime_type` 関数本体が変更されていないため

**ロジックのテストが不変である** 。これが OCP の実用的な効果です。

### テスト構造の比較

| 観点 | Before (if/elif) | After (辞書) |
|------|------------------|-------------|
| テスト対象 | 各分岐を個別にテスト | **ロジック** と **データ** を分離してテスト |
| テストの関心事 | 「png を渡したら png が返る」 | 「拡張子で判定できる」「辞書に正しい値がある」 |
| テスト数 | MIME タイプの数に比例して増加 | ロジックのテストは固定、データは parametrize |
| 追加時の影響 | 既存テストとの相互作用を確認 | ロジックテストは不変 |

---

## 4. これは Python だけの話ではない — switch/case・when も同じ

ここまで Python の if/elif で説明してきましたが、この問題は **言語を問わず、条件分岐でカテゴリをディスパッチしている箇所すべて** に当てはまります。構文が違うだけで、構造は同じです。

### JavaScript / TypeScript の switch

```typescript
function detectMimeType(contentType: string, url: string): string {
  const lowerUrl = url.toLowerCase();

  switch (true) {
    case contentType.includes("video") || lowerUrl.endsWith(".mp4"):
      return "video/mp4";
    case contentType.includes("png") || lowerUrl.endsWith(".png"):
      return "image/png";
    case contentType.includes("gif") || lowerUrl.endsWith(".gif"):
      return "image/gif";
    case contentType.includes("webp") || lowerUrl.endsWith(".webp"):
      return "image/webp";
    default:
      return "image/jpeg";
  }
}
```

`switch` にしたところで、`.avif` を追加するときに `case` を挿入する必要がある点は if/elif と同じです。

リファクタリングも同様に、`Record` （辞書相当）への分離で解決します。

```typescript
const EXTENSION_TO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/mp4",
  ".webm": "video/mp4",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const CONTENT_TYPE_TO_MIME: Record<string, string> = {
  video: "video/mp4",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

function detectMimeType(contentType: string, url: string): string | null {
  const lowerUrl = url.toLowerCase();

  for (const [ext, mime] of Object.entries(EXTENSION_TO_MIME)) {
    if (lowerUrl.endsWith(ext)) return mime;
  }

  const lowerContentType = contentType.toLowerCase();
  for (const [keyword, mime] of Object.entries(CONTENT_TYPE_TO_MIME)) {
    if (lowerContentType.includes(keyword)) return mime;
  }

  return null;
}
```

### Kotlin の when

Kotlin の `when` は switch をより表現力豊かにした構文ですが、OCP の観点では同じ問題を持ちます。

```kotlin
fun detectMimeType(contentType: String, url: String): String {
    val lowerUrl = url.lowercase()

    return when {
        "video" in contentType || lowerUrl.endsWith(".mp4") -> "video/mp4"
        "png" in contentType || lowerUrl.endsWith(".png") -> "image/png"
        "gif" in contentType || lowerUrl.endsWith(".gif") -> "image/gif"
        "webp" in contentType || lowerUrl.endsWith(".webp") -> "image/webp"
        else -> "image/jpeg"
    }
}
```

`when` は `if/elif` より読みやすい構文ですが、 **新しい分岐を追加するときに関数本体を修正する必要がある** という構造的な問題は変わりません。

```kotlin
val EXTENSION_TO_MIME = mapOf(
    ".mp4" to "video/mp4",
    ".mov" to "video/mp4",
    ".webm" to "video/mp4",
    ".png" to "image/png",
    ".gif" to "image/gif",
    ".webp" to "image/webp",
)

val CONTENT_TYPE_TO_MIME = mapOf(
    "video" to "video/mp4",
    "png" to "image/png",
    "gif" to "image/gif",
    "webp" to "image/webp",
)

fun detectMimeType(contentType: String, url: String): String? {
    val lowerUrl = url.lowercase()

    EXTENSION_TO_MIME.forEach { (ext, mime) ->
        if (lowerUrl.endsWith(ext)) return mime
    }

    val lowerContentType = contentType.lowercase()
    CONTENT_TYPE_TO_MIME.forEach { (keyword, mime) ->
        if (keyword in lowerContentType) return mime
    }

    return null
}
```

### Ruby の case/when

```ruby
def detect_mime_type(content_type, url)
  lower_url = url.downcase

  case
  when content_type.include?("video") || lower_url.end_with?(".mp4")
    "video/mp4"
  when content_type.include?("png") || lower_url.end_with?(".png")
    "image/png"
  when content_type.include?("gif") || lower_url.end_with?(".gif")
    "image/gif"
  when content_type.include?("webp") || lower_url.end_with?(".webp")
    "image/webp"
  else
    "image/jpeg"
  end
end
```

Ruby も同様にハッシュで解決できます。

```ruby
EXTENSION_TO_MIME = {
  ".mp4" => "video/mp4",
  ".mov" => "video/mp4",
  ".webm" => "video/mp4",
  ".png" => "image/png",
  ".gif" => "image/gif",
  ".webp" => "image/webp",
}.freeze

CONTENT_TYPE_TO_MIME = {
  "video" => "video/mp4",
  "png" => "image/png",
  "gif" => "image/gif",
  "webp" => "image/webp",
}.freeze

def detect_mime_type(content_type, url)
  lower_url = url.downcase

  EXTENSION_TO_MIME.each do |ext, mime|
    return mime if lower_url.end_with?(ext)
  end

  lower_content_type = content_type.downcase
  CONTENT_TYPE_TO_MIME.each do |keyword, mime|
    return mime if lower_content_type.include?(keyword)
  end

  nil
end
```

### 共通する構造

言語が違っても、OCP 違反の予兆は同じパターンです。

| 構文 | 言語 | OCP 違反の予兆 |
|------|------|---------------|
| `if/elif/else` | Python | elif を追加して関数を修正 |
| `switch/case` | JavaScript, TypeScript, Java, C, Go | case を追加して関数を修正 |
| `when` | Kotlin | 分岐を追加して関数を修正 |
| `case/when` | Ruby | when を追加してメソッドを修正 |
| `match/case` | Python 3.10+, Rust, Scala | case を追加して関数を修正 |

**構文は違えど、「カテゴリによるディスパッチを分岐で書いている」という構造が同じ** である限り、解決策も同じです。データ（辞書・Map・HashMap・Record）にマッピングを切り出し、ロジックをデータの走査に統一する。これはどの言語でも適用できるリファクタリングです。

---

## 5. すべての if/elif が OCP 違反なのか？

ここまで読んで「じゃあ if/elif は全部ダメなのか」と思うかもしれませんが、そうではありません。

### OCP 違反になるケース

分岐の条件が **型やカテゴリによるディスパッチ** で、 **新しい種類が追加される可能性がある** 場合です。

```python
# 新しいファイル形式が増えるたびにこの関数を修正する必要がある
def parse(file_path: str) -> Data:
    if file_path.endswith(".csv"):
        return parse_csv(file_path)
    elif file_path.endswith(".json"):
        return parse_json(file_path)
    elif file_path.endswith(".xml"):
        return parse_xml(file_path)
    else:
        raise ValueError("Unsupported format")
```

### OCP 違反にならないケース

#### ビジネスルールのバリデーション

```python
def validate_order(order: Order) -> list[str]:
    errors = []
    if order.quantity <= 0:
        errors.append("数量は1以上にしてください")
    elif order.quantity > MAX_QUANTITY:
        errors.append("数量が上限を超えています")
    return errors
```

これは「新しい種類の注文」が追加される話ではなく、固定的な条件チェックです。

#### 値の範囲分類

```python
def classify_age(age: int) -> str:
    if age < 13:
        return "child"
    elif age < 20:
        return "teenager"
    else:
        return "adult"
```

年齢区分が頻繁に変わることはないので、これを Strategy パターンにするのは過剰設計です。

### 判断基準

自分のコードの if/elif が OCP 違反かどうかを判断するには、次の問いを立ててみてください。

> **「この if/elif に新しい分岐を追加する日が来るか？」**

| 答え | 判断 | 対応 |
|------|------|------|
| Yes, 来る可能性が高い | OCP 違反の兆候 | データとロジックの分離を検討 |
| No, これで安定している | 問題なし | 素直な if/elif のままが読みやすい |

---

## 6. テーブル駆動方式の出典

今回のリファクタリングで使った「条件分岐をデータ構造（テーブル）への参照に置き換える」手法は、 **Table-Driven Methods（テーブル駆動方式）** と呼ばれています。

この手法は Steve McConnell の名著 [*Code Complete* 第2版（Microsoft Press, 2004）](https://www.amazon.com/Code-Complete-Practical-Handbook-Construction/dp/0735619670) の **第18章「Table-Driven Methods」** で詳しく解説されています。

> A table-driven method is a scheme that allows you to look up information in a table rather than using logic statements (if and case) to figure it out.
>
> — Steve McConnell, *Code Complete* 2nd Edition, Chapter 18

McConnell はこの章で、テーブル駆動方式を以下の3つのアクセスパターンに分類しています：

- **Direct Access Table** — データをキーとして直接テーブルを引く（今回の辞書アクセスはこれに該当）
- **Indexed Access Table** — インデックス配列を経由してテーブルを引く
- **Stair-Step Access Table** — 範囲に対してテーブルを引く

今回の MIME タイプ判定は最もシンプルな Direct Access Table のパターンです。条件分岐をデータに置き換えるという発想は OCP が提唱されるよりも前から存在する、ソフトウェア構築の基本技法の一つです。

O'Reilly の書籍ページでも章の概要が確認できます：[Chapter 18. Table-Driven Methods - Code Complete, 2nd Edition](https://www.oreilly.com/library/view/code-complete-2nd/0735619670/ch18.html)

---

## 7. 次のステップ: 値ではなく振る舞いを返す — Factory Pattern

今回のリファクタリングでは、辞書が返すのは `"image/png"` のような **単純な文字列** でした。しかし、実際の開発では「カテゴリに応じて **異なる処理** を実行したい」ケースがあります。

例えば、MIME タイプの判定だけでなく、フォーマットごとに異なるサムネイル生成やメタデータ抽出が必要になった場合を考えてみましょう。

### テーブル駆動では対応しきれないケース

```python
# フォーマットごとに処理が違う
def process_media(mime_type: str, data: bytes) -> dict:
    if mime_type == "video/mp4":
        # 動画からフレームを抽出してサムネイル生成
        thumbnail = extract_video_frame(data)
        metadata = parse_video_metadata(data)
        return {"thumbnail": thumbnail, "metadata": metadata}
    elif mime_type == "image/png":
        # PNG のリサイズでサムネイル生成
        thumbnail = resize_image(data)
        metadata = parse_png_metadata(data)
        return {"thumbnail": thumbnail, "metadata": metadata}
    elif mime_type == "image/gif":
        # GIF は最初のフレームをサムネイルに
        thumbnail = extract_first_frame(data)
        metadata = parse_gif_metadata(data)
        return {"thumbnail": thumbnail, "metadata": metadata}
```

これはテーブル駆動で解決できません。返すべきものが文字列ではなく **振る舞い** だからです。

### Factory Pattern による解決

こういうケースでは、辞書が返すものを **文字列からオブジェクト（クラス）** にスケールアップします。これが **Factory Pattern** です。

```python
from typing import Protocol

class MediaHandler(Protocol):
    """メディア処理のインターフェース"""
    def extract_metadata(self, data: bytes) -> dict: ...
    def generate_thumbnail(self, data: bytes) -> bytes: ...


class VideoHandler:
    def extract_metadata(self, data: bytes) -> dict:
        return parse_video_metadata(data)

    def generate_thumbnail(self, data: bytes) -> bytes:
        return extract_video_frame(data)


class PngHandler:
    def extract_metadata(self, data: bytes) -> dict:
        return parse_png_metadata(data)

    def generate_thumbnail(self, data: bytes) -> bytes:
        return resize_image(data)


class GifHandler:
    def extract_metadata(self, data: bytes) -> dict:
        return parse_gif_metadata(data)

    def generate_thumbnail(self, data: bytes) -> bytes:
        return extract_first_frame(data)


# テーブル駆動と同じ構造。ただし値が文字列ではなくクラス
HANDLER_MAP: dict[str, type[MediaHandler]] = {
    "video/mp4": VideoHandler,
    "image/png": PngHandler,
    "image/gif": GifHandler,
}


def create_handler(mime_type: str) -> MediaHandler:
    handler_class = HANDLER_MAP.get(mime_type)
    if handler_class is None:
        raise ValueError(f"Unsupported: {mime_type}")
    return handler_class()
```

新しいフォーマット（`.avif`）に対応するときは：

1. `AvifHandler` クラスを **新規作成** する
2. `HANDLER_MAP` にエントリを追加する

`create_handler` 関数も、既存の Handler クラスも修正不要です。 **OCP を完全に満たしています** 。

### テーブル駆動と Factory Pattern の関係

実は、テーブル駆動と Factory Pattern は対立する概念ではなく、 **同じ考え方のスケール違い** です。

| 返すものの複雑さ | 手法 | 辞書の値 |
|-----------------|------|---------|
| 単純な値（文字列、数値） | テーブル駆動 | `"image/png"` |
| 振る舞いを持つオブジェクト | Factory Pattern | `PngHandler` |

どちらも **「条件分岐をデータ構造への参照に置き換える」** という同じ原理に基づいています。今回の記事で紹介したテーブル駆動方式を理解していれば、Factory Pattern への移行は「辞書の値を文字列からクラスに変える」だけです。

まずはテーブル駆動で if/elif を整理する習慣をつけ、処理が複雑になってきたら Factory Pattern にスケールアップする。この段階的なアプローチが、過剰設計に陥らずに OCP を実践するコツです。

---

## 8. まとめ

### リファクタリングのポイント

1. **if/elif のデータ部分を辞書に抽出する** — 判定ロジック（どうやって調べるか）と判定データ（何を調べるか）を分離する
2. **ルールの形を統一する** — video だけ `any()` で特殊処理していたのを、拡張子ごとの辞書エントリに統一する
3. **テストもロジックとデータに分離する** — ロジックのテストは変更に強く、データのテストは parametrize で網羅的に
4. **振る舞いが必要になったら Factory Pattern へ** — 辞書の値を文字列からクラスにスケールアップする

### OCP の本質

OCP は「コードを一切触るな」という原則ではありません。本質は **「既存のテスト済みロジックを壊さずに拡張できる構造にする」** ことです。

今回の例では、辞書にエントリを追加するだけなら、`detect_mime_type` 関数本体の判定ロジックは一切変更されません。したがって、ロジックを検証するテストも壊れません。これが「修正に対して閉じている」の実用的な意味です。

逆に、if/elif で固定的な条件をチェックしているだけなら、無理に辞書やパターンに置き換える必要はありません。 **変更の方向性が見えているときに初めて OCP は効力を発揮する** 設計指針であることを忘れないでください。

---

## 参考文献

- Steve McConnell, [*Code Complete: A Practical Handbook of Software Construction, 2nd Edition*](https://www.amazon.com/Code-Complete-Practical-Handbook-Construction/dp/0735619670), Microsoft Press, 2004 — Chapter 18「Table-Driven Methods」
- Robert C. Martin, *Agile Software Development, Principles, Patterns, and Practices*, Pearson, 2002 — Chapter 9「OCP: The Open-Closed Principle」
