---
author: junichiro
pubDatetime: 2026-01-09T16:59:25+09:00
title: コンストラクタ引数が多すぎる問題を解決する「Parameter Object パターン」
slug: parameter-object-pattern-oauth-refactoring
featured: false
draft: false
tags:
  - kotlin
  - spring-boot
  - design-patterns
  - refactoring
  - oauth
description: Spring Boot で OAuth クライアントをリファクタリングし、多すぎるコンストラクタ引数を Parameter Object パターンで解決する実践ガイド
---

## はじめに

Spring Boot でアプリケーションを開発していると、設定値を `@Value` アノテーションでコンストラクタに注入することがよくあります。しかし、設定項目が増えてくると、コンストラクタの引数が 7 個、8 個、9 個と膨れ上がり、コードが読みにくくなってしまいます。

この記事では、実際の OAuth クライアントのリファクタリング事例を通じて、 **Parameter Object パターン** （Value Object パターンとも呼ばれます）を使ってこの問題を解決する方法を、初学者にもわかりやすく解説します。

## 目次

1. [問題: コンストラクタ引数が多すぎる](#問題-コンストラクタ引数が多すぎる)
2. [解決策: Parameter Object パターン](#解決策-parameter-object-パターン)
3. [実装: OAuthConfiguration クラスを作る](#実装-oauthconfiguration-クラスを作る)
4. [Spring との統合: @Configuration と @Bean](#spring-との統合-configuration-と-bean)
5. [セキュリティ考慮: 機密情報の保護](#セキュリティ考慮-機密情報の保護)
6. [テストの書き方](#テストの書き方)
7. [まとめ](#まとめ)

---

## 問題: コンストラクタ引数が多すぎる

### リファクタリング前のコード

OAuth 認証を行うクライアントクラスを見てみましょう。

```kotlin
@Service
class RaksulOAuthClient(
    @param:Value("\${spring.security.oauth2.client.registration.raksul.client-id}")
    private val clientId: String,
    @param:Value("\${spring.security.oauth2.client.registration.raksul.client-secret}")
    private val clientSecret: String,
    @param:Value("\${spring.security.oauth2.client.provider.raksul.authorization-uri}")
    private val authorizationUri: String,
    @param:Value("\${spring.security.oauth2.client.provider.raksul.token-uri}")
    private val tokenUri: String,
    @param:Value("\${spring.security.oauth2.client.provider.raksul.user-info-uri}")
    private val userInfoUri: String,
    @param:Value("\${spring.security.oauth2.client.provider.raksul.logout-uri}")
    private val logoutUri: String,
    @param:Value("\${spring.security.oauth2.client.registration.raksul.redirect-uri}")
    private val redirectUri: String,
    @param:Value("\${raksul.oauth.logout-timeout-seconds:5}")
    private val logoutTimeoutSeconds: Long,
    private val webClient: WebClient,
    private val objectMapper: ObjectMapper
) {
    // ... メソッドの実装
}
```

### 何が問題なのか？

このコードには以下の問題があります:

#### 1. 可読性が低い

コンストラクタの引数が **10 個** もあります。コードを読む人は、それぞれの引数が何を意味するのか理解するのに時間がかかります。

#### 2. 凝集度が低い

OAuth に関連する設定値（`clientId`, `clientSecret`, `authorizationUri` など）がバラバラに存在しています。これらは本来「OAuth 設定」という一つの概念としてまとめるべきです。

> **凝集度（Cohesion）とは？**
>
> 凝集度は、クラスやモジュールの中身がどれだけ「関連した責務」に集中しているかを表す指標です。凝集度が高いほど、そのクラスは一つの明確な目的を持ち、理解しやすく保守しやすいコードになります。

#### 3. テストが書きにくい

テストを書くときに、10 個の引数をすべて用意する必要があります:

```kotlin
// テストコードの例（リファクタリング前）
val client = RaksulOAuthClient(
    clientId = "test-client-id",
    clientSecret = "test-secret",
    authorizationUri = "https://example.com/oauth/authorize",
    tokenUri = "https://example.com/oauth/token",
    userInfoUri = "https://example.com/userinfo",
    logoutUri = "https://example.com/logout",
    redirectUri = "https://example.com/callback",
    logoutTimeoutSeconds = 5L,
    webClient = mockk(),
    objectMapper = ObjectMapper()
)
```

これでは、OAuth 設定とは関係ない `webClient` や `objectMapper` のテストを書くときにも、OAuth の設定値を全部書かなければなりません。

#### 4. 変更に弱い

将来、OAuth の設定項目が増えた場合（例えば `scope` を追加する場合）、`RaksulOAuthClient` のコンストラクタを変更する必要があります。これは **単一責任の原則（SRP: Single Responsibility Principle）** に違反しています。

> **単一責任の原則（SRP）とは？**
>
> 「クラスを変更する理由は一つであるべき」という原則です。`RaksulOAuthClient` は「OAuth 通信を行う」責任を持つべきですが、「設定値を管理する」責任まで持ってしまっています。

---

## 解決策: Parameter Object パターン

### Parameter Object パターンとは？

**Parameter Object パターン** は、関連する複数のパラメータを一つのオブジェクトにまとめるデザインパターンです。

```
Before: method(a, b, c, d, e, f, g)
After:  method(parameterObject)
```

このパターンには以下のメリットがあります:

| メリット | 説明 |
|----------|------|
| 可読性向上 | 引数の数が減り、コードが読みやすくなる |
| 凝集度向上 | 関連するデータが一箇所にまとまる |
| 再利用性 | 複数のクラスで同じ Parameter Object を使える |
| バリデーション集約 | 設定値の検証ロジックを一箇所に集約できる |
| テスト容易性 | テスト用のオブジェクトを簡単に作れる |

### Value Object との関係

Parameter Object は、 **Value Object（値オブジェクト）** として実装されることが多いです。Value Object には以下の特徴があります:

1. **イミュータブル（不変）**: 一度作成したら値を変更できない
2. **等価性**: 同じ値を持つオブジェクトは等しいとみなされる
3. **自己検証**: オブジェクト生成時にバリデーションを行う

---

## 実装: OAuthConfiguration クラスを作る

### 基本的な構造

まず、OAuth 設定を集約する `OAuthConfiguration` クラスを作成します:

```kotlin
package com.raksul.ad_one.config

/**
 * OAuth 設定を集約する Value Object（イミュータブル）
 *
 * RaksulOAuthClient で使用する OAuth 関連の設定値をまとめて管理する。
 * これにより、コンストラクタパラメータの数を減らし、設定の凝集度を高める。
 */
class OAuthConfiguration(
    /** OAuth クライアント識別子 */
    val clientId: String,
    /** OAuth クライアントシークレット（機密情報） */
    val clientSecret: String,
    /** OAuth 認可エンドポイント URI */
    val authorizationUri: String,
    /** OAuth トークンエンドポイント URI */
    val tokenUri: String,
    /** ユーザー情報取得エンドポイント URI */
    val userInfoUri: String,
    /** ログアウトエンドポイント URI */
    val logoutUri: String,
    /** OAuth コールバック URI */
    val redirectUri: String,
    /** ログアウトリクエストのタイムアウト秒数 */
    val logoutTimeoutSeconds: Long = 5L
)
```

### なぜ `data class` を使わないのか？

Kotlin には便利な `data class` がありますが、今回はあえて使いません。その理由は後述する「セキュリティ考慮」で説明します。

### バリデーションの追加

Value Object の重要な特徴は **自己検証** です。`init` ブロックを使って、オブジェクト生成時にバリデーションを行います:

```kotlin
class OAuthConfiguration(
    val clientId: String,
    val clientSecret: String,
    val authorizationUri: String,
    val tokenUri: String,
    val userInfoUri: String,
    val logoutUri: String,
    val redirectUri: String,
    val logoutTimeoutSeconds: Long = 5L
) {
    init {
        // 必須フィールドのバリデーション
        require(clientId.isNotBlank()) { "clientId must not be blank" }
        require(clientSecret.isNotBlank()) { "clientSecret must not be blank" }

        // URI 形式のバリデーション（HTTP/HTTPS スキームのみ許可）
        listOf(
            "authorizationUri" to authorizationUri,
            "tokenUri" to tokenUri,
            "userInfoUri" to userInfoUri,
            "logoutUri" to logoutUri,
            "redirectUri" to redirectUri
        ).forEach { (name, uri) ->
            require(uri.isNotBlank()) { "$name must not be blank" }
            require(runCatching { java.net.URI(uri) }.isSuccess) {
                "$name must be a valid URI: $uri"
            }
            require(uri.startsWith("http://") || uri.startsWith("https://")) {
                "$name must use http or https scheme: $uri"
            }
        }

        require(logoutTimeoutSeconds > 0) { "logoutTimeoutSeconds must be positive" }
    }
}
```

#### バリデーションのポイント解説

1. **`require` 関数**: Kotlin の標準ライブラリにある関数で、条件が `false` の場合に `IllegalArgumentException` をスローします。

2. **URI スキームの制限**: `file://` や `ftp://` などの危険なスキームを拒否し、`http://` と `https://` のみを許可しています。これはセキュリティ上重要です。

3. **`runCatching`**: 例外をキャッチして `Result` 型で返す Kotlin の関数です。URI のパースに失敗した場合でも安全に処理できます。

### リファクタリング後の RaksulOAuthClient

`OAuthConfiguration` を使うように `RaksulOAuthClient` を書き換えます:

```kotlin
@Service
class RaksulOAuthClient(
    private val oAuthConfiguration: OAuthConfiguration,
    private val webClient: WebClient,
    private val objectMapper: ObjectMapper
) {
    private val logger = KotlinLogging.logger {}

    fun exchangeAuthorizationCodeForToken(authorizationCode: String): OAuthTokenResponse {
        val formData = LinkedMultiValueMap<String, String>().apply {
            add("grant_type", "authorization_code")
            add("code", authorizationCode)
            add("client_id", oAuthConfiguration.clientId)
            add("client_secret", oAuthConfiguration.clientSecret)
            add("redirect_uri", oAuthConfiguration.redirectUri)
        }

        return webClient.post()
            .uri(oAuthConfiguration.tokenUri)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .bodyValue(formData)
            .retrieve()
            // ... 以下省略
    }

    fun buildAuthorizationUri(state: String, scopes: String = "email"): String {
        return UriComponentsBuilder
            .fromUriString(oAuthConfiguration.authorizationUri)
            .queryParam("client_id", oAuthConfiguration.clientId)
            .queryParam("redirect_uri", oAuthConfiguration.redirectUri)
            .queryParam("response_type", "code")
            .queryParam("scope", scopes)
            .queryParam("state", state)
            .build()
            .toUriString()
    }

    // ... 他のメソッド
}
```

#### Before と After の比較

| 観点 | Before | After |
|------|--------|-------|
| コンストラクタ引数 | 10 個 | 3 個 |
| OAuth 設定の管理 | 分散 | 集約 |
| バリデーション | なし | 自動 |
| 可読性 | 低い | 高い |

---

## Spring との統合: @Configuration と @Bean

### 設定クラスの作成

`OAuthConfiguration` を Spring の DI コンテナに登録するため、`@Configuration` クラスを作成します:

```kotlin
package com.raksul.ad_one.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

/**
 * OAuth 設定の Bean を提供する Configuration クラス
 *
 * Spring Security OAuth2 の標準プロパティパスから設定値を取得し、
 * OAuthConfiguration Value Object として提供する。
 */
@Configuration
class OAuthConfig {

    @Bean
    fun oAuthConfiguration(
        @Value("\${spring.security.oauth2.client.registration.raksul.client-id}")
        clientId: String,
        @Value("\${spring.security.oauth2.client.registration.raksul.client-secret}")
        clientSecret: String,
        @Value("\${spring.security.oauth2.client.provider.raksul.authorization-uri}")
        authorizationUri: String,
        @Value("\${spring.security.oauth2.client.provider.raksul.token-uri}")
        tokenUri: String,
        @Value("\${spring.security.oauth2.client.provider.raksul.user-info-uri}")
        userInfoUri: String,
        @Value("\${spring.security.oauth2.client.provider.raksul.logout-uri}")
        logoutUri: String,
        @Value("\${spring.security.oauth2.client.registration.raksul.redirect-uri}")
        redirectUri: String,
        @Value("\${raksul.oauth.logout-timeout-seconds:5}")
        logoutTimeoutSeconds: Long
    ): OAuthConfiguration = OAuthConfiguration(
        clientId = clientId,
        clientSecret = clientSecret,
        authorizationUri = authorizationUri,
        tokenUri = tokenUri,
        userInfoUri = userInfoUri,
        logoutUri = logoutUri,
        redirectUri = redirectUri,
        logoutTimeoutSeconds = logoutTimeoutSeconds
    )
}
```

### なぜ @Configuration クラスを分けるのか？

`@Value` アノテーションを `OAuthConfiguration` クラス自体に付けることも技術的には可能ですが、以下の理由で分離しています:

1. **関心の分離**: `OAuthConfiguration` は「OAuth 設定を表現する」責任、`OAuthConfig` は「Spring から設定値を取得する」責任を持つ

2. **テスト容易性**: `OAuthConfiguration` は Spring に依存せず、純粋な Kotlin クラスとしてテストできる

3. **再利用性**: `OAuthConfiguration` は Spring 以外の環境（例えば CLI ツール）でも使える

### アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────┐
│                     application.yml                          │
│  spring.security.oauth2.client.registration.raksul.*        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      OAuthConfig                             │
│  @Configuration                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ @Bean                                                    ││
│  │ fun oAuthConfiguration(@Value(...) ...): OAuthConfiguration││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  OAuthConfiguration                          │
│  Value Object (イミュータブル)                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ - clientId: String                                       ││
│  │ - clientSecret: String                                   ││
│  │ - authorizationUri: String                               ││
│  │ - tokenUri: String                                       ││
│  │ - userInfoUri: String                                    ││
│  │ - logoutUri: String                                      ││
│  │ - redirectUri: String                                    ││
│  │ - logoutTimeoutSeconds: Long                             ││
│  └─────────────────────────────────────────────────────────┘│
│  init { バリデーション }                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   RaksulOAuthClient                          │
│  @Service                                                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ constructor(                                             ││
│  │   oAuthConfiguration: OAuthConfiguration,  ← 注入        ││
│  │   webClient: WebClient,                                  ││
│  │   objectMapper: ObjectMapper                             ││
│  │ )                                                        ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## セキュリティ考慮: 機密情報の保護

OAuth 設定には `clientSecret`（クライアントシークレット）という機密情報が含まれています。この情報がログやエラーメッセージに露出すると、セキュリティ上の問題になります。

### なぜ `data class` を使わないのか？

Kotlin の `data class` は便利ですが、以下の機能が自動生成されます:

```kotlin
data class OAuthConfiguration(
    val clientId: String,
    val clientSecret: String,
    // ...
) {
    // 自動生成されるメソッド:
    // - toString(): "OAuthConfiguration(clientId=xxx, clientSecret=actual-secret, ...)"
    // - copy(): data.copy(clientSecret = "new-secret")
    // - componentN(): val (id, secret, ...) = config
}
```

これらの自動生成機能は、機密情報を露出させるリスクがあります:

1. **`toString()`**: ログ出力時に `clientSecret` の実際の値が表示される
2. **`copy()`**: `clientSecret` だけを変更した新しいオブジェクトを簡単に作れてしまう
3. **分割代入**: `clientSecret` を簡単に取り出せてしまう

### 安全な `toString()` の実装

`clientSecret` をマスクした `toString()` を実装します:

```kotlin
override fun toString(): String {
    return "OAuthConfiguration(" +
        "clientId='$clientId', " +
        "clientSecret='***MASKED***', " +  // ← マスクする
        "authorizationUri='$authorizationUri', " +
        "tokenUri='$tokenUri', " +
        "userInfoUri='$userInfoUri', " +
        "logoutUri='$logoutUri', " +
        "redirectUri='$redirectUri', " +
        "logoutTimeoutSeconds=$logoutTimeoutSeconds)"
}
```

これにより、ログに出力されても安全です:

```
// 安全なログ出力
logger.info { "OAuth config: $oAuthConfiguration" }
// 出力: OAuth config: OAuthConfiguration(clientId='xxx', clientSecret='***MASKED***', ...)
```

### `equals()` と `hashCode()` の実装

`equals()` と `hashCode()` も慎重に実装する必要があります:

```kotlin
/**
 * 全フィールドを含む等価性比較
 *
 * clientSecret はタイミングセーフな方法で比較される。
 * hashCode() では clientSecret を除外しているため、
 * clientSecret のみが異なる場合はハッシュコリジョンが発生する。
 */
override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (other !is OAuthConfiguration) return false

    return clientId == other.clientId &&
        authorizationUri == other.authorizationUri &&
        tokenUri == other.tokenUri &&
        userInfoUri == other.userInfoUri &&
        logoutUri == other.logoutUri &&
        redirectUri == other.redirectUri &&
        logoutTimeoutSeconds == other.logoutTimeoutSeconds &&
        clientSecretEquals(other.clientSecret)
}

/**
 * clientSecret を除外したハッシュコード計算
 */
override fun hashCode(): Int {
    var result = clientId.hashCode()
    result = 31 * result + authorizationUri.hashCode()
    result = 31 * result + tokenUri.hashCode()
    result = 31 * result + userInfoUri.hashCode()
    result = 31 * result + logoutUri.hashCode()
    result = 31 * result + redirectUri.hashCode()
    result = 31 * result + logoutTimeoutSeconds.hashCode()
    return result  // clientSecret は含めない
}
```

#### なぜ `hashCode()` から `clientSecret` を除外するのか？

`hashCode()` の結果は、デバッグやロギングで表示されることがあります。`clientSecret` を含めると、ハッシュ値から元の値を推測される可能性があります（理論的には）。

ただし、これにはトレードオフがあります。`clientSecret` だけが異なる 2 つのオブジェクトは同じ `hashCode` を持つため、`HashMap` や `HashSet` でハッシュコリジョンが発生します。しかし、設定オブジェクトでこのようなケースは稀なので、セキュリティを優先しています。

### タイミングセーフな比較

パスワードや秘密鍵の比較では、 **タイミング攻撃** に注意が必要です:

```kotlin
/**
 * タイミング攻撃に対する安全な clientSecret 比較
 */
private fun clientSecretEquals(other: String): Boolean {
    if (clientSecret.length != other.length) return false
    var result = 0
    for (i in clientSecret.indices) {
        result = result or (clientSecret[i].code xor other[i].code)
    }
    return result == 0
}
```

> **タイミング攻撃とは？**
>
> 通常の文字列比較（`==`）は、最初に異なる文字が見つかった時点で `false` を返します。攻撃者はこの処理時間の差を測定することで、正しい文字列を一文字ずつ推測できる可能性があります。
>
> タイミングセーフな比較では、すべての文字を比較してから結果を返すため、処理時間から情報が漏れません。

---

## テストの書き方

### バリデーションのテスト

`OAuthConfiguration` のバリデーションをテストします:

```kotlin
@DisplayName("OAuthConfiguration")
class OAuthConfigurationTest {

    // テスト用のデフォルト値
    private val defaultClientId = "test-client-id"
    private val defaultClientSecret = "test-client-secret"
    private val defaultAuthorizationUri = "https://example.com/oauth/authorize"
    private val defaultTokenUri = "https://example.com/oauth/token"
    private val defaultUserInfoUri = "https://example.com/userinfo"
    private val defaultLogoutUri = "https://example.com/logout"
    private val defaultRedirectUri = "https://example.com/callback"

    /**
     * テスト用の OAuthConfiguration を作成するヘルパーメソッド
     */
    private fun createConfig(
        clientId: String = defaultClientId,
        clientSecret: String = defaultClientSecret,
        authorizationUri: String = defaultAuthorizationUri,
        tokenUri: String = defaultTokenUri,
        userInfoUri: String = defaultUserInfoUri,
        logoutUri: String = defaultLogoutUri,
        redirectUri: String = defaultRedirectUri,
        logoutTimeoutSeconds: Long = 5L
    ) = OAuthConfiguration(
        clientId = clientId,
        clientSecret = clientSecret,
        authorizationUri = authorizationUri,
        tokenUri = tokenUri,
        userInfoUri = userInfoUri,
        logoutUri = logoutUri,
        redirectUri = redirectUri,
        logoutTimeoutSeconds = logoutTimeoutSeconds
    )

    @Nested
    @DisplayName("validation")
    inner class ValidationTest {

        @Test
        @DisplayName("有効な設定で OAuthConfiguration を作成できる")
        fun `有効な設定で OAuthConfiguration を作成できる`() {
            val config = createConfig(
                clientId = "valid-client-id",
                clientSecret = "valid-client-secret"
            )

            assertEquals("valid-client-id", config.clientId)
        }

        @Test
        @DisplayName("clientId が空の場合に例外がスローされる")
        fun `clientId が空の場合に例外がスローされる`() {
            val exception = assertFailsWith<IllegalArgumentException> {
                createConfig(clientId = "")
            }
            assertTrue(exception.message!!.contains("clientId must not be blank"))
        }

        @Test
        @DisplayName("authorizationUri が無効な URI の場合に例外がスローされる")
        fun `authorizationUri が無効な URI の場合に例外がスローされる`() {
            val exception = assertFailsWith<IllegalArgumentException> {
                createConfig(authorizationUri = "not a valid uri [invalid]")
            }
            assertTrue(exception.message!!.contains("authorizationUri must be a valid URI"))
        }

        @Test
        @DisplayName("file スキームの URI は拒否される")
        fun `file スキームの URI は拒否される`() {
            val exception = assertFailsWith<IllegalArgumentException> {
                createConfig(authorizationUri = "file:///etc/passwd")
            }
            assertTrue(exception.message!!.contains("must use http or https scheme"))
        }
    }
}
```

### toString のテスト（セキュリティ）

`clientSecret` がマスクされていることを確認します:

```kotlin
@Nested
@DisplayName("toString")
inner class ToStringTest {

    @Test
    @DisplayName("clientSecret がマスクされる")
    fun `clientSecret がマスクされる`() {
        val config = createConfig()
        val result = config.toString()

        assertFalse(result.contains("test-client-secret"))  // 実際の値は含まれない
        assertTrue(result.contains("***MASKED***"))          // マスクされている
    }

    @Test
    @DisplayName("他のフィールドは表示される")
    fun `他のフィールドは表示される`() {
        val config = createConfig()
        val result = config.toString()

        assertTrue(result.contains("test-client-id"))
        assertTrue(result.contains("https://example.com/oauth/authorize"))
    }
}
```

### equals/hashCode のテスト

```kotlin
@Nested
@DisplayName("equals and hashCode")
inner class EqualsHashCodeTest {

    @Test
    @DisplayName("同じ値を持つインスタンスは等しい")
    fun `同じ値を持つインスタンスは等しい`() {
        val config1 = createConfig()
        val config2 = createConfig()

        assertEquals(config1, config2)
        assertEquals(config1.hashCode(), config2.hashCode())
    }

    @Test
    @DisplayName("異なる clientSecret を持つインスタンスは等しくない")
    fun `異なる clientSecret を持つインスタンスは等しくない`() {
        val config1 = createConfig(clientSecret = "secret-1")
        val config2 = createConfig(clientSecret = "secret-2")

        assertNotEquals(config1, config2)
    }

    @Test
    @DisplayName("hashCode は clientSecret を含まない")
    fun `hashCode は clientSecret を含まない`() {
        val config1 = createConfig(clientSecret = "secret-1")
        val config2 = createConfig(clientSecret = "secret-2")

        // clientSecret が異なっても hashCode は同じ
        assertEquals(config1.hashCode(), config2.hashCode())
    }
}
```

---

## まとめ

### 学んだこと

1. **Parameter Object パターン**: 多すぎるコンストラクタ引数を一つのオブジェクトにまとめる

2. **Value Object**: イミュータブルで自己検証を行う値オブジェクト

3. **セキュリティ考慮**: 機密情報を `toString()` でマスク、`hashCode()` から除外

4. **関心の分離**: 設定の表現（`OAuthConfiguration`）と取得（`OAuthConfig`）を分離

### リファクタリングの効果

| 指標 | Before | After |
|------|--------|-------|
| コンストラクタ引数 | 10 個 | 3 個 |
| バリデーション | なし | 自動（8 種類） |
| セキュリティ | 考慮なし | マスク、タイミングセーフ比較 |
| テスト容易性 | 低 | 高 |
| 変更の影響範囲 | 大 | 小 |

### 次のステップ

このパターンは OAuth 設定以外にも応用できます:

- データベース接続設定
- 外部 API クライアント設定
- メール送信設定
- キャッシュ設定

「コンストラクタ引数が 4 個を超えたら Parameter Object を検討する」というガイドラインを持っておくと、コードの品質を保ちやすくなります。

---

## 参考資料

- [Refactoring: Improving the Design of Existing Code](https://martinfowler.com/books/refactoring.html) - Martin Fowler
- [Clean Code: A Handbook of Agile Software Craftsmanship](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882) - Robert C. Martin
- [Kotlin Language Documentation](https://kotlinlang.org/docs/home.html)
- [Spring Framework Documentation](https://docs.spring.io/spring-framework/reference/)
