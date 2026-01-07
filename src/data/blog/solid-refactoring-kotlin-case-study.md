---
author: junichiro
pubDatetime: 2026-01-07T15:01:13+09:00
title: SOLID原則によるKotlinコードリファクタリング実践ガイド
slug: solid-refactoring-kotlin-case-study
featured: false
draft: false
tags:
  - kotlin
  - spring
  - solid
  - refactoring
  - clean-code
  - design-patterns
  - testing
description: EmailSchedulerServiceのリファクタリング事例を通じて、SOLID原則を実際のプロダクションコードに適用する方法を解説。Enum戦略パターン、依存性注入、段階的リファクタリングの実践例。
---

## はじめに

本記事では、メール送信スケジューラーサービス（`EmailSchedulerService`）のリファクタリング事例を通じて、 **SOLID原則** を実際のプロダクションコードにどのように適用するかを解説します。

### この記事で学べること

- SOLID原則の各原則の具体的な適用方法
- 責務分離によるテスタビリティの向上
- Kotlinにおけるenum戦略パターンの活用
- 段階的なリファクタリングと後方互換性の維持
- 自動コードレビューと修正サイクルの実践

### リファクタリング対象

- **対象クラス**: `EmailSchedulerService` - メールの並列送信、リトライ処理、CloudWatchメトリクス発行を担当
- **課題**: 1つのクラスに複数の責務が集中し、テストが複雑化
- **解決策**: SOLID原則に基づく責務分離と依存性注入

---

## 1. リファクタリング前の問題点

### Before: 密結合したモノリシックなサービス

リファクタリング前の `EmailSchedulerService` は以下の問題を抱えていました。

```kotlin
// ❌ Before: 複数の責務が1つのクラスに集中
@Service
class EmailSchedulerService(
    private val emailService: EmailService,
    private val emailDeliveryRepository: EmailDeliveryRepository,
    private val proposalRepository: ProposalRepository,
    private val timeProvider: TimeProvider,
    private val cloudWatchMetricsHelper: CloudWatchMetricsHelper,  // 直接依存
    // ...
) {
    // 責務1: エラーの再試行判定
    private fun isRetryableError(exception: Exception): Boolean {
        val message = exception.message?.lowercase() ?: return false
        return message.contains("429") ||
               message.contains("rate limit") ||
               message.contains("timeout") ||
               message.contains("timed out") ||
               // ... 20行以上の条件分岐
    }

    // 責務2: エラーメッセージのサニタイズ
    private fun sanitizeErrorMessage(message: String?): String {
        if (message == null) return "Unknown error"
        val lowerMessage = message.lowercase()
        return when {
            lowerMessage.contains("429") -> "Rate limit exceeded..."
            lowerMessage.contains("rate limit") -> "Rate limit exceeded..."
            // ... 同じキーワードリストの重複
        }
    }

    // 責務3: リトライのバックオフ計算
    private fun calculateBackoffDelay(attemptIndex: Int): Long {
        val baseDelay = 1000L * (1 shl attemptIndex)
        val jitter = Random.nextLong(0, 1000)
        return baseDelay + jitter
    }

    // 責務4: CloudWatchメトリクス発行
    private fun emitMetrics(sentCount: Int, failedCount: Int, executionTimeMillis: Long) {
        try {
            cloudWatchMetricsHelper.putEmailMetrics(sentCount, failedCount, executionTimeMillis)
        } catch (e: Exception) {
            logger.warn(e) { "Failed to emit metrics" }
        }
    }

    // 責務5: メール送信のオーケストレーション
    fun sendScheduledEmails(): EmailDeliveryResult { /* ... */ }
}
```

### 問題点の分析

| 問題 | 影響 | SOLID違反 |
|------|------|-----------|
| 1クラスに5つ以上の責務 | 変更影響範囲が広い | **SRP違反** |
| 具体クラス（CloudWatchMetricsHelper）への直接依存 | テスト時のモック困難 | **DIP違反** |
| エラー判定とサニタイズで同じキーワードリストを重複管理 | DRY原則違反、保守コスト増 | **OCP違反** |
| リトライ戦略がハードコード | 戦略変更時にサービス本体を修正 | **OCP違反** |

---

## 2. SOLID原則に基づくリファクタリング

### 2.1 SRP（単一責任の原則）の適用

**原則**: クラスは変更する理由がただ1つであるべき

#### 責務の分離

4つの独立した責務を4つのインターフェース + 実装に分離しました。

```
EmailSchedulerService
├── EmailErrorClassifier (エラー分類の責務)
│   └── DefaultEmailErrorClassifier
├── EmailRetryPolicy (リトライ戦略の責務)
│   └── ExponentialBackoffRetryPolicy
└── EmailSchedulerMetrics (メトリクス発行の責務)
    └── CloudWatchEmailSchedulerMetrics
```

#### インターフェース設計

```kotlin
// エラー分類の責務を分離
interface EmailErrorClassifier {
    /**
     * エラーが再試行可能かどうかを判定
     */
    fun isRetryableError(exception: Exception): Boolean

    /**
     * エラーメッセージをサニタイズして機密情報を除去
     */
    fun sanitizeErrorMessage(message: String?): String
}

// リトライ戦略の責務を分離
interface EmailRetryPolicy {
    /**
     * リトライ時のバックオフ遅延時間を計算
     */
    fun calculateBackoffDelay(attemptIndex: Int): Long
}

// メトリクス発行の責務を分離
interface EmailSchedulerMetrics {
    /**
     * メール送信結果のメトリクスを発行
     */
    fun emitMetrics(sentCount: Int, failedCount: Int, executionTimeMillis: Long)
}
```

### 2.2 DIP（依存性逆転の原則）の適用

**原則**: 上位モジュールは下位モジュールに依存すべきでない。両者は抽象に依存すべき

#### Before: 具象クラスへの依存

```kotlin
// ❌ CloudWatchMetricsHelper という具象クラスに直接依存
class EmailSchedulerService(
    private val cloudWatchMetricsHelper: CloudWatchMetricsHelper
)
```

#### After: インターフェースへの依存

```kotlin
// ✅ インターフェースに依存
@Service
class EmailSchedulerService(
    private val emailService: EmailService,
    private val emailDeliveryRepository: EmailDeliveryRepository,
    private val proposalRepository: ProposalRepository,
    private val timeProvider: TimeProvider,
    private val emailErrorClassifier: EmailErrorClassifier,      // 抽象に依存
    private val emailRetryPolicy: EmailRetryPolicy,              // 抽象に依存
    private val emailSchedulerMetrics: EmailSchedulerMetrics,    // 抽象に依存
    // ...
) {
    // サービス本体は抽象に対してプログラミング
    fun sendScheduledEmails(): EmailDeliveryResult {
        // ...
        if (emailErrorClassifier.isRetryableError(exception)) {
            val delay = emailRetryPolicy.calculateBackoffDelay(attemptIndex)
            // ...
        }
        emailSchedulerMetrics.emitMetrics(sentCount, failedCount, executionTimeMillis)
    }
}
```

#### 依存関係図

```
┌─────────────────────────────────────────────────────────────────┐
│                    EmailSchedulerService                         │
│                     (High-level module)                          │
└───────────┬───────────────────┬───────────────────┬─────────────┘
            │                   │                   │
            ▼                   ▼                   ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │EmailError     │   │EmailRetry     │   │EmailScheduler │
    │Classifier     │   │Policy         │   │Metrics        │
    │(interface)    │   │(interface)    │   │(interface)    │
    └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
            │                   │                   │
            ▼                   ▼                   ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │DefaultEmail   │   │Exponential    │   │CloudWatch     │
    │ErrorClassifier│   │BackoffRetry   │   │EmailScheduler │
    │               │   │Policy         │   │Metrics        │
    └───────────────┘   └───────────────┘   └───────────────┘
      (Low-level)         (Low-level)         (Low-level)
```

---

## 3. Enum戦略パターンによるDRY原則の適用

### Before: 重複したキーワードリスト

```kotlin
// ❌ isRetryableError と sanitizeErrorMessage で
// 同じキーワードリストを重複管理
private fun isRetryableError(exception: Exception): Boolean {
    val message = exception.message?.lowercase() ?: return false
    return message.contains("429") ||
           message.contains("rate limit") ||
           message.contains("timeout") ||
           // ... 重複1
}

private fun sanitizeErrorMessage(message: String?): String {
    val lowerMessage = message.lowercase()
    return when {
        lowerMessage.contains("429") -> "Rate limit exceeded..."
        lowerMessage.contains("rate limit") -> "Rate limit exceeded..."
        lowerMessage.contains("timeout") -> "Request timed out..."
        // ... 重複2
    }
}
```

### After: Enum戦略パターン

Kotlinのenumを活用し、 **エラーカテゴリごとにキーワード、リトライ可否、ユーザーメッセージを一元管理** しました。

```kotlin
@Component
class DefaultEmailErrorClassifier : EmailErrorClassifier {

    /**
     * エラーカテゴリの定義
     *
     * 各カテゴリは以下を持つ:
     * - keywords: エラーメッセージに含まれるキーワードのリスト
     * - isRetryable: 再試行可能かどうか
     * - userMessage: ユーザー向けのサニタイズされたメッセージ
     */
    private enum class ErrorCategory(
        val keywords: List<String>,
        val isRetryable: Boolean,
        val userMessage: String
    ) {
        RATE_LIMIT(
            keywords = listOf("429", "rate limit"),
            isRetryable = true,
            userMessage = "Rate limit exceeded. Will retry later."
        ),
        TIMEOUT(
            keywords = listOf("timeout", "timed out"),
            isRetryable = true,
            userMessage = "Request timed out. Will retry later."
        ),
        CONNECTION_ERROR(
            keywords = listOf("connection refused", "connection reset"),
            isRetryable = true,
            userMessage = "Connection error. Will retry later."
        ),
        SERVICE_UNAVAILABLE(
            keywords = listOf("temporarily unavailable", "service unavailable", "temporarily", "unavailable"),
            isRetryable = true,
            userMessage = "Service temporarily unavailable. Will retry later."
        ),
        INVALID_EMAIL(
            keywords = listOf("invalid email", "invalid address"),
            isRetryable = false,
            userMessage = "Invalid email address format."
        ),
        AUTH_ERROR(
            keywords = listOf("unauthorized", "authentication"),
            isRetryable = false,
            userMessage = "Authentication error."
        ),
        CONFIG_ERROR(
            keywords = listOf("api key", "secret", "credential"),
            isRetryable = false,
            userMessage = "Configuration error."
        );

        /**
         * メッセージがこのカテゴリにマッチするか判定
         */
        fun matches(message: String): Boolean {
            val lowerMessage = message.lowercase()
            return keywords.any { lowerMessage.contains(it) }
        }

        companion object {
            /**
             * メッセージに最初にマッチするカテゴリを検索
             * enum の定義順序で優先度が決まる
             */
            fun findCategory(message: String): ErrorCategory? {
                return entries.firstOrNull { it.matches(message) }
            }
        }
    }

    override fun isRetryableError(exception: Exception): Boolean {
        val message = exception.message ?: return false
        return ErrorCategory.findCategory(message)?.isRetryable ?: false
    }

    override fun sanitizeErrorMessage(message: String?): String {
        if (message == null) return "Unknown error"
        return ErrorCategory.findCategory(message)?.userMessage ?: "Email delivery failed."
    }
}
```

### Enum戦略パターンの利点

| 利点 | 説明 |
|------|------|
| **DRY（Don't Repeat Yourself）** | キーワード、リトライ可否、メッセージを1箇所で管理 |
| **OCP（Open/Closed Principle）** | 新しいエラーカテゴリはenumに追加するだけ |
| **優先度の明確化** | enumの定義順で優先度が決まり、コードで意図が明確 |
| **型安全** | コンパイル時にすべてのカテゴリが網羅されていることを保証 |
| **テスト容易性** | 各カテゴリを個別にテスト可能 |

---

## 4. 指数バックオフ戦略の実装

### 実装

```kotlin
@Component
class ExponentialBackoffRetryPolicy : EmailRetryPolicy {

    override fun calculateBackoffDelay(attemptIndex: Int): Long {
        // 2^attemptIndex * 1000ms (1秒, 2秒, 4秒, 8秒...)
        val baseDelay = 1000L * (1 shl attemptIndex)
        // ジッターを追加（最大1秒）
        val jitter = Random.nextLong(0, 1000)
        return baseDelay + jitter
    }
}
```

### バックオフ計算の可視化

```
attemptIndex │ baseDelay │ jitter (0-1000ms) │ totalDelay
─────────────┼───────────┼───────────────────┼────────────
     0       │   1000ms  │    0-1000ms       │  1000-2000ms
     1       │   2000ms  │    0-1000ms       │  2000-3000ms
     2       │   4000ms  │    0-1000ms       │  4000-5000ms
     3       │   8000ms  │    0-1000ms       │  8000-9000ms
```

### なぜジッターが必要か？

**Thundering Herd Problem（雷鳴の群れ問題）** を防ぐため：

```
❌ ジッターなし: 全リクエストが同時にリトライ
  Time ─────────────────────────────────────>
  Req1: ────●────────●────────●
  Req2: ────●────────●────────●
  Req3: ────●────────●────────●
              ↑        ↑        ↑
           同時アクセスでサーバー過負荷

✅ ジッターあり: リトライが分散
  Time ─────────────────────────────────────>
  Req1: ────●──────────●────────────●
  Req2: ──────●──────────●────────────●
  Req3: ────────●──────────●────────────●
              分散してサーバー負荷を軽減
```

---

## 5. 入力バリデーションとフェイルファスト

### Before: バリデーションなし

```kotlin
// ❌ 負の値が渡されると予期しない動作
fun emitMetrics(sentCount: Int, failedCount: Int, executionTimeMillis: Long) {
    cloudWatchMetricsHelper.putEmailMetrics(sentCount, failedCount, executionTimeMillis)
}
```

### After: require() によるフェイルファスト

```kotlin
override fun emitMetrics(sentCount: Int, failedCount: Int, executionTimeMillis: Long) {
    // 前提条件を明示的に検証
    require(sentCount >= 0) { "sentCount must be non-negative, but was $sentCount" }
    require(failedCount >= 0) { "failedCount must be non-negative, but was $failedCount" }
    require(executionTimeMillis >= 0) { "executionTimeMillis must be non-negative, but was $executionTimeMillis" }

    try {
        cloudWatchMetricsHelper.putEmailMetrics(sentCount, failedCount, executionTimeMillis)
        logger.info { "CloudWatch metrics emitted: sent=$sentCount, failed=$failedCount" }
    } catch (e: Exception) {
        // メトリクス送信失敗はログのみ（メール送信は成功しているため）
        logger.warn(e) { "Failed to emit CloudWatch metrics" }
    }
}
```

### Kotlin の require() vs check() vs assert()

| 関数 | 用途 | 例外 |
|------|------|------|
| `require()` | 引数のバリデーション | `IllegalArgumentException` |
| `check()` | 状態のバリデーション | `IllegalStateException` |
| `assert()` | 開発時のデバッグ用 | `AssertionError` |

---

## 6. 後方互換性の維持: Deprecation戦略

### 段階的な移行パス

既存のテストやコードを壊さずに移行するため、 **deprecated メソッド** を残しつつ新しいインターフェースに委譲しました。

```kotlin
@Service
class EmailSchedulerService(
    // ...
    private val emailErrorClassifier: EmailErrorClassifier,
    private val emailRetryPolicy: EmailRetryPolicy,
    private val emailSchedulerMetrics: EmailSchedulerMetrics,
) {
    // 新しいコードはインターフェースを直接使用

    // 既存コードとの互換性のため deprecated メソッドを残す
    @Deprecated(
        message = "Use EmailRetryPolicy instead. Will be removed in version 2.0.0",
        replaceWith = ReplaceWith("emailRetryPolicy.calculateBackoffDelay(attemptIndex)"),
        level = DeprecationLevel.WARNING
    )
    internal fun calculateBackoffDelay(attemptIndex: Int): Long {
        return emailRetryPolicy.calculateBackoffDelay(attemptIndex)
    }

    @Deprecated(
        message = "Use EmailErrorClassifier instead. Will be removed in version 2.0.0",
        replaceWith = ReplaceWith("emailErrorClassifier.isRetryableError(exception)"),
        level = DeprecationLevel.WARNING
    )
    internal fun isRetryableError(exception: Exception): Boolean {
        return emailErrorClassifier.isRetryableError(exception)
    }

    // ... 他の deprecated メソッド
}
```

### Kotlinの@Deprecatedアノテーション

```kotlin
@Deprecated(
    message = "移行先の説明",                              // IDEで表示されるメッセージ
    replaceWith = ReplaceWith("新しいコード"),            // 自動置換の候補
    level = DeprecationLevel.WARNING                      // WARNING/ERROR/HIDDEN
)
```

| Level | 効果 |
|-------|------|
| `WARNING` | コンパイル警告（使用可能） |
| `ERROR` | コンパイルエラー（使用不可） |
| `HIDDEN` | 自動補完から除外（バイナリ互換のみ） |

---

## 7. テスト戦略

### 7.1 モックから実装への移行

**Before**: テストで実装ロジックを重複

```kotlin
// ❌ モックで実装を再現（DRY違反）
@BeforeEach
fun setup() {
    mockEmailErrorClassifier = mockk(relaxed = true)

    // isRetryableError のモック設定（実装の重複）
    every { mockEmailErrorClassifier.isRetryableError(any()) } answers {
        val exception = firstArg<Exception>()
        val message = exception.message?.lowercase() ?: return@answers false
        message.contains("429") ||
        message.contains("rate limit") ||
        message.contains("timeout")
        // ... 30行以上のモック設定
    }
}
```

**After**: 実装クラスを直接使用

```kotlin
// ✅ 実装クラスを使用（モックの重複排除）
@BeforeEach
fun setup() {
    // 実装クラスを使用することで、モックとの重複を解消
    emailErrorClassifier = DefaultEmailErrorClassifier()

    service = EmailSchedulerService(
        // ...
        emailErrorClassifier = emailErrorClassifier,
        // ...
    )
}
```

### 7.2 エッジケーステスト

```kotlin
@Nested
@DisplayName("エッジケース")
inner class EdgeCaseTest {

    @Test
    @DisplayName("空文字列は一般的なエラーメッセージに変換される")
    fun `空文字列は一般的なエラーメッセージに変換される`() {
        val result = classifier.sanitizeErrorMessage("")
        assertEquals("Email delivery failed.", result)
    }

    @Test
    @DisplayName("非常に長いエラーメッセージでも正しく処理される")
    fun `非常に長いエラーメッセージでも正しく処理される`() {
        val longPrefix = "A".repeat(1000)
        val longMessage = "$longPrefix timeout occurred in the system"

        val result = classifier.sanitizeErrorMessage(longMessage)

        assertEquals("Request timed out. Will retry later.", result)
    }

    @Test
    @DisplayName("複数のキーワードを含む場合は最初にマッチしたカテゴリが優先される")
    fun `複数のキーワードを含む場合は最初にマッチしたカテゴリが優先される`() {
        // RATE_LIMIT は TIMEOUT より先に定義されている
        val message = "Error 429: rate limit - timeout occurred"

        val result = classifier.sanitizeErrorMessage(message)

        assertEquals("Rate limit exceeded. Will retry later.", result)
    }

    @Test
    @DisplayName("Unicode文字を含むメッセージでも正しく処理される")
    fun `Unicode文字を含むメッセージでも正しく処理される`() {
        val message = "エラー: timeout が発生しました 🚫"

        val result = classifier.sanitizeErrorMessage(message)

        assertEquals("Request timed out. Will retry later.", result)
    }
}
```

---

## 8. CloudWatchメトリクスの設計

### インターフェースドキュメント

```kotlin
/**
 * メール送信スケジューラのメトリクス発行を担当するインターフェース
 *
 * ## CloudWatch Metrics Schema
 *
 * CDK 側では以下のカスタムメトリクスを期待しています:
 *
 * - **Namespace**: `novasell-one/email-scheduler`
 * - **Metrics**:
 *   - `email-sent` (Count): 送信成功件数
 *   - `email-failed` (Count): 送信失敗件数
 *   - `email-delivery-latency` (Milliseconds, Average): 実行時間
 *
 * ## Implementation Note
 *
 * メトリクス送信失敗はメール送信処理に影響を与えません。
 * 実装はエラーをログ出力のみで処理することを推奨します。
 */
interface EmailSchedulerMetrics {
    fun emitMetrics(sentCount: Int, failedCount: Int, executionTimeMillis: Long)
}
```

### インフラとの連携

CDK側のアラート設定と連携:

```typescript
// CDK (TypeScript)
const emailFailedAlarm = new cloudwatch.Alarm(this, 'EmailFailedAlarm', {
  metric: new cloudwatch.Metric({
    namespace: 'novasell-one/email-scheduler',
    metricName: 'email-failed',
    statistic: 'Sum',
    period: Duration.minutes(5),
  }),
  threshold: 10,
  evaluationPeriods: 1,
  alarmDescription: 'メール送信失敗が閾値を超えました',
});
```

---

## 9. リファクタリングの成果

### Before vs After 比較

| 指標 | Before | After | 改善 |
|------|--------|-------|------|
| EmailSchedulerService の責務数 | 5+ | 1（オーケストレーションのみ） | ✅ SRP達成 |
| 直接的な外部依存 | CloudWatchMetricsHelper | インターフェースのみ | ✅ DIP達成 |
| キーワードリストの重複 | 2箇所 | 1箇所（enum） | ✅ DRY達成 |
| テストの複雑さ | モックで実装を再現 | 実装クラスを直接使用 | ✅ 簡素化 |
| 新エラーカテゴリ追加時の変更箇所 | 2箇所以上 | enumに1エントリ追加 | ✅ OCP達成 |

### クラス図

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EmailSchedulerService                        │
│─────────────────────────────────────────────────────────────────────│
│ - emailService: EmailService                                         │
│ - emailDeliveryRepository: EmailDeliveryRepository                   │
│ - emailErrorClassifier: EmailErrorClassifier          ◄── interface │
│ - emailRetryPolicy: EmailRetryPolicy                  ◄── interface │
│ - emailSchedulerMetrics: EmailSchedulerMetrics        ◄── interface │
│─────────────────────────────────────────────────────────────────────│
│ + sendScheduledEmails(): EmailDeliveryResult                         │
│ + fetchPendingProposalEmails(): List<ProposalEmailRequest>           │
└─────────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐
│EmailErrorClassi-│    │EmailRetryPolicy │    │EmailSchedulerMetrics│
│fier (interface) │    │   (interface)   │    │     (interface)     │
└────────┬────────┘    └────────┬────────┘    └──────────┬──────────┘
         │                      │                        │
         ▼                      ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐
│DefaultEmail     │    │ExponentialBack- │    │CloudWatchEmail      │
│ErrorClassifier  │    │offRetryPolicy   │    │SchedulerMetrics     │
│─────────────────│    │─────────────────│    │─────────────────────│
│ - ErrorCategory │    │                 │    │ - cloudWatchMetrics │
│   (enum)        │    │                 │    │   Helper            │
└─────────────────┘    └─────────────────┘    └─────────────────────┘
```

---

## 10. 学んだ教訓

### 1. 小さく始めて段階的に

一度にすべてをリファクタリングするのではなく、deprecated メソッドを残しながら段階的に移行することで、リスクを最小化できました。

### 2. テストが安全網

既存のテストがあったため、リファクタリング中に振る舞いが変わっていないことを継続的に確認できました。

### 3. Enumは強力なツール

Kotlinのenumはプロパティとメソッドを持てるため、戦略パターンを簡潔に実装できます。

### 4. インターフェースは契約

インターフェースのKDocにメトリクスのスキーマを明記することで、CDKチームとの連携がスムーズになりました。

### 5. 自動レビューサイクルの効果

コードレビュー → 修正 → 再レビューのサイクルを自動化することで、見落としがちな問題（未使用import、バリデーション不足など）を効率的に検出・修正できました。

---

## まとめ

SOLID原則は理論として学ぶだけでなく、実際のコードに適用することで真価を発揮します。今回のリファクタリングでは：

1. **SRP**: 1つのクラスに集中していた責務を4つのインターフェースに分離
2. **OCP**: enum戦略パターンにより、新しいエラーカテゴリの追加が容易に
3. **LSP**: 各実装クラスはインターフェースの契約を忠実に履行
4. **ISP**: 各インターフェースは必要最小限のメソッドのみを定義
5. **DIP**: サービスは抽象（インターフェース）にのみ依存

これらの原則を適用することで、 **テスタビリティ** 、 **保守性** 、 **拡張性** が大幅に向上しました。

---

## 参考資料

- [Clean Architecture by Robert C. Martin](https://www.amazon.com/Clean-Architecture-Craftsmans-Software-Structure/dp/0134494164)
- [Kotlin Coding Conventions](https://kotlinlang.org/docs/coding-conventions.html)
- [Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/docs/current/reference/html/)
- [Effective Kotlin by Marcin Moskala](https://leanpub.com/effectivekotlin)
