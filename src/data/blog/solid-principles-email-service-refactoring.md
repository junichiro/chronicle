---
author: junichiro
pubDatetime: 2026-01-06T12:51:04+09:00
title: SOLID原則を実践で学ぶ：EmailService リファクタリング完全ガイド
slug: solid-principles-email-service-refactoring
featured: false
draft: false
tags:
  - kotlin
  - spring-boot
  - solid
  - refactoring
  - clean-architecture
  - tdd
description: EmailServiceのリファクタリングを通じて、SOLID原則（DIP、SRP、ISP）の実践的な適用方法を学ぶ完全ガイド。Kotlin/Spring Bootでのテストしやすいコード設計を解説。
---

## はじめに

「このコード、テスト書きにくいな...」
「依存関係が多すぎて、修正が怖い...」

こんな経験はありませんか？私たちのチームでも、`EmailService` というクラスが肥大化し、テストが困難になっていました。この記事では、**SOLID原則** を適用して、このクラスをどのようにリファクタリングしたかを詳しく解説します。

### この記事で学べること

- SOLID原則（特に DIP, SRP, ISP）の実践的な適用方法
- 段階的なリファクタリングの進め方
- コードレビューで指摘されやすいポイントと対処法
- Kotlin/Spring Boot でのインターフェース設計

### 対象読者

- SOLID原則を聞いたことはあるが、実践での使い方がわからない方
- テストしやすいコードの書き方を学びたい方
- Kotlin/Spring Boot でのリファクタリングに興味がある方

---

## 1. リファクタリング前の問題

### 1.1 元のコードの構造

リファクタリング前の `EmailService` は、以下のような構造でした：

```kotlin
@Service
class EmailService(
    private val resendApiClient: ResendApiClient,  // 具体クラスに直接依存
    private val s3DownloadClient: S3DownloadClient,
    @Value("\${email.reply-to:}") private val replyToEmail: String,
    @Value("\${email.safety.dry-run:true}") private val dryRun: Boolean,
    @Value("\${email.safety.allowed-recipients:}") private val allowedRecipientsConfig: String
) {
    private lateinit var allowedRecipients: Set<String>

    @PostConstruct
    fun initialize() {
        // 許可リストの初期化
        allowedRecipients = parseAllowedRecipients()
        logSafetySettings()
    }

    fun sendProposalEmail(request: ProposalEmailRequest): String {
        // 入力バリデーション
        // 許可リストチェック
        // テンプレート読み込み
        // 変数置換（HTMLエスケープ）
        // Dry-Runチェック
        // メール送信
        // ...100行以上のコード
    }

    private fun parseAllowedRecipients(): Set<String> { /* ... */ }
    private fun isRecipientAllowed(email: String): Boolean { /* ... */ }
    private fun loadEmailTemplate(): String { /* ... */ }
    private fun renderTemplate(template: String, variables: Map<String, String>): String { /* ... */ }
    private fun sanitizeContactName(name: String?): String { /* ... */ }
    private fun sanitizeCompanyName(name: String?): String { /* ... */ }
}
```

### 1.2 何が問題だったのか？

#### 問題1: 具体クラスへの直接依存（DIP違反）

```kotlin
private val resendApiClient: ResendApiClient  // ← 具体クラス
```

`ResendApiClient` は外部API（Resend）と通信するクラスです。これに直接依存していると：

- **テストが困難**: 単体テストで実際にメールを送信してしまう
- **差し替え不可**: 別のメール送信サービスに変更できない
- **モック化が複雑**: 具体クラスのモックは設定が煩雑

#### 問題2: 1つのクラスが多くの責務を持つ（SRP違反）

`EmailService` が担当していた責務：

1. メール送信の制御
2. 受信者の許可リスト管理
3. HTMLテンプレートの読み込み
4. テンプレート変数の置換とHTMLエスケープ
5. 入力値のサニタイズ

> **単一責任の原則（SRP）**: クラスを変更する理由は1つだけであるべき

「許可リストのロジックを変えたい」「テンプレートの読み込み方法を変えたい」など、異なる理由で同じクラスを修正することになります。

#### 問題3: `lateinit var` の危険性

```kotlin
private lateinit var allowedRecipients: Set<String>

@PostConstruct
fun initialize() {
    allowedRecipients = parseAllowedRecipients()
}
```

`lateinit var` は初期化忘れで `UninitializedPropertyAccessException` を引き起こす可能性があります。これは **実行時エラー** であり、コンパイル時に検出できません。

---

## 2. SOLID原則の復習

リファクタリングの前に、今回適用する3つの原則を確認しましょう。

### 2.1 DIP（依存性逆転の原則）

> **Dependency Inversion Principle**: 上位モジュールは下位モジュールに依存すべきではない。両者は抽象に依存すべきである。

```
❌ Before:
EmailService → ResendApiClient（具体クラス）

✅ After:
EmailService → EmailSender（インターフェース） ← ResendApiClient
```

**メリット**:
- テスト時にモックを簡単に注入できる
- 実装を差し替え可能（Resend → SendGrid など）
- 依存関係が明確になる

### 2.2 SRP（単一責任の原則）

> **Single Responsibility Principle**: クラスを変更する理由は1つだけであるべき。

1つのクラスに複数の責務があると：
- 変更の影響範囲が広がる
- テストが複雑になる
- 再利用が困難になる

### 2.3 ISP（インターフェース分離の原則）

> **Interface Segregation Principle**: クライアントは自分が使わないメソッドに依存すべきではない。

```kotlin
// ❌ 悪い例：使わないメソッドがある
interface EmailSender {
    fun sendEmail(to: String, subject: String, html: String): String
    fun sendEmailWithAttachment(...): String  // ← 使わないのに依存
}

// ✅ 良い例：必要なメソッドだけ
interface EmailSender {
    fun sendEmail(to: String, subject: String, html: String): String
}
```

---

## 3. リファクタリングの実践

### Phase 1: DIPの適用 - EmailSender インターフェースの導入

#### Step 1: インターフェースを定義

```kotlin
/**
 * メール送信の抽象化インターフェース
 *
 * このインターフェースにより、具体的なメール送信実装（Resend, SendGrid等）から
 * ビジネスロジックを分離できます。
 */
interface EmailSender {
    /**
     * メールを送信する
     *
     * @param to 受信者のメールアドレス
     * @param subject 件名
     * @param html HTML本文
     * @param text テキスト本文（オプション）
     * @param replyTo 返信先（オプション）
     * @return メッセージID
     * @throws EmailSendingException 送信失敗時
     */
    fun sendEmail(
        to: String,
        subject: String,
        html: String,
        text: String? = null,
        replyTo: String? = null
    ): String

    /**
     * 送信可能な状態か確認
     */
    fun isConfigured(): Boolean
}
```

#### Step 2: 既存クラスにインターフェースを実装

```kotlin
@Component
class ResendApiClient(
    @param:Value("\${resend.api-key:}") private val apiKey: String,
    @param:Value("\${resend.from-address:noreply@resend.dev}") private val fromAddress: String
) : EmailSender {  // ← インターフェースを実装

    override fun sendEmail(
        to: String,
        subject: String,
        html: String,
        text: String?,
        replyTo: String?
    ): String {
        // 既存の実装をそのまま使用
    }

    override fun isConfigured(): Boolean = apiKey.isNotBlank()
}
```

#### Step 3: EmailService の依存を変更

```kotlin
@Service
class EmailService(
    private val emailSender: EmailSender,  // ← インターフェースに依存
    // ...
)
```

#### なぜこれが重要か？

```kotlin
// テストコード
class EmailServiceTest {
    // モックを簡単に作成できる
    private val mockEmailSender = mockk<EmailSender>()

    @Test
    fun `メール送信が成功する`() {
        // Given: モックの振る舞いを定義
        every {
            mockEmailSender.sendEmail(any(), any(), any(), any(), any())
        } returns "msg-123"

        val service = EmailService(
            emailSender = mockEmailSender,
            // ...
        )

        // When & Then
        val result = service.sendProposalEmail(request)
        assertEquals("msg-123", result)
    }
}
```

---

### Phase 2: SRPの適用 - テンプレート処理の分離

#### Step 1: EmailTemplateRenderer インターフェースを定義

```kotlin
/**
 * メールテンプレートのレンダリングを担当
 *
 * テンプレートの読み込みと変数置換を抽象化します。
 * XSS防止のためのHTMLエスケープも担当します。
 */
interface EmailTemplateRenderer {
    /**
     * 提案メール用テンプレートを読み込む
     */
    fun loadProposalEmailTemplate(): String

    /**
     * テンプレートを変数で置換する
     *
     * @param template テンプレート文字列
     * @param variables 置換変数のマップ
     * @return レンダリング済みテンプレート
     */
    fun render(template: String, variables: Map<String, String>): String
}
```

#### Step 2: デフォルト実装を作成

```kotlin
@Component
class DefaultEmailTemplateRenderer : EmailTemplateRenderer {

    companion object {
        private const val PROPOSAL_EMAIL_TEMPLATE_PATH = "email/proposal-email.html"
        private const val PLACEHOLDER_DEFAULT_VALUE = "[削除済み]"
        private val PLACEHOLDER_PATTERN = "\\{\\{[A-Z_]+\\}\\}".toRegex()
    }

    override fun loadProposalEmailTemplate(): String {
        return try {
            val resource = ClassPathResource(PROPOSAL_EMAIL_TEMPLATE_PATH)
            resource.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            throw EmailTemplateException(
                "Failed to load email template from path: '$PROPOSAL_EMAIL_TEMPLATE_PATH'. " +
                "Error: ${e.message}",
                e
            )
        }
    }

    override fun render(template: String, variables: Map<String, String>): String {
        var result = template

        // 各変数を HTML エスケープして置換（XSS防止）
        for ((key, value) in variables) {
            val escapedValue = StringEscapeUtils.escapeHtml4(value)
            result = result.replace(key, escapedValue)
        }

        // 未置換のプレースホルダをデフォルト値に置換
        val unmatchedPlaceholders = PLACEHOLDER_PATTERN.findAll(result).toList()
        if (unmatchedPlaceholders.isNotEmpty()) {
            logger.warn { "Found unmatched placeholders: ${unmatchedPlaceholders.map { it.value }}" }
            result = PLACEHOLDER_PATTERN.replace(result) { PLACEHOLDER_DEFAULT_VALUE }
        }

        return result
    }
}
```

#### 分離の効果

| 観点 | Before | After |
|------|--------|-------|
| テスト | テンプレート処理のテストにEmailService全体が必要 | `DefaultEmailTemplateRenderer` だけでテスト可能 |
| 変更影響 | テンプレート変更でEmailService全体に影響 | Rendererだけ変更すればOK |
| 再利用 | 他の場所でテンプレート処理が必要なら重複実装 | Rendererを注入するだけ |

---

### Phase 3: SRPの適用 - 受信者ポリシーの分離

#### 問題: `lateinit var` と `@PostConstruct`

```kotlin
// ❌ Before: 危険なパターン
private lateinit var allowedRecipients: Set<String>

@PostConstruct
fun initialize() {
    allowedRecipients = parseAllowedRecipients()
}
```

この実装の問題点：

1. **初期化忘れのリスク**: `@PostConstruct` が呼ばれる前にアクセスすると例外
2. **テストの複雑化**: 手動で `initialize()` を呼ぶ必要がある
3. **不変性の欠如**: `var` なので後から変更可能

#### 解決策: コンストラクタ初期化

```kotlin
@Component
class AllowedListRecipientPolicy(
    @param:Value("\${email.safety.allowed-recipients:}")
    private val allowedRecipientsConfig: String = ""
) : EmailRecipientPolicy {

    // コンストラクタで初期化 - 不変で安全
    private val allowedRecipients: Set<String> = parseAllowedRecipients(allowedRecipientsConfig)

    init {
        // 初期化後のログ出力
        logConfiguration()
    }

    private fun parseAllowedRecipients(config: String): Set<String> {
        if (config.isBlank()) {
            return emptySet()
        }
        return config
            .split(",")
            .asSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .map { it.lowercase() }  // 大文字小文字を正規化
            .toSet()
    }

    override fun isAllowed(recipientEmail: String): Boolean {
        if (allowedRecipients.isEmpty()) {
            return true  // 許可リストが空なら全員許可
        }
        return allowedRecipients.contains(recipientEmail.lowercase())
    }

    override fun getAllowedRecipients(): Set<String> = allowedRecipients
}
```

#### なぜ `init` ブロックが良いのか？

| 特徴 | `@PostConstruct` | `init` ブロック |
|------|------------------|-----------------|
| 実行タイミング | Spring による依存注入後 | コンストラクタ実行時 |
| テスト | 手動呼び出しが必要 | 自動的に実行 |
| Kotlin らしさ | Java 由来のアノテーション | Kotlin ネイティブ |
| 初期化保証 | 呼び忘れの可能性 | 必ず実行される |

---

### Phase 4: SRPの適用 - 入力サニタイズの分離

```kotlin
interface EmailInputSanitizer {
    fun sanitizeContactName(contactName: String?): String
    fun sanitizeCompanyName(companyName: String?): String
}

@Component
class DefaultEmailInputSanitizer : EmailInputSanitizer {

    companion object {
        private const val DEFAULT_CONTACT_NAME = "ご担当者"
        private const val DEFAULT_COMPANY_NAME = "御社"
    }

    override fun sanitizeContactName(contactName: String?): String {
        return contactName?.takeIf { it.isNotBlank() } ?: DEFAULT_CONTACT_NAME
    }

    override fun sanitizeCompanyName(companyName: String?): String {
        return companyName?.takeIf { it.isNotBlank() } ?: DEFAULT_COMPANY_NAME
    }
}
```

---

## 4. リファクタリング後のコード

### 4.1 最終的な EmailService

```kotlin
@Service
class EmailService(
    private val emailSender: EmailSender,
    private val templateRenderer: EmailTemplateRenderer,
    private val recipientPolicy: EmailRecipientPolicy,
    private val inputSanitizer: EmailInputSanitizer,
    @param:Value("\${email.reply-to:}") private val replyToEmail: String,
    @param:Value("\${email.safety.dry-run:true}") private val dryRun: Boolean = true
) {
    fun sendProposalEmail(request: ProposalEmailRequest): String {
        // 入力バリデーション
        require(request.proposalId.isNotBlank()) { "Proposal ID cannot be blank" }
        require(request.recipientEmail.isNotBlank()) { "Recipient email cannot be blank" }
        require(request.proposalFileName.isNotBlank()) { "Proposal file name cannot be blank" }
        require(request.proposalDocumentUrl.isNotBlank()) { "Proposal document URL cannot be blank" }

        // 許可リストチェック（ポリシーに委譲）
        if (!recipientPolicy.isAllowed(request.recipientEmail)) {
            throw EmailRecipientNotAllowedException(
                message = "Recipient ${request.recipientEmail} is not in the allowed list",
                recipientEmail = request.recipientEmail,
                allowedRecipients = recipientPolicy.getAllowedRecipients()
            )
        }

        // テンプレート処理（Rendererに委譲）
        val variables = EmailTemplateVariables(/* ... */)
        val htmlTemplate = templateRenderer.loadProposalEmailTemplate()
        val html = templateRenderer.render(htmlTemplate, variables.toMap())

        val subject = "【Novasell】${variables.companyName}様向け広告提案資料のご案内"

        // Dry-Run モード
        if (dryRun) {
            logger.info { "[DRY-RUN] Would send email to ${request.recipientEmail}" }
            return "dry-run-${request.proposalId}"
        }

        // メール送信（Senderに委譲）
        return emailSender.sendEmail(
            to = request.recipientEmail,
            subject = subject,
            html = html,
            replyTo = replyToEmail.takeIf { it.isNotBlank() }
        )
    }
}
```

### 4.2 Before/After 比較

| 観点 | Before | After |
|------|--------|-------|
| 依存関係 | 5つの具体クラス | 4つのインターフェース |
| 責務 | 6つ以上 | 1つ（オーケストレーション） |
| テスト容易性 | 低い（モック複雑） | 高い（インターフェースモック） |
| 変更影響範囲 | 広い | 狭い（各コンポーネント独立） |
| コード行数 | 約200行 | 約80行 |

---

## 5. コードレビューで学んだこと

リファクタリング後、コードレビューで複数の指摘を受けました。ここでは特に学びになった点を紹介します。

### 5.1 ISP違反: 使わないメソッドは作らない

#### 指摘された問題

```kotlin
// ResendApiClient に追加していたメソッド
fun sendEmailWithAttachment(
    to: String,
    subject: String,
    html: String,
    attachmentContent: ByteArray,
    // ...
): String {
    throw UnsupportedOperationException(
        "Attachment support is not yet implemented."
    )
}
```

「将来使うかも」と思って追加したメソッドでしたが、これは **ISP（インターフェース分離の原則）** と **YAGNI（You Aren't Gonna Need It）** に違反しています。

#### 解決策

```kotlin
// シンプルに削除！
// 必要になったときに追加すればよい
```

> **教訓**: 「将来使うかも」は実装しない理由になる。必要になったときに実装すれば十分。

### 5.2 重複イテレーションの無駄

#### 指摘された問題

```kotlin
val unmatchedPlaceholders = PLACEHOLDER_PATTERN.findAll(result)
if (unmatchedPlaceholders.toList().isNotEmpty()) {  // 1回目の toList()
    logger.warn { "Found: ${unmatchedPlaceholders.toList().map { it.value }}" }  // 2回目の toList()
    // ...
}
```

Kotlin の `Sequence` は遅延評価されるため、`toList()` を呼ぶたびに再計算されます。

#### 解決策

```kotlin
val unmatchedPlaceholders = PLACEHOLDER_PATTERN.findAll(result).toList()  // 1回だけ
if (unmatchedPlaceholders.isNotEmpty()) {
    logger.warn { "Found: ${unmatchedPlaceholders.map { it.value }}" }  // List なので再計算なし
    // ...
}
```

> **教訓**: `Sequence` と `List` の違いを理解し、適切に変換する。

### 5.3 テストのアサーションは具体的に

#### 指摘された問題

```kotlin
@Test
fun `有効な設定値の場合は正常に初期化される`() {
    val service = EmailService(/* ... */)
    assertNotNull(service)  // ← 弱いアサーション
}
```

「インスタンスが作れた」だけでは、正しく初期化されたかわかりません。

#### 解決策

```kotlin
@Test
fun `メール送信が成功する`() {
    // Given: すべての依存をモック化
    every { recipientPolicy.isAllowed(any()) } returns true
    every { templateRenderer.loadProposalEmailTemplate() } returns "<html>{{COMPANY_NAME}}</html>"
    every { templateRenderer.render(any(), any()) } returns "<html>テスト株式会社</html>"
    every { inputSanitizer.sanitizeCompanyName(any()) } returns "テスト株式会社"
    every { inputSanitizer.sanitizeContactName(any()) } returns "田中様"
    every { emailSender.sendEmail(any(), any(), any(), any(), any()) } returns "msg-123"

    val service = EmailService(
        emailSender = mockEmailSender,
        templateRenderer = mockTemplateRenderer,
        recipientPolicy = recipientPolicy,
        inputSanitizer = mockInputSanitizer,
        replyToEmail = "reply@example.com",
        dryRun = false  // 実際に送信
    )

    // When
    val result = service.sendProposalEmail(validRequest)

    // Then: 期待通りのメッセージIDが返される
    assertEquals("msg-123", result)
    verify { emailSender.sendEmail("test@example.com", any(), any(), any(), any()) }
}

@Test
fun `dryRun が true の場合、実際には送信されない`() {
    // Given
    every { recipientPolicy.isAllowed(any()) } returns true
    every { templateRenderer.loadProposalEmailTemplate() } returns "<html></html>"
    every { templateRenderer.render(any(), any()) } returns "<html></html>"
    every { inputSanitizer.sanitizeCompanyName(any()) } returns "テスト"
    every { inputSanitizer.sanitizeContactName(any()) } returns "担当者"

    val service = EmailService(
        emailSender = mockEmailSender,
        templateRenderer = mockTemplateRenderer,
        recipientPolicy = recipientPolicy,
        inputSanitizer = mockInputSanitizer,
        replyToEmail = "reply@example.com",
        dryRun = true  // Dry-Run モード
    )

    // When
    val result = service.sendProposalEmail(validRequest)

    // Then: dry-run プレフィックス付きのIDが返され、実際の送信は行われない
    assertTrue(result.startsWith("dry-run-"))
    verify(exactly = 0) { emailSender.sendEmail(any(), any(), any(), any(), any()) }
}
```

> **教訓**: テストは「何をテストしているか」が明確であるべき。アサーションは具体的に。

---

## 6. まとめ

### 6.1 リファクタリングで達成したこと

1. **DIP適用**: 具体クラスではなくインターフェースに依存
2. **SRP適用**: 1クラス1責務に分離
3. **ISP適用**: 不要なメソッドを削除
4. **Fail-Fast**: `lateinit var` を排除し、コンストラクタで初期化
5. **テスト容易性向上**: モックの注入が簡単に

### 6.2 学んだ教訓

| 原則 | 実践 |
|------|------|
| DIP | 「具体クラスに依存していたらインターフェースを検討」 |
| SRP | 「このクラスを変更する理由は何個ある？」と自問 |
| ISP | 「使わないメソッドは作らない」（YAGNI） |
| Fail-Fast | 「エラーは早く検出、`lateinit` より `val`」 |

### 6.3 次のステップ

このリファクタリングで基盤ができました。今後は：

- 他のServiceクラスにも同様の原則を適用
- テストカバレッジの向上
- エラーハンドリングの改善

---

## 参考資料

- [Clean Architecture（Robert C. Martin）](https://www.amazon.co.jp/dp/4048930656)
- [Kotlin公式ドキュメント](https://kotlinlang.org/docs/home.html)
- [Spring Framework Reference](https://docs.spring.io/spring-framework/reference/)
- [MockK - Kotlin Mocking Library](https://mockk.io/)

---

*この記事は実際のリファクタリング作業を元に作成しました。コードレビューで指摘を受け、修正を重ねることで、より良いコードに改善できました。「完璧を目指すより、まず動くものを作り、レビューを通じて改善する」というアプローチが有効だと実感しています。*
