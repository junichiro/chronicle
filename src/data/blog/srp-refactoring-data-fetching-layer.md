---
author: junichiro
pubDatetime: 2026-01-09T11:12:31+09:00
title: SRP実践：データ取得ロジックの分離とトランザクション設計
slug: srp-refactoring-data-fetching-layer
featured: false
draft: false
tags:
  - kotlin
  - spring-boot
  - refactoring
  - srp
  - clean-architecture
description: メール送信スケジューラを例に、単一責任の原則（SRP）を適用してデータ取得ロジックを分離するリファクタリングを解説。Springのトランザクション伝播や例外処理戦略についても実践的に学べます。
---

## はじめに

「このサービスクラス、テストが書きにくいな...」
「データ取得のロジックと送信のロジックが混在していて、どこを修正すればいいかわからない...」

こんな経験はありませんか？

今回は、メール送信スケジューラを例に、**単一責任の原則（SRP）** を適用してデータ取得ロジックを分離するリファクタリングを解説します。さらに、Spring の **トランザクション伝播** や **例外処理戦略** についても実践的に学べます。

### この記事で学べること

- SRP（単一責任の原則）の実践的な適用方法
- インターフェース抽出によるテスタビリティの向上
- Spring の `@Transactional` と `Propagation.REQUIRES_NEW` の使い分け
- 堅牢な例外処理戦略の設計
- Kotlin のコールバックパターンとその設計上の注意点

### 対象読者

- Kotlin/Spring Boot でバックエンド開発をしている方
- SOLID原則を実際のコードに適用したい方
- トランザクション管理の理解を深めたい方
- テストしやすいコードの書き方を学びたい方

---

## 1. リファクタリング前の問題

### 1.1 元のコードの構造

メール送信スケジューラのサービスクラスを考えてみましょう。このクラスは以下の責務を持っていました：

```kotlin
@Service
class EmailSchedulerService(
    private val emailService: EmailService,
    private val emailDeliveryRepository: EmailDeliveryRepository,
    private val proposalRepository: ProposalRepository,  // データ取得用
    private val timeProvider: TimeProvider,
    private val emailErrorClassifier: EmailErrorClassifier,
    private val emailRetryPolicy: EmailRetryPolicy,
    private val emailSchedulerMetrics: EmailSchedulerMetrics,
    @param:Value("\${email.scheduler.parallel-count:1}") private val maxConcurrentRequests: Int,
    @param:Value("\${email.scheduler.delay-between-requests-ms:1000}") private val delayBetweenRequestsMs: Long,
    @param:Value("\${email.scheduler.max-retry-attempts:3}") private val maxRetryAttempts: Int,
    @param:Value("\${email.scheduler.batch-size:100}") private val batchSize: Int  // ← データ取得の設定
) {
    /**
     * スケジュールされたメールを送信する
     */
    fun sendScheduledEmails(): EmailDeliveryResult {
        // 責務1: ペンディング状態のメール情報を取得
        val pendingEmails = fetchPendingProposalEmails()

        // 責務2: メールを並列送信
        val results = sendEmailsInParallel(pendingEmails)

        // 責務3: 結果を集約してメトリクスを発行
        return aggregateResults(results)
    }

    /**
     * ペンディング状態の提案メール情報を取得
     *
     * ❌ 問題: 以下の複雑なロジックがサービスに埋め込まれている
     * - DBからの排他ロック付きレコード取得
     * - PostgreSQL/SQLite のDB互換性対応
     * - Proposal との結合処理
     * - URL判定ロジック
     * - 日付フォーマット
     */
    @Transactional
    fun fetchPendingProposalEmails(): List<PendingEmailInfo> {
        val now = timeProvider.nowInJst()

        // 並行実行保護（PostgreSQL: FOR UPDATE SKIP LOCKED）
        val pendingRecords = try {
            emailDeliveryRepository.findScheduledForDeliveryWithLock(
                status = EmailDeliveryStatus.PENDING.name,
                now = now,
                limit = batchSize
            )
        } catch (e: Exception) {
            // SQLite など FOR UPDATE SKIP LOCKED がサポートされない場合
            logger.warn { "Locked query not supported, falling back: ${e.message}" }
            emailDeliveryRepository.findScheduledForDelivery(
                status = EmailDeliveryStatus.PENDING,
                now = now,
                pageable = Pageable.ofSize(batchSize)
            ).content
        }

        // N+1 問題を回避するためにバッチフェッチ
        val proposalIds = pendingRecords.map { it.proposalId }
        val proposals = proposalRepository.findAllById(proposalIds).associateBy { it.id }

        // Proposal との結合処理
        return pendingRecords.mapNotNull { record ->
            proposals[record.proposalId]?.let { proposal ->
                val documentUrl = proposal.signedDownloadUrl ?: proposal.s3Url

                if (documentUrl.isNullOrBlank()) {
                    logger.warn { "No document URL for proposal ${proposal.id}" }
                    updateRecordAsFailed(record.id, "No document URL")
                    return@mapNotNull null
                }

                // URL パターン判定
                val isHtmlProposal = isHtmlProposalUrl(documentUrl)
                val fileName = if (isHtmlProposal) "index.html" else "proposal.pptx"

                // 有効期限フォーマット
                val expiresAtFormatted = proposal.expiresAt?.let { formatExpirationDate(it) }

                // リクエストオブジェクトの構築
                ProposalEmailRequest(
                    proposalId = proposal.id,
                    recipientEmail = proposal.userEmail,
                    // ... 他のフィールド
                )
            } ?: run {
                updateRecordAsFailed(record.id, "Proposal not found")
                null
            }
        }
    }

    /**
     * HTML 提案資料の URL かどうかを判定
     */
    internal fun isHtmlProposalUrl(url: String): Boolean {
        return url.contains("/proposals/") && !url.endsWith(".pptx") && !url.endsWith(".pdf")
    }

    /**
     * 有効期限を日本語フォーマットに変換
     */
    internal fun formatExpirationDate(expiresAt: LocalDateTime): String {
        val formatter = DateTimeFormatter.ofPattern("yyyy年M月d日", Locale.JAPANESE)
        return expiresAt.format(formatter)
    }

    // ... 他のメソッド（メール送信、リトライ、メトリクス発行など）
}
```

### 1.2 何が問題なのか？

#### 問題1: コンストラクタ引数が多すぎる（10個）

```kotlin
class EmailSchedulerService(
    private val emailService: EmailService,
    private val emailDeliveryRepository: EmailDeliveryRepository,
    private val proposalRepository: ProposalRepository,  // ← データ取得用
    private val timeProvider: TimeProvider,
    private val emailErrorClassifier: EmailErrorClassifier,
    private val emailRetryPolicy: EmailRetryPolicy,
    private val emailSchedulerMetrics: EmailSchedulerMetrics,
    private val maxConcurrentRequests: Int,
    private val delayBetweenRequestsMs: Long,
    private val maxRetryAttempts: Int,
    private val batchSize: Int  // ← データ取得用
)
```

> **経験則**: コンストラクタ引数が7個を超えたら、クラスの責務を見直すサイン

#### 問題2: 1つのクラスが複数の責務を持つ（SRP違反）

`EmailSchedulerService` が担当していた責務：

| # | 責務 | 変更理由の例 |
|---|------|-------------|
| 1 | ペンディングメールの取得 | DBスキーマ変更、新しいフィルタ条件追加 |
| 2 | Proposal との結合・変換 | Proposal の構造変更 |
| 3 | URL パターン判定 | 新しい提案資料形式の追加 |
| 4 | メール送信の並列実行 | 並列度の調整、レート制限対応 |
| 5 | リトライ処理 | リトライ戦略の変更 |
| 6 | 結果集約とメトリクス発行 | メトリクス項目の追加 |

> **単一責任の原則（SRP）**: クラスを変更する理由は1つだけであるべき

「DBクエリを変えたい」と「メール送信の並列度を変えたい」という異なる理由で、同じクラスを修正することになります。

#### 問題3: 例外処理が雑

```kotlin
} catch (e: Exception) {  // ← すべての例外をキャッチ
    logger.warn { "Locked query not supported, falling back: ${e.message}" }
    // ...
}
```

`Exception` をキャッチすると：
- 接続エラー、タイムアウト、デッドロックなど、本来は上位に伝播すべきエラーも握りつぶす
- 原因の特定が困難になる
- 予期しない動作の原因になる

#### 問題4: テストが難しい

データ取得ロジックをテストするために、`EmailSchedulerService` 全体をセットアップする必要があります。

```kotlin
@Test
fun `URL判定のテスト`() {
    // ❌ URL判定だけをテストしたいのに、サービス全体が必要
    val service = EmailSchedulerService(
        emailService = mockk(),
        emailDeliveryRepository = mockk(),
        proposalRepository = mockk(),
        timeProvider = mockk(),
        emailErrorClassifier = mockk(),
        emailRetryPolicy = mockk(),
        emailSchedulerMetrics = mockk(),
        maxConcurrentRequests = 1,
        delayBetweenRequestsMs = 1000,
        maxRetryAttempts = 3,
        batchSize = 100
    )

    assertTrue(service.isHtmlProposalUrl("https://example.com/proposals/2025/01/"))
}
```

---

## 2. リファクタリングの設計

### 2.1 分離する責務の特定

まず、「変更理由」に基づいて責務を整理します：

```
EmailSchedulerService の現在の責務:
├── データ取得層（変更理由: DB、クエリ、結合ロジック）
│   ├── ペンディングレコードの取得
│   ├── 並行実行保護（FOR UPDATE SKIP LOCKED）
│   ├── Proposal との結合
│   ├── URL パターン判定
│   └── 日付フォーマット
│
└── 送信・制御層（変更理由: 送信、リトライ、メトリクス）
    ├── メール送信の並列実行
    ├── リトライ処理
    └── 結果集約とメトリクス発行
```

今回は **データ取得層** を `PendingEmailFetcher` として分離します。

### 2.2 インターフェース設計

```kotlin
/**
 * ペンディング状態のメール情報を取得するインターフェース
 *
 * 責務:
 * - EmailDeliveryRecord の PENDING 状態で、送信予定時刻が現在時刻以前のものを取得
 * - 対応する Proposal 情報と結合して ProposalEmailRequest に変換
 * - 並行実行保護（PostgreSQL FOR UPDATE SKIP LOCKED）
 */
interface PendingEmailFetcher {
    /**
     * ペンディング状態の提案メール情報を取得
     *
     * @param onRecordFailed レコード取得失敗時のコールバック
     * @return メール送信リクエストのリスト
     */
    fun fetchPending(onRecordFailed: (String, String) -> Unit): List<PendingEmailInfo>
}
```

### 2.3 なぜコールバックパターンを使うのか？

データ取得中に「Proposal が見つからない」「URL がない」などのエラーが発生した場合、そのレコードを「失敗」状態に更新する必要があります。

**選択肢1: 呼び出し側で失敗を処理**
```kotlin
// ❌ 問題: フェッチ結果に失敗情報が混在
sealed class FetchResult {
    data class Success(val info: PendingEmailInfo) : FetchResult()
    data class Failure(val recordId: String, val reason: String) : FetchResult()
}

val results = fetcher.fetchPending()
results.filterIsInstance<Failure>().forEach { failure ->
    // 呼び出し側で失敗処理
    updateRecordAsFailed(failure.recordId, failure.reason)
}
```

**選択肢2: コールバックで失敗を通知**
```kotlin
// ✅ フェッチャーが失敗を検知した時点で通知
val pendingEmails = fetcher.fetchPending { recordId, errorMessage ->
    updateRecordAsFailed(recordId, errorMessage)
}
// pendingEmails には成功したものだけが含まれる
```

コールバックパターンを選んだ理由：
1. **即時処理**: 失敗を検知した時点で即座に DB 更新できる
2. **シンプルな戻り値**: 成功したレコードだけを返せる
3. **柔軟性**: 呼び出し側が失敗時の処理を決められる

---

## 3. トランザクション設計

### 3.1 トランザクションの問題

ここで重要な設計判断があります。`fetchPending()` は `@Transactional` で実行されますが、その中から呼ばれるコールバックも同じトランザクションに含まれます。

```kotlin
@Transactional
fun fetchPending(onRecordFailed: (String, String) -> Unit): List<PendingEmailInfo> {
    // トランザクション開始

    val records = fetchRecords()

    records.forEach { record ->
        if (isInvalid(record)) {
            onRecordFailed(record.id, "Invalid record")  // ← 同じトランザクション内
        }
    }

    // トランザクションコミット（または例外でロールバック）
}
```

**問題**: `fetchPending()` の途中で例外が発生すると、すべての変更（`onRecordFailed` による更新も含む）がロールバックされます。

### 3.2 REQUIRES_NEW による独立トランザクション

解決策として、コールバック側で `Propagation.REQUIRES_NEW` を使用します：

```kotlin
/**
 * EmailDeliveryRecord を送信失敗状態に更新
 *
 * 注: REQUIRES_NEW を使用して、呼び出し元のトランザクションとは独立したトランザクションで実行。
 * これにより、PendingEmailFetcher のトランザクション内から呼び出されても安全に更新できる。
 */
@Transactional(propagation = Propagation.REQUIRES_NEW)
fun updateRecordAsFailed(recordId: String, errorMessage: String) {
    val record = emailDeliveryRepository.findById(recordId).getOrNull() ?: return
    record.markAsFailed(errorMessage, SCHEDULER_IDENTIFIER)
    emailDeliveryRepository.save(record)
}
```

### 3.3 トランザクション伝播の動作

```
┌─────────────────────────────────────────────────────────────────┐
│  fetchPending() のトランザクション                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. レコード取得                                         │   │
│  │  2. Proposal 結合                                        │   │
│  │  3. バリデーション                                       │   │
│  │     └─→ onRecordFailed() 呼び出し                       │   │
│  │         ┌────────────────────────────────────┐          │   │
│  │         │  REQUIRES_NEW トランザクション      │          │   │
│  │         │  updateRecordAsFailed()            │          │   │
│  │         │  → 即座にコミット                  │          │   │
│  │         └────────────────────────────────────┘          │   │
│  │  4. 結果を返す                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│  → コミット（または例外でロールバック）                         │
└─────────────────────────────────────────────────────────────────┘
```

**この設計のメリット**:

| メリット | 説明 |
|----------|------|
| 部分的な障害の追跡 | フェッチ全体が失敗しても、どのレコードで問題が発生したか把握できる |
| 失敗記録の保持 | 親トランザクションがロールバックしても、失敗の記録は残る |
| リトライの安全性 | 後続のリトライ時に同じレコードを再処理しない |

### 3.4 インターフェースでのドキュメント

この設計判断はインターフェースの KDoc で明確にドキュメント化します：

```kotlin
interface PendingEmailFetcher {
    /**
     * ペンディング状態の提案メール情報を取得
     *
     * ## トランザクション動作
     * このメソッドは `@Transactional` で実行されます。
     * `onRecordFailed` コールバックは、このトランザクション内から呼び出されます。
     *
     * **重要**: コールバック実装では `Propagation.REQUIRES_NEW` を使用することを推奨します。
     * これにより、失敗レコードの更新は即座にコミットされ、メインのフェッチ操作が
     * ロールバックされても失敗記録は保持されます。
     *
     * この設計により:
     * - 部分的な障害でも失敗レコードの追跡が可能
     * - フェッチ全体が失敗しても、どのレコードで問題が発生したか把握できる
     * - 後続のリトライ時に同じレコードを再処理しない
     *
     * @param onRecordFailed レコード取得失敗時のコールバック（recordId, errorMessage）。
     *                       REQUIRES_NEW トランザクションで実行されることを想定。
     * @return メール送信リクエストとレコードのペアのリスト
     */
    fun fetchPending(onRecordFailed: (String, String) -> Unit): List<PendingEmailInfo>
}
```

> **教訓**: インターフェースには「何を」だけでなく「どう使うべきか」も明記する

---

## 4. 例外処理戦略

### 4.1 問題: 広すぎる例外キャッチ

元のコード：
```kotlin
} catch (e: Exception) {
    // ❌ すべての例外をキャッチ
    logger.warn { "Locked query not supported, falling back: ${e.message}" }
    fallbackToRegularQuery(now)
}
```

### 4.2 解決: 具体的な例外型でキャッチ

```kotlin
/**
 * 並行実行保護付きでペンディングレコードを取得
 *
 * 例外処理戦略:
 * - SQLFeatureNotSupportedException: ロック機能非対応 → フォールバック
 * - BadSqlGrammarException: SQL構文非対応 → フォールバック
 * - DataAccessException: その他のDB関連エラー → フォールバック（ログでエラーレベル）
 * - その他の例外: 上位に伝播（重大なシステムエラー）
 */
private fun fetchPendingRecordsWithConcurrencyProtection(
    now: LocalDateTime
): List<EmailDeliveryRecord> {
    return try {
        // PostgreSQL: FOR UPDATE SKIP LOCKED でロックを取得
        emailDeliveryRepository.findScheduledForDeliveryWithLock(
            status = EmailDeliveryStatus.PENDING.name,
            now = now,
            limit = batchSize
        )
    } catch (e: SQLFeatureNotSupportedException) {
        // JDBC ドライバがロック機能をサポートしていない場合（SQLite など）
        logger.warn { "Database lock feature not supported (likely SQLite): ${e.message}" }
        fallbackToRegularQuery(now)
    } catch (e: BadSqlGrammarException) {
        // FOR UPDATE SKIP LOCKED 構文がサポートされていない場合
        logger.warn { "SQL syntax not supported for locking: ${e.message}" }
        fallbackToRegularQuery(now)
    } catch (e: DataAccessException) {
        // その他のデータベースアクセスエラー（タイムアウト、デッドロック等）
        logger.error(e) { "Database error during locked query, falling back: ${e.message}" }
        fallbackToRegularQuery(now)
    }
    // 注: DataAccessException 以外の例外は上位に伝播させる
}
```

### 4.3 例外処理の階層

```
                    Exception
                        │
                RuntimeException
                        │
          ┌─────────────┼─────────────┐
          │             │             │
    DataAccessException │       IllegalStateException
          │             │          (上位に伝播)
    ┌─────┴─────┐       │
    │           │       │
BadSqlGrammar  QueryTimeout
Exception      Exception
(フォールバック) (フォールバック)

java.sql.SQLException
          │
SQLFeatureNotSupportedException
    (フォールバック)
```

### 4.4 ログレベルの使い分け

| 例外 | ログレベル | 理由 |
|------|------------|------|
| `SQLFeatureNotSupportedException` | `warn` | 想定内（SQLite 開発環境） |
| `BadSqlGrammarException` | `warn` | 想定内（DB 互換性） |
| `DataAccessException` | `error` | 想定外（調査が必要） |
| その他 | 上位に伝播 | システムエラー（即座に対応が必要） |

---

## 5. 実装の詳細

### 5.1 DefaultPendingEmailFetcher の完全な実装

```kotlin
@Component
class DefaultPendingEmailFetcher(
    private val emailDeliveryRepository: EmailDeliveryRepository,
    private val proposalRepository: ProposalRepository,
    private val emailService: EmailService,
    private val timeProvider: TimeProvider,
    @param:Value("\${email.scheduler.batch-size:100}") private val batchSize: Int = 100
) : PendingEmailFetcher {

    companion object {
        /** HTML 提案資料の URL パスパターン */
        private const val HTML_PROPOSAL_PATH_PATTERN = "/proposals/"
        /** 除外するファイル拡張子 */
        private val EXCLUDED_EXTENSIONS = setOf(".pptx", ".pdf")
    }

    init {
        require(batchSize > 0) { "batchSize must be positive, but was $batchSize" }
    }

    @Transactional
    override fun fetchPending(onRecordFailed: (String, String) -> Unit): List<PendingEmailInfo> {
        logger.info { "Fetching pending email deliveries from database" }

        val now = timeProvider.nowInJst()
        val pendingRecords = fetchPendingRecordsWithConcurrencyProtection(now)

        logger.info { "Found ${pendingRecords.size} pending email delivery records" }

        if (pendingRecords.isEmpty()) {
            return emptyList()
        }

        // N+1 問題を回避するために Proposal をバッチフェッチ
        val proposalIds = pendingRecords.map { it.proposalId }
        val proposals = proposalRepository.findAllById(proposalIds).associateBy { it.id }

        return pendingRecords.mapNotNull { record ->
            proposals[record.proposalId]?.let { proposal ->
                buildPendingEmailInfo(record, proposal, onRecordFailed)
            } ?: run {
                logger.warn { "Proposal not found for record ${record.id}" }
                onRecordFailed(record.id, "Associated proposal not found")
                null
            }
        }
    }

    private fun buildPendingEmailInfo(
        record: EmailDeliveryRecord,
        proposal: Proposal,
        onRecordFailed: (String, String) -> Unit
    ): PendingEmailInfo? {
        val documentUrl = proposal.signedDownloadUrl ?: proposal.s3Url

        if (documentUrl.isNullOrBlank()) {
            logger.warn { "Proposal ${proposal.id} has no document URL" }
            onRecordFailed(record.id, "Proposal has no document URL available for delivery")
            return null
        }

        val isHtmlProposal = isHtmlProposalUrl(documentUrl)
        val proposalFileName = if (isHtmlProposal) "index.html" else "proposal.pptx"
        val expiresAtFormatted = proposal.expiresAt?.let { formatExpirationDate(it) }

        val request = ProposalEmailRequest(
            proposalId = proposal.id,
            recipientEmail = proposal.userEmail,
            contactName = emailService.sanitizeContactName(proposal.userContactName),
            companyName = emailService.sanitizeCompanyName(proposal.userCompanyName),
            proposalDocumentUrl = documentUrl,
            proposalFileName = proposalFileName,
            expiresAt = expiresAtFormatted,
            isHtmlProposal = isHtmlProposal
        )

        return PendingEmailInfo(record = record, request = request)
    }

    /**
     * HTML 提案資料の URL かどうかを判定
     *
     * URI パーシングを使用して、クエリパラメータやフラグメントがあっても
     * 正しく判定できるようにしている。
     */
    internal fun isHtmlProposalUrl(url: String): Boolean {
        val path = try {
            java.net.URI.create(url).path ?: return false
        } catch (e: IllegalArgumentException) {
            logger.warn { "Invalid URL format: $url" }
            return false
        }

        return path.contains(HTML_PROPOSAL_PATH_PATTERN) &&
            EXCLUDED_EXTENSIONS.none { path.endsWith(it) }
    }

    /**
     * 有効期限を日本語フォーマットに変換
     */
    internal fun formatExpirationDate(expiresAt: LocalDateTime): String {
        val formatter = DateTimeFormatter.ofPattern("yyyy年M月d日", Locale.JAPANESE)
        return expiresAt.format(formatter)
    }

    // ... fetchPendingRecordsWithConcurrencyProtection は前述の通り
}
```

### 5.2 リファクタリング後の EmailSchedulerService

```kotlin
@Service
class EmailSchedulerService(
    private val emailService: EmailService,
    private val emailDeliveryRepository: EmailDeliveryRepository,
    private val pendingEmailFetcher: PendingEmailFetcher,  // ← インターフェースに依存
    private val timeProvider: TimeProvider,
    private val emailErrorClassifier: EmailErrorClassifier,
    private val emailRetryPolicy: EmailRetryPolicy,
    private val emailSchedulerMetrics: EmailSchedulerMetrics,
    @param:Value("\${email.scheduler.parallel-count:1}") private val maxConcurrentRequests: Int,
    @param:Value("\${email.scheduler.delay-between-requests-ms:1000}") private val delayBetweenRequestsMs: Long,
    @param:Value("\${email.scheduler.max-retry-attempts:3}") private val maxRetryAttempts: Int
    // ❌ batchSize は削除（PendingEmailFetcher の責務）
    // ❌ proposalRepository は削除（PendingEmailFetcher の責務）
) {
    companion object {
        private const val SCHEDULER_IDENTIFIER = "email-scheduler"
    }

    fun sendScheduledEmails(): EmailDeliveryResult {
        logger.info { "Starting scheduled email sending process" }

        // データ取得は PendingEmailFetcher に委譲
        val pendingEmails = pendingEmailFetcher.fetchPending(::updateRecordAsFailed)

        // ... 以降は送信ロジックに集中
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun updateRecordAsFailed(recordId: String, errorMessage: String) {
        // ... 実装
    }
}
```

---

## 6. テストの改善

### 6.1 Before: テストが複雑

```kotlin
@Test
fun `URL判定のテスト`() {
    // ❌ サービス全体のセットアップが必要
    val service = EmailSchedulerService(
        emailService = mockk(),
        emailDeliveryRepository = mockk(),
        proposalRepository = mockk(),
        timeProvider = mockk(),
        // ... 7つ以上のモック
    )

    assertTrue(service.isHtmlProposalUrl("https://example.com/proposals/2025/01/"))
}
```

### 6.2 After: シンプルなテスト

```kotlin
@DisplayName("DefaultPendingEmailFetcher")
class DefaultPendingEmailFetcherTest {

    private lateinit var fetcher: DefaultPendingEmailFetcher

    @BeforeEach
    fun setup() {
        fetcher = DefaultPendingEmailFetcher(
            emailDeliveryRepository = mockk(relaxed = true),
            proposalRepository = mockk(relaxed = true),
            emailService = mockk(relaxed = true),
            timeProvider = mockk { every { nowInJst() } returns testNow },
            batchSize = 100
        )
    }

    @Nested
    @DisplayName("isHtmlProposalUrl - HTML 提案資料 URL 判定")
    inner class IsHtmlProposalUrlTest {

        @Test
        @DisplayName("CloudFront 経由の HTML 提案資料 URL を正しく判定する")
        fun `CloudFront URL is identified as HTML proposal`() {
            val htmlUrl = "https://proposals.example.com/proposals/2025/01/uuid-123/"
            assertTrue(fetcher.isHtmlProposalUrl(htmlUrl))
        }

        @Test
        @DisplayName("PPTX ファイルの URL は HTML 提案資料ではない")
        fun `PPTX URL is not HTML proposal`() {
            val pptxUrl = "https://s3.example.com/bucket/proposals/proposal.pptx"
            assertFalse(fetcher.isHtmlProposalUrl(pptxUrl))
        }

        @Test
        @DisplayName("クエリパラメータ付き URL も正しく判定できる")
        fun `URL with query parameters is handled correctly`() {
            val urlWithQuery = "https://example.com/proposals/2025/01/?token=abc123"
            assertTrue(fetcher.isHtmlProposalUrl(urlWithQuery))
        }

        @Test
        @DisplayName("無効な URL 形式は false を返す")
        fun `Invalid URL returns false`() {
            val invalidUrl = "not a valid url"
            assertFalse(fetcher.isHtmlProposalUrl(invalidUrl))
        }
    }
}
```

### 6.3 例外処理のテスト

```kotlin
@Nested
@DisplayName("並行実行保護の例外処理")
inner class ConcurrencyProtectionExceptionHandlingTest {

    @Test
    @DisplayName("BadSqlGrammarException 発生時は通常クエリにフォールバックする")
    fun `BadSqlGrammarException triggers fallback`() {
        // Given: ロック付きクエリが BadSqlGrammarException をスロー
        every {
            mockEmailDeliveryRepository.findScheduledForDeliveryWithLock(any(), any(), any())
        } throws BadSqlGrammarException("test", "SELECT FOR UPDATE", SQLException("Not supported"))

        // Given: フォールバッククエリは正常に動作
        every {
            mockEmailDeliveryRepository.findScheduledForDelivery(any(), any(), any())
        } returns PageImpl(listOf(record))

        // When
        val result = fetcher.fetchPending { _, _ -> }

        // Then: フォールバッククエリが使用される
        assertEquals(1, result.size)
        verify { mockEmailDeliveryRepository.findScheduledForDelivery(any(), any(), any()) }
    }

    @Test
    @DisplayName("DataAccessException 以外の例外は上位に伝播する")
    fun `Non-DataAccessException propagates to caller`() {
        // Given: 予期しない例外
        every {
            mockEmailDeliveryRepository.findScheduledForDeliveryWithLock(any(), any(), any())
        } throws IllegalStateException("Unexpected system error")

        // When & Then: 例外が伝播する
        assertThrows<IllegalStateException> {
            fetcher.fetchPending { _, _ -> }
        }

        // フォールバッククエリは呼び出されない
        verify(exactly = 0) {
            mockEmailDeliveryRepository.findScheduledForDelivery(any(), any(), any())
        }
    }
}
```

---

## 7. Before/After 比較

### 7.1 コンストラクタ引数の削減

| Service | Before | After | 削減 |
|---------|--------|-------|------|
| EmailSchedulerService | 10 | 7 | -3 (30%減) |
| 新規: PendingEmailFetcher | - | 5 | - |

### 7.2 責務の分離

```
Before:
┌─────────────────────────────────────────────┐
│           EmailSchedulerService              │
│  ┌─────────────────────────────────────┐    │
│  │ データ取得                           │    │
│  │ - ペンディングレコード取得          │    │
│  │ - 並行実行保護                      │    │
│  │ - Proposal との結合                 │    │
│  │ - URL パターン判定                  │    │
│  │ - 日付フォーマット                  │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ メール送信・制御                    │    │
│  │ - 並列送信                          │    │
│  │ - リトライ                          │    │
│  │ - メトリクス                        │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘

After:
┌─────────────────────────────────────────────┐
│           EmailSchedulerService              │
│  - メール送信のオーケストレーション          │
│  - 並列送信・リトライ・メトリクス            │
└───────────────────┬─────────────────────────┘
                    │ 依存
                    ▼
┌─────────────────────────────────────────────┐
│           PendingEmailFetcher                │
│           (interface)                        │
└───────────────────┬─────────────────────────┘
                    │ 実装
                    ▼
┌─────────────────────────────────────────────┐
│        DefaultPendingEmailFetcher            │
│  - ペンディングレコード取得                  │
│  - 並行実行保護                              │
│  - Proposal との結合                         │
│  - URL パターン判定                          │
│  - 日付フォーマット                          │
└─────────────────────────────────────────────┘
```

### 7.3 改善のまとめ

| 観点 | Before | After |
|------|--------|-------|
| 依存関係 | 具体クラスに直接依存 | インターフェースに依存 |
| 責務 | 1クラスに6つ以上 | 明確に分離 |
| テスト容易性 | 低い（モック複雑） | 高い（独立してテスト可能） |
| 例外処理 | 雑（Exception をキャッチ） | 精密（具体的な例外型） |
| トランザクション | 暗黙的 | 明示的にドキュメント化 |

---

## 8. まとめ

### 8.1 学んだ教訓

| 原則 | 実践 |
|------|------|
| **SRP** | 「このクラスを変更する理由は何個ある？」と自問する |
| **DIP** | 具体クラスではなくインターフェースに依存する |
| **例外処理** | `Exception` を広くキャッチせず、具体的な例外型で対応を分ける |
| **トランザクション** | 伝播戦略を明示的に設計し、ドキュメント化する |
| **テスタビリティ** | 責務を分離すれば、テストも自然とシンプルになる |

### 8.2 次のステップ

このリファクタリングで基盤ができました。今後は：

- 他のサービスクラスにも同様の原則を適用
- テストカバレッジの向上
- メトリクス（取得件数、実行時間、フォールバック使用率）の追加

### 8.3 チェックリスト

リファクタリングを検討する際のチェックリスト：

- [ ] コンストラクタ引数が7個を超えていないか？
- [ ] クラスを変更する理由が複数ないか？
- [ ] 例外処理で `Exception` を広くキャッチしていないか？
- [ ] トランザクションの伝播が明確にドキュメント化されているか？
- [ ] テストが独立して書けるか？

---

## 参考資料

- [Clean Architecture（Robert C. Martin）](https://www.amazon.co.jp/dp/4048930656)
- [Kotlin公式ドキュメント](https://kotlinlang.org/docs/home.html)
- [Spring Transaction Management](https://docs.spring.io/spring-framework/reference/data-access/transaction.html)
- [MockK - Kotlin Mocking Library](https://mockk.io/)

---

*この記事は実際のリファクタリング作業を元に作成しました。段階的な改善を繰り返すことで、テストしやすく保守性の高いコードに改善できました。*
