---
author: junichiro
pubDatetime: 2026-01-14T21:53:37+09:00
title: URL バリデーションロジックのリファクタリング - セキュリティと保守性の向上
slug: url-validation-refactoring-security-maintainability
featured: false
draft: false
tags:
  - kotlin
  - security
  - refactoring
  - tdd
  - clean-code
description: EmailService に埋め込まれていた URL バリデーションを独立クラスに抽出し、SSRF/XSS 対策を強化したリファクタリング事例。TDD による 23 のテストケースで品質を保証。
---

## 概要

本記事では、`EmailService` クラスに埋め込まれていた URL バリデーションロジックを、独立したクラス `ProposalDocumentUrlValidator` に抽出するリファクタリングについて解説します。このリファクタリングにより、単一責任の原則（SRP）に沿った設計となり、テスト容易性とセキュリティの両方が向上しました。

## リファクタリング前の問題点

### 元のコード構造

```kotlin
class EmailService(
    private val resendApiClient: ResendApiClient,
    // ... 他の依存関係
) {
    // メール送信に加えて、URL バリデーションも担当していた
    private fun validateProposalDocumentUrl(url: String) {
        // 77行のバリデーションロジック
        require(url.isNotBlank()) { "..." }
        require(url.length <= 2048) { "..." }
        // HTTPS チェック、SSRF 対策、信頼ドメインチェック...
    }

    fun sendProposalEmail(request: ProposalEmailRequest) {
        validateProposalDocumentUrl(request.proposalDocumentUrl)
        // メール送信処理
    }
}
```

### 問題点

1. **単一責任の原則（SRP）違反**: EmailService がメール送信と URL バリデーションの2つの責務を持っていた
2. **テストの困難さ**: URL バリデーションのみをテストするためにも EmailService 全体のモックが必要だった
3. **再利用性の欠如**: 他のサービスで同じバリデーションが必要な場合、コードの重複が発生する
4. **セキュリティロジックの分散**: セキュリティ関連のコードがビジネスロジックと混在し、レビューが困難だった

## リファクタリング後の設計

### インターフェースの定義

まず、URL バリデーションの抽象化としてインターフェースを定義しました。

```kotlin
interface UrlValidator {
    /**
     * URL を検証する
     *
     * @param url 検証対象の URL
     * @throws IllegalArgumentException URL が不正な場合
     */
    fun validate(url: String)
}
```

このインターフェースにより:
- 依存性の逆転（DIP）を実現
- テスト時にモック実装への差し替えが容易に
- 将来的な実装の追加・変更に柔軟に対応可能

### 実装クラス

```kotlin
@Component
class ProposalDocumentUrlValidator : UrlValidator {

    companion object {
        private const val MAX_URL_LENGTH = 2048

        private val TRUSTED_DOMAINS = listOf(
            ".cloudfront.net",
            ".s3.ap-northeast-1.amazonaws.com",
            ".s3.amazonaws.com",
            "ad-one.web-marketing.qa1-raksul.me",
            "ad-one.raksul.com"
        )

        private val FORBIDDEN_HOSTS = listOf(
            "localhost",
            "127.",      // 127.0.0.0/8 全体をブロック
            "0.0.0.0",
            "[::1]",
            "fe80:",     // IPv6 link-local
            "fc00:", "fd00:",  // IPv6 private (ULA)
            "169.254.",  // IPv4 Link-local
            "10.",       // IPv4 Private (Class A)
            "172.16.", "172.17.", /* ... */ "172.31.",
            "192.168."   // IPv4 Private (Class C)
        )

        private val DANGEROUS_SCHEMES = listOf(
            "javascript:" to "JavaScript",
            "data:" to "Data",
            "vbscript:" to "VBScript",
            "file:" to "File"
        )
    }

    override fun validate(url: String) {
        validateNotBlank(url)
        validateLength(url)
        validateNoXssSchemes(url)
        validateHttpsScheme(url)
        validateUrlFormat(url)

        val host = extractHost(url)
        validateNotInternalHost(host)
        validateTrustedDomain(host)
    }
    // ... private メソッド群
}
```

### EmailService の変更

```kotlin
class EmailService(
    private val resendApiClient: ResendApiClient,
    private val urlValidator: UrlValidator,  // DI で注入
    // ...
) {
    fun sendProposalEmail(request: ProposalEmailRequest) {
        // URL バリデーションを委譲
        urlValidator.validate(request.proposalDocumentUrl)
        // メール送信処理
    }
}
```

## セキュリティ対策の詳細

### 1. SSRF（Server-Side Request Forgery）防止

**SSRF 攻撃とは**: 攻撃者が悪意のある URL を入力し、サーバーに内部ネットワークへのリクエストを強制する攻撃

**対策の実装**:

```kotlin
private val FORBIDDEN_HOSTS = listOf(
    "localhost",
    "127.",      // 127.0.0.0/8 全体（127.0.0.1 だけでなく 127.x.x.x 全て）
    "0.0.0.0",
    "[::1]", "::1",
    "[fe80:", "fe80:",    // IPv6 link-local
    "[fc00:", "fc00:",    // IPv6 private
    "[fd00:", "fd00:",    // IPv6 private
    "169.254.",           // AWS メタデータサーバーなど
    "10.",                // プライベートネットワーク
    "172.16." /* ... */ "172.31.",
    "192.168."
)

private fun validateNotInternalHost(host: String) {
    val isInternal = FORBIDDEN_HOSTS.any { host.startsWith(it) }
    if (isInternal) {
        logger.warn { "🚨 SSRF attempt detected: internal host '$host'" }
    }
    require(!isInternal) { "Access to internal hosts is not allowed" }
}
```

**なぜ `127.` でブロックするか**:
- `127.0.0.1` のみをブロックすると `127.0.0.2` や `127.1.1.1` などでバイパス可能
- RFC 3330 で 127.0.0.0/8 は全てループバックとして定義されている

### 2. XSS（Cross-Site Scripting）防止

```kotlin
private val DANGEROUS_SCHEMES = listOf(
    "javascript:" to "JavaScript",  // 最も一般的な XSS 攻撃ベクター
    "data:" to "Data",              // inline コンテンツの埋め込みに悪用
    "vbscript:" to "VBScript",      // IE での XSS 攻撃
    "file:" to "File"               // ローカルファイルアクセス
)

private fun validateNoXssSchemes(url: String) {
    val lowercaseUrl = url.lowercase()
    DANGEROUS_SCHEMES.forEach { (scheme, name) ->
        require(!lowercaseUrl.contains(scheme)) {
            "$name URLs are not allowed"
        }
    }
}
```

### 3. URL エンコーディングによるバイパス防止

```kotlin
private fun extractHost(url: String): String {
    // ...
    // URL エンコードされたホスト名を拒否
    // 例: %31%32%37%2E%30%2E%30%2E%31 → 127.0.0.1
    if (host.contains("%")) {
        logger.warn { "🚨 SSRF attempt detected: URL-encoded host in '$url'" }
        throw IllegalArgumentException("URL-encoded hosts are not allowed")
    }
    return host
}
```

### 4. 信頼ドメインのホワイトリスト

```kotlin
private fun validateTrustedDomain(host: String) {
    val isTrusted = TRUSTED_DOMAINS.any { domain ->
        host.endsWith(domain) || host == domain.trimStart('.')
    }
    if (!isTrusted) {
        logger.warn { "🚨 Untrusted domain access attempt: host='$host'" }
    }
    require(isTrusted) {
        "URL host '$host' is not in the trusted domains list"
    }
}
```

## TDD によるテスト実装

リファクタリングは TDD（テスト駆動開発）で進めました。

### テスト構造

```kotlin
@DisplayName("ProposalDocumentUrlValidator")
class ProposalDocumentUrlValidatorTest {

    @Nested
    @DisplayName("正常系")
    inner class SuccessCase {
        @Test
        @DisplayName("CloudFront URL を許可する")
        fun `CloudFront URL を許可する`() { /* ... */ }

        @Test
        @DisplayName("信頼ドメインのサブドメインを許可する")
        fun `信頼ドメインのサブドメインを許可する`() { /* ... */ }
    }

    @Nested
    @DisplayName("異常系: SSRF 防止")
    inner class SsrfPreventionCase {
        @ParameterizedTest
        @ValueSource(strings = [
            "https://localhost/proposal.pdf",
            "https://127.0.0.1/proposal.pdf",
            "https://169.254.169.254/latest/meta-data/"
        ])
        @DisplayName("内部ホストへのアクセスは拒否する")
        fun `内部ホストへのアクセスは拒否する`(url: String) { /* ... */ }

        @ParameterizedTest
        @ValueSource(strings = [
            "https://127.0.0.2/proposal.pdf",
            "https://127.1.1.1/proposal.pdf",
            "https://127.255.255.255/proposal.pdf"
        ])
        @DisplayName("127.0.0.0/8 範囲全体を拒否する")
        fun `127帯域全体を拒否する`(url: String) { /* ... */ }
    }

    // ... 合計 23 テストケース
}
```

### テストカバレッジ

| カテゴリ | テスト数 |
|---------|---------|
| 正常系（信頼ドメイン） | 6 |
| 空白・長さ | 5 |
| スキーム | 5 |
| SSRF 防止（IPv4） | 3 |
| SSRF 防止（IPv6） | 1 |
| 信頼されないドメイン | 2 |
| URL フォーマット | 1 |
| **合計** | **23** |

### 境界値テスト

```kotlin
@Test
@DisplayName("2048文字ちょうどの URL は許可する")
fun `2048文字ちょうどの URL は許可する`() {
    val baseUrl = "https://ad-one.raksul.com/"
    val url = baseUrl + "a".repeat(2048 - baseUrl.length)
    assertDoesNotThrow { validator.validate(url) }
}

@Test
@DisplayName("2049文字の URL は拒否する")
fun `2049文字の URL は拒否する`() {
    val baseUrl = "https://ad-one.raksul.com/"
    val url = baseUrl + "a".repeat(2049 - baseUrl.length)
    val exception = assertThrows<IllegalArgumentException> {
        validator.validate(url)
    }
    assert(exception.message?.contains("2048") == true)
}
```

## リファクタリングの効果

### 定量的効果

| 指標 | Before | After |
|-----|--------|-------|
| EmailService の行数 | 削減（77行削除） | - |
| テストケース数 | EmailService のテストに混在 | 独立した 23 テストケース |
| セキュリティチェック項目 | 5 | 8（IPv6、vbscript 等を追加） |

### 定性的効果

1. **保守性の向上**: URL バリデーションの変更が他の機能に影響しない
2. **テスト容易性**: モック差し替えによる EmailService の単体テストが容易に
3. **セキュリティの強化**: コードレビューで指摘された脆弱性を修正
4. **ドキュメント化**: クラスレベルで詳細なセキュリティドキュメントを追加

## セキュリティドキュメントの重要性

クラスの Javadoc にセキュリティ前提と既知の制限を明記しました。

```kotlin
/**
 * 提案資料 URL のバリデーター
 *
 * セキュリティ前提:
 * - この Validator は URL の検証のみを行う
 * - DNS rebinding 攻撃の防止は HTTP クライアント層で実装すること
 * - 信頼ドメイン (S3/CloudFront) は内部生成されるため、外部入力による汚染リスクは低い
 * - 本番環境では HTTPS 通信および証明書検証が必須
 *
 * 既知の制限:
 * - URL エンコードされた IP アドレスの検出は URI クラスの実装に依存
 * - DNS ベースの攻撃 (rebinding, subdomain takeover) は検出不可
 */
```

## まとめ

このリファクタリングでは以下を達成しました:

1. **単一責任の原則の適用**: URL バリデーションを独立したクラスに抽出
2. **インターフェースによる抽象化**: テスト容易性と拡張性を確保
3. **セキュリティの強化**: SSRF/XSS 対策を包括的に実装
4. **TDD による品質保証**: 23 のテストケースで動作を保証
5. **ドキュメントの充実**: セキュリティ前提と制限を明記

セキュリティに関わるコードをリファクタリングする際は、機能の分離だけでなく、セキュリティ要件の見直しと強化も同時に行うことが重要です。本リファクタリングでは、コードレビューのフィードバックを取り入れながら、IPv6 対応や追加の XSS ベクター対策など、当初の実装よりも堅牢なセキュリティを実現しました。
