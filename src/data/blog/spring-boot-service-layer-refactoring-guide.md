---
author: junichiro
pubDatetime: 2026-01-08T21:36:03+09:00
title: Spring Boot サービス層リファクタリング実践ガイド
slug: spring-boot-service-layer-refactoring-guide
featured: false
draft: false
tags:
  - spring-boot
  - kotlin
  - refactoring
  - architecture
  - testing
description: トランザクション管理・例外処理・状態遷移を正しく設計する実践的なリファクタリング手法を解説
---

## はじめに

この記事では、Spring Boot アプリケーションのサービス層をリファクタリングする実践的な手法を解説します。

「動いているコードをなぜ変えるの?」と思う方もいるかもしれません。しかし、以下のような問題を抱えたコードは、機能追加やバグ修正の際に思わぬ問題を引き起こします：

- トランザクション境界が曖昧で、データ不整合が起きる可能性がある
- 例外処理が Controller と Service に分散していて、修正漏れが起きやすい
- `null` を返すメソッドが多く、呼び出し側で毎回 null チェックが必要
- テストで `relaxed = true` を使っていて、実際の動作と異なる可能性がある

この記事を読むと、以下のことができるようになります：

1. **@Transactional** の正しい使い方を理解する
2. **例外処理** を GlobalExceptionHandler に集約する
3. **状態遷移ロジック** をサービス層に一元化する
4. **null を返さない設計** に変更する
5. **テストの品質** を向上させる

---

## 1. リファクタリング前のコード

まず、典型的な「動いているけど問題のあるコード」を見てみましょう。

### Controller（リファクタリング前）

```kotlin
@RestController
@RequestMapping("/api/v1/documents")
class DocumentController(
    private val documentService: DocumentService
) {
    @GetMapping("/{documentId}/status")
    fun getDocumentStatus(
        @PathVariable documentId: String,
        @RequestAttribute("userId") userId: String
    ): ResponseEntity<DocumentStatusResponse> {
        // Service が null を返す可能性がある
        val document = documentService.getDocumentForUser(documentId, userId)
            ?: return ResponseEntity.notFound().build()  // 問題点①

        return ResponseEntity.ok(
            DocumentStatusResponse(
                id = document.id,
                status = document.status
            )
        )
    }

    @PostMapping("/{documentId}/status")
    fun updateDocumentStatus(
        @PathVariable documentId: String,
        @RequestBody request: UpdateStatusRequest
    ): ResponseEntity<Unit> {
        // Controller で状態遷移ロジックを実装している
        try {
            when (request.status) {  // 問題点②
                "PROCESSING" -> documentService.startProcessing(documentId)
                "COMPLETED" -> {
                    if (request.fileUrl == null) {
                        return ResponseEntity.badRequest().build()
                    }
                    documentService.completeDocument(documentId, request.fileUrl)
                }
                "FAILED" -> {
                    if (request.errorMessage == null) {
                        return ResponseEntity.badRequest().build()
                    }
                    documentService.failDocument(documentId, request.errorMessage)
                }
                else -> return ResponseEntity.badRequest().build()
            }
        } catch (e: IllegalStateException) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build()  // 問題点③
        }
        return ResponseEntity.ok().build()
    }
}
```

### Service（リファクタリング前）

```kotlin
@Service
class DocumentService(
    private val documentRepository: DocumentRepository
) {
    // @Transactional がない → 問題点④
    fun getDocumentForUser(documentId: String, userId: String): Document? {
        return documentRepository.findByIdAndUserId(documentId, userId)
        // null を返す → 問題点⑤
    }

    // @Transactional がない
    fun startProcessing(documentId: String) {
        val document = documentRepository.findById(documentId).orElse(null)
        if (document == null) {
            logger.warn { "Document not found: $documentId" }
            return  // 静かに失敗 → 問題点⑥
        }
        document.markAsProcessing()
        documentRepository.save(document)
    }

    fun completeDocument(documentId: String, fileUrl: String) {
        val document = documentRepository.findById(documentId).orElse(null)
            ?: return  // 静かに失敗
        document.markAsCompleted(fileUrl)
        documentRepository.save(document)
    }

    fun failDocument(documentId: String, errorMessage: String) {
        val document = documentRepository.findById(documentId).orElse(null)
            ?: return  // 静かに失敗
        document.markAsFailed(errorMessage)
        documentRepository.save(document)
    }
}
```

### 問題点のまとめ

| # | 問題点 | 影響 |
|---|--------|------|
| ① | Controller で null チェック | コードの重複、見落としによる NullPointerException |
| ② | Controller に状態遷移ロジック | ビジネスロジックの分散、修正漏れ |
| ③ | Controller で例外をキャッチ | 一貫性のないエラーレスポンス |
| ④ | @Transactional がない | データ不整合の可能性 |
| ⑤ | null を返す | 呼び出し側の負担増、バグの温床 |
| ⑥ | 静かに失敗 | 問題の発見が遅れる |

---

## 2. トランザクション境界の明示化

### なぜ @Transactional が必要か

Spring Boot では、`@Transactional` アノテーションを付けることで、メソッドの開始時にトランザクションを開始し、正常終了時にコミット、例外発生時にロールバックします。

```kotlin
@Service
class DocumentService(
    private val documentRepository: DocumentRepository
) {
    // 読み取り専用の操作には readOnly = true を付ける
    @Transactional(readOnly = true)
    fun getDocumentForUser(documentId: String, userId: String): Document {
        // ...
    }

    // データを変更する操作には @Transactional を付ける
    @Transactional
    fun startProcessing(documentId: String) {
        // ...
    }

    @Transactional
    fun completeDocument(documentId: String, fileUrl: String) {
        // ...
    }

    @Transactional
    fun failDocument(documentId: String, errorMessage: String) {
        // ...
    }
}
```

### readOnly = true のメリット

読み取り専用のメソッドに `readOnly = true` を付けると：

1. **パフォーマンス向上**: Hibernate の dirty checking が無効になる
2. **意図の明確化**: このメソッドはデータを変更しないことが明示される
3. **安全性**: 誤ってデータを変更しても反映されない

```kotlin
// Before: readOnly がない
fun getDocumentForUser(documentId: String, userId: String): Document?

// After: readOnly = true を付ける
@Transactional(readOnly = true)
fun getDocumentForUser(documentId: String, userId: String): Document
```

---

## 3. 例外処理の集約

### GlobalExceptionHandler を活用する

Spring Boot では、`@RestControllerAdvice` を使って例外処理を一箇所に集約できます。

```kotlin
@RestControllerAdvice
class GlobalExceptionHandler {

    private val logger = KotlinLogging.logger {}

    // リソースが見つからない場合 → 404
    @ExceptionHandler(ResourceNotFoundException::class)
    fun handleResourceNotFound(ex: ResourceNotFoundException): ResponseEntity<ErrorResponse> {
        logger.warn { "Resource not found: ${ex.message}" }
        return ResponseEntity(
            ErrorResponse(
                status = HttpStatus.NOT_FOUND.value(),
                message = ex.message ?: "Resource not found"
            ),
            HttpStatus.NOT_FOUND
        )
    }

    // 不正な状態遷移 → 409 Conflict
    @ExceptionHandler(InvalidStateTransitionException::class)
    fun handleInvalidStateTransition(ex: InvalidStateTransitionException): ResponseEntity<ErrorResponse> {
        logger.warn { "Invalid state transition: ${ex.fromState} → ${ex.toState}" }
        return ResponseEntity(
            ErrorResponse(
                status = HttpStatus.CONFLICT.value(),
                message = ex.message ?: "Invalid state transition"
            ),
            HttpStatus.CONFLICT
        )
    }

    // 不正な引数 → 400 Bad Request
    @ExceptionHandler(IllegalArgumentException::class)
    fun handleIllegalArgument(ex: IllegalArgumentException): ResponseEntity<ErrorResponse> {
        logger.warn { "Invalid argument: ${ex.message}" }
        return ResponseEntity(
            ErrorResponse(
                status = HttpStatus.BAD_REQUEST.value(),
                message = ex.message ?: "Invalid argument"
            ),
            HttpStatus.BAD_REQUEST
        )
    }
}
```

### カスタム例外クラスの設計

ドメイン固有の例外クラスを作成することで、エラーの種類を明確にできます。

```kotlin
// 基底クラス
abstract class DomainException(
    override val message: String,
    val errorCode: String
) : RuntimeException(message)

// リソースが見つからない
class ResourceNotFoundException(
    message: String,
    val resourceType: String,
    val resourceId: String
) : DomainException(message, "RESOURCE_NOT_FOUND")

// 不正な状態遷移
class InvalidStateTransitionException(
    message: String,
    val fromState: String,
    val toState: String
) : DomainException(message, "INVALID_STATE_TRANSITION")
```

### Controller の簡素化

例外処理を GlobalExceptionHandler に委譲することで、Controller がシンプルになります。

```kotlin
// Before: try-catch で例外をキャッチ
@PostMapping("/{documentId}/status")
fun updateDocumentStatus(...): ResponseEntity<Unit> {
    try {
        when (request.status) {
            "PROCESSING" -> documentService.startProcessing(documentId)
            // ...
        }
    } catch (e: IllegalStateException) {
        return ResponseEntity.status(HttpStatus.CONFLICT).build()
    }
    return ResponseEntity.ok().build()
}

// After: 例外は GlobalExceptionHandler が処理
@PostMapping("/{documentId}/status")
fun updateDocumentStatus(...): ResponseEntity<Unit> {
    val status = DocumentStatus.valueOf(request.status)
    documentService.updateDocumentStatus(
        documentId = documentId,
        status = status,
        fileUrl = request.fileUrl,
        errorMessage = request.errorMessage
    )
    return ResponseEntity.ok().build()
}
```

---

## 4. null を返さない設計

### 問題: null を返すメソッド

```kotlin
// Before: null を返す
fun getDocumentForUser(documentId: String, userId: String): Document? {
    return documentRepository.findByIdAndUserId(documentId, userId)
}

// 呼び出し側で毎回 null チェックが必要
val document = documentService.getDocumentForUser(documentId, userId)
    ?: return ResponseEntity.notFound().build()
```

### 解決: 例外をスローする

```kotlin
// After: 例外をスロー
@Transactional(readOnly = true)
fun getDocumentForUser(documentId: String, userId: String): Document {
    return documentRepository.findByIdAndUserId(documentId, userId)
        ?: throw ResourceNotFoundException(
            message = "Document not found: $documentId",
            resourceType = "Document",
            resourceId = documentId
        )
}

// 呼び出し側がシンプルに
val document = documentService.getDocumentForUser(documentId, userId)
// document は non-null が保証される
```

### orElseThrow を使った慣用的な書き方

Kotlin では、Optional を扱う際に `orElseThrow` を使うとより慣用的です。

```kotlin
// Before: orElse(null) + Elvis 演算子
private fun findDocumentOrThrow(documentId: String): Document {
    return documentRepository.findById(documentId).orElse(null)
        ?: throw ResourceNotFoundException(...)
}

// After: orElseThrow を使用
private fun findDocumentOrThrow(documentId: String): Document {
    return documentRepository.findById(documentId)
        .orElseThrow {
            ResourceNotFoundException(
                message = "Document not found: $documentId",
                resourceType = "Document",
                resourceId = documentId
            )
        }
}
```

`orElseThrow` を使うメリット：
- 不要な null インスタンスを生成しない（効率的）
- 「見つからなければ例外」という意図が明確

---

## 5. 状態遷移ロジックの一元化

### 問題: Controller にビジネスロジックが分散

```kotlin
// Before: Controller に状態遷移ロジックがある
@PostMapping("/{documentId}/status")
fun updateDocumentStatus(...): ResponseEntity<Unit> {
    when (request.status) {
        "PROCESSING" -> documentService.startProcessing(documentId)
        "COMPLETED" -> {
            if (request.fileUrl == null) {
                return ResponseEntity.badRequest().build()  // バリデーションも分散
            }
            documentService.completeDocument(documentId, request.fileUrl)
        }
        // ...
    }
}
```

### 解決: Service に一元化

```kotlin
// After: Service に状態遷移ロジックを集約
@Service
class DocumentService(...) {

    @Transactional
    fun updateDocumentStatus(
        documentId: String,
        status: DocumentStatus,
        fileUrl: String? = null,
        errorMessage: String? = null
    ) {
        when (status) {
            DocumentStatus.PROCESSING -> {
                startProcessing(documentId)
            }
            DocumentStatus.COMPLETED -> {
                require(fileUrl != null) { "fileUrl is required for COMPLETED status" }
                completeDocument(documentId, fileUrl)
            }
            DocumentStatus.FAILED -> {
                require(errorMessage != null) { "errorMessage is required for FAILED status" }
                failDocument(documentId, errorMessage)
            }
            else -> {
                throw IllegalArgumentException("Invalid status for update: $status")
            }
        }
    }
}
```

### 状態遷移違反を例外で通知

Entity 側で不正な状態遷移を検出し、Service で適切な例外に変換します。

```kotlin
// Entity: 状態遷移を検証
class Document {
    fun markAsProcessing() {
        if (status != DocumentStatus.PENDING) {
            throw IllegalStateException(
                "Cannot transition from $status to PROCESSING"
            )
        }
        status = DocumentStatus.PROCESSING
    }
}

// Service: 例外を変換
@Transactional
fun startProcessing(documentId: String) {
    val document = findDocumentOrThrow(documentId)
    val currentStatus = document.status
    try {
        document.markAsProcessing()
    } catch (e: IllegalStateException) {
        throw InvalidStateTransitionException(
            message = e.message ?: "Invalid state transition",
            fromState = currentStatus.name,
            toState = DocumentStatus.PROCESSING.name
        )
    }
    documentRepository.save(document)
}
```

---

## 6. テストの改善

### 問題: relaxed mock の危険性

```kotlin
// Before: relaxed = true を使用
private val mockRepository = mockk<DocumentRepository>(relaxed = true)

// 問題点: 呼び出されていないメソッドも暗黙的に成功する
// バグを見逃す可能性がある
```

### 解決: 明示的な mock 設定

```kotlin
// After: 必要なメソッドだけを明示的にモック
@BeforeEach
fun setup() {
    mockRepository = mockk()  // relaxed を削除
}

@Test
fun `正常系: ドキュメントを取得できる`() {
    // Arrange: 必要なメソッドを明示的にモック
    val documentId = "doc-123"
    val userId = "user-456"
    val expectedDocument = createDocument(id = documentId, userId = userId)
    every { mockRepository.findByIdAndUserId(documentId, userId) } returns expectedDocument

    // Act
    val result = service.getDocumentForUser(documentId, userId)

    // Assert
    assertEquals(expectedDocument, result)
    verify(exactly = 1) { mockRepository.findByIdAndUserId(documentId, userId) }
}
```

### 状態遷移違反のテストを追加

```kotlin
@Nested
@DisplayName("startProcessing")
inner class StartProcessingTest {

    @Test
    @DisplayName("正常系: PENDING から PROCESSING へ遷移する")
    fun `PENDING から PROCESSING へ遷移する`() {
        // Arrange
        val documentId = "doc-123"
        val document = createDocument(documentId, status = DocumentStatus.PENDING)
        every { mockRepository.findById(documentId) } returns Optional.of(document)
        every { mockRepository.save(any()) } answers { firstArg() }

        // Act
        service.startProcessing(documentId)

        // Assert
        assertEquals(DocumentStatus.PROCESSING, document.status)
        verify(exactly = 1) { mockRepository.save(any()) }
    }

    @Test
    @DisplayName("異常系: COMPLETED から PROCESSING への遷移は例外をスロー")
    fun `COMPLETED から PROCESSING への遷移は例外をスロー`() {
        // Arrange
        val documentId = "doc-123"
        val document = createDocument(documentId, status = DocumentStatus.COMPLETED)
        every { mockRepository.findById(documentId) } returns Optional.of(document)

        // Act & Assert
        val exception = assertThrows<InvalidStateTransitionException> {
            service.startProcessing(documentId)
        }
        assertEquals("COMPLETED", exception.fromState)
        assertEquals("PROCESSING", exception.toState)
        verify(exactly = 0) { mockRepository.save(any()) }
    }

    @Test
    @DisplayName("異常系: ドキュメントが存在しない場合は例外をスロー")
    fun `ドキュメントが存在しない場合は例外をスロー`() {
        // Arrange
        val documentId = "non-existent"
        every { mockRepository.findById(documentId) } returns Optional.empty()

        // Act & Assert
        val exception = assertThrows<ResourceNotFoundException> {
            service.startProcessing(documentId)
        }
        assertEquals("Document", exception.resourceType)
        assertEquals(documentId, exception.resourceId)
    }
}
```

---

## 7. まとめ

### リファクタリング後の全体像

```kotlin
// Controller: シンプルに
@RestController
@RequestMapping("/api/v1/documents")
class DocumentController(
    private val documentService: DocumentService
) {
    @GetMapping("/{documentId}/status")
    fun getDocumentStatus(
        @PathVariable documentId: String,
        @RequestAttribute("userId") userId: String
    ): ResponseEntity<DocumentStatusResponse> {
        val document = documentService.getDocumentForUser(documentId, userId)
        return ResponseEntity.ok(DocumentStatusResponse(document))
    }

    @PostMapping("/{documentId}/status")
    fun updateDocumentStatus(
        @PathVariable documentId: String,
        @RequestBody request: UpdateStatusRequest
    ): ResponseEntity<Unit> {
        val status = DocumentStatus.valueOf(request.status)
        documentService.updateDocumentStatus(
            documentId = documentId,
            status = status,
            fileUrl = request.fileUrl,
            errorMessage = request.errorMessage
        )
        return ResponseEntity.ok().build()
    }
}

// Service: ビジネスロジックを集約
@Service
class DocumentService(
    private val documentRepository: DocumentRepository
) {
    @Transactional(readOnly = true)
    fun getDocumentForUser(documentId: String, userId: String): Document {
        return documentRepository.findByIdAndUserId(documentId, userId)
            ?: throw ResourceNotFoundException(...)
    }

    @Transactional
    fun updateDocumentStatus(
        documentId: String,
        status: DocumentStatus,
        fileUrl: String? = null,
        errorMessage: String? = null
    ) {
        when (status) {
            DocumentStatus.PROCESSING -> startProcessing(documentId)
            DocumentStatus.COMPLETED -> completeDocument(documentId, requireNotNull(fileUrl))
            DocumentStatus.FAILED -> failDocument(documentId, requireNotNull(errorMessage))
            else -> throw IllegalArgumentException("Invalid status: $status")
        }
    }

    // 各状態遷移メソッド...
}

// GlobalExceptionHandler: 例外処理を一元管理
@RestControllerAdvice
class GlobalExceptionHandler {
    @ExceptionHandler(ResourceNotFoundException::class)
    fun handleResourceNotFound(ex: ResourceNotFoundException): ResponseEntity<ErrorResponse> { ... }

    @ExceptionHandler(InvalidStateTransitionException::class)
    fun handleInvalidStateTransition(ex: InvalidStateTransitionException): ResponseEntity<ErrorResponse> { ... }

    @ExceptionHandler(IllegalArgumentException::class)
    fun handleIllegalArgument(ex: IllegalArgumentException): ResponseEntity<ErrorResponse> { ... }
}
```

### Before / After 比較

| 観点 | Before | After |
|------|--------|-------|
| トランザクション | 明示されていない | @Transactional で明示 |
| 例外処理 | Controller に分散 | GlobalExceptionHandler に集約 |
| null 処理 | null を返す | 例外をスロー |
| 状態遷移 | Controller にロジック | Service に一元化 |
| テスト | relaxed mock | 明示的な mock |
| エラーレスポンス | 一貫性がない | 統一されたフォーマット |

### 学んだこと

1. **@Transactional** はデータの整合性を保証するために重要
2. **例外処理の集約** により、一貫したエラーレスポンスを返せる
3. **null を返さない設計** により、呼び出し側のコードがシンプルになる
4. **状態遷移ロジックの一元化** により、修正漏れを防げる
5. **明示的な mock** により、テストの信頼性が向上する

これらのリファクタリングは一度にすべて行う必要はありません。チームの状況に合わせて、優先度の高いものから段階的に適用していくことをおすすめします。

---

## 参考資料

- [Spring Framework - Transaction Management](https://docs.spring.io/spring-framework/reference/data-access/transaction.html)
- [Kotlin - Null Safety](https://kotlinlang.org/docs/null-safety.html)
- [MockK - Mocking Library for Kotlin](https://mockk.io/)
