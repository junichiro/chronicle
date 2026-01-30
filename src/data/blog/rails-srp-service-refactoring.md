---
author: junichiro
pubDatetime: 2026-01-30T14:13:45+09:00
title: "「注文作成サービス」に 4 つの仕事をさせていませんか？ — 単一責任の原則で Rails サービスを分解する"
slug: rails-srp-service-refactoring
featured: true
draft: false
tags:
  - rails
  - refactoring
  - design-pattern
  - architecture
  - ruby
description: "Rails の CreateSomethingService が複数の責務を持つ問題を、EC サイトの注文作成を題材に SRP に基づいてリファクタリングする方法を解説"
---

## はじめに

Rails アプリケーションで `CreateSomethingService` を書いたことがあるだろうか。最初は「Something を作る」だけのシンプルなサービスだったはずが、いつの間にか **関連する配送タスクの処理** 、 **担当スタッフの変更** 、 **顧客ステータスの更新** まで担当している。

```ruby
def call
  create_order            # 本来の仕事
  process_fulfillment     # ...これも？
  process_assignee        # ...これも？？
  update_customer_status  # ...これも？？？
end
```

「1 回の API リクエストで全部やらなきゃいけないんだから、1 つのサービスにまとめるのが自然でしょ？」

気持ちはわかる。だが、それは **単一責任の原則（SRP）** に反している。この記事では、ありがちなコード例を題材に、SRP 違反がどう問題を引き起こし、どうリファクタリングすべきかを詳しく解説する。

---

## 題材：注文作成サービス

今回取り上げるのは、EC サイトのバックエンドにある `CreateOrderService` だ。顧客が商品をカートに入れて注文を確定した後、その内容を記録するためのサービスである。

### ビジネスの流れ

1. 顧客が商品をカートに入れて注文を確定する
2. 注文が確定したら、フロントエンドから「決済方法」「配送先」「メモ」「配送タスク」「担当スタッフになるかどうか」を送信する
3. バックエンドが **注文を作成** し、関連する処理を実行する

一見すると「注文の作成」という 1 つの仕事に見える。しかし実際のコードを見ると、そうではないことがわかる。

---

## Before：1 サービスに 4 つの仕事

### 全体像

まずファイルの構造を俯瞰しよう。

```ruby
# create_order_service.rb
class CreateOrderService
  include ServiceBase
  include FulfillmentOwnershipValidatable
  include FulfillmentAssigneeSettable
  include OrderCreatable

  initialize_with :customer_id,
                  :project_id,
                  :cart_id,
                  :shipping_address_id,
                  :current_staff_id,
                  :payment_method_id,
                  memo: nil,
                  fulfillment_tasks: [],
                  task_ids_to_delete: [],
                  become_customer_assignee: nil

  is_callable
end
```

この時点で 3 つの concern を include し、10 個のパラメータを受け取っている。名前は「Order を Create する Service」だが、パラメータを見ると `fulfillment_tasks`, `task_ids_to_delete`, `become_customer_assignee` という **明らかに注文作成とは別の仕事のためのデータ** が混じっている。

### call メソッドの中身

```ruby
def call
  validate_task_ownership!
  validate_delete_task_ownership!

  customer = find_customer
  cart = find_cart
  cart_item = find_cart_item(cart)
  next_status = determine_next_customer_status(customer)
  status_from = customer.status_id
  effective_status = next_status || customer.status

  ActiveRecord::Base.transaction do
    # ① 注文を記録する（本来の仕事）
    order = create_order(customer, status_from, effective_status)
    create_order_item(order, cart_item)

    # ② 配送タスクを処理する
    process_fulfillment(customer)

    # ③ 担当スタッフを変更する
    process_assignee(customer)

    # ④ 顧客ステータスを更新する
    update_customer_status(customer, next_status) if next_status.present?

    customer.reload
  end
end
```

コメントの番号を見てほしい。 **4 つの異なる処理** がこの `call` メソッドの中で実行されている。

---

## 何が問題なのかを掘り下げる

「全部トランザクション内で実行されるし、まとまってるほうがわかりやすくない？」という声もあるだろう。しかし、この設計には以下の **4 つの深刻な問題** がある。

### 問題 1：4 つの異なる「変更の理由」がある

**単一責任の原則（SRP）** とは、「1 つのクラスは、変更される理由を 1 つだけ持つべき」という原則だ。この `CreateOrderService` は、以下の 4 つの理由で変更される可能性がある。

| 変更の理由 | 例 |
|---|---|
| ① 注文の記録方法が変わる | 「注文にクーポン情報も含めたい」 |
| ② 配送タスクのルールが変わる | 「高額注文は翌日配送タスクを自動追加」 |
| ③ 担当スタッフの割り当てロジックが変わる | 「VIP 顧客の担当は手動承認が必要」 |
| ④ 顧客ステータスの更新条件が変わる | 「3 回目の購入でゴールド会員にする」 |

これらは **全く異なる関心事** だ。それなのに 1 つのファイルに押し込められている。

「注文にクーポン情報を追加したい」という要件が来たとき、配送タスクや担当スタッフのロジックが書かれた同じファイルを開くことになる。これでは **変更の影響範囲が不必要に広がる** 。

### 問題 2：concern の「隠れた依存」

このサービスは 3 つの concern を include している。それぞれの中身を見てみよう。

```ruby
# order_creatable.rb
module OrderCreatable
  private

  def create_order(customer, status_from, effective_status)
    Order.create!(
      customer: customer,
      payment_method_id: payment_method_id,
      shipping_address_id: shipping_address_id,
      current_staff_id: current_staff_id,
      memo: memo,
      status_from: status_from,
      status: effective_status
    )
  end

  def create_order_item(order, cart_item)
    OrderItem.create!(
      order: order,
      cart_item: cart_item
    )
  end

  def find_customer
    Customer.find(customer_id)
  end

  def find_cart
    Cart.find_by!(uuid: cart_id)
  end

  def find_cart_item(cart)
    CartItem.find_by!(
      cart: cart,
      customer: find_customer
    )
  end

  def determine_next_customer_status(customer)
    # ビジネスロジック（省略）
  end
end
```

このコードには **暗黙の依存** がある。`payment_method_id`, `shipping_address_id`, `memo` といったインスタンス変数が、サービス本体に存在することを前提としている。

```ruby
# fulfillment_assignee_settable.rb
module FulfillmentAssigneeSettable
  private

  def process_assignee(customer)
    return if become_customer_assignee.nil?

    if become_customer_assignee
      customer.update!(assignee_id: current_staff_id)
    else
      customer.update!(assignee_id: nil)
    end
  end
end
```

ここでは `become_customer_assignee` と `current_staff_id` への依存がある。

```ruby
# fulfillment_ownership_validatable.rb
module FulfillmentOwnershipValidatable
  private

  def validate_task_ownership!
    return if fulfillment_tasks.blank?

    fulfillment_tasks.each do |task|
      validate_single_task_ownership!(task)
    end
  end

  def validate_delete_task_ownership!
    return if task_ids_to_delete.blank?

    task_ids_to_delete.each do |task_id|
      task = FulfillmentTask.find(task_id)
      validate_single_task_ownership!(task)
    end
  end

  def validate_single_task_ownership!(task)
    unless task.customer_id == customer_id
      raise InvalidTaskOwnershipError
    end
  end
end
```

ここでは `fulfillment_tasks`, `task_ids_to_delete`, `customer_id` への依存がある。

これらの依存は **ファイルを開かないと見えない** 。concern の include 文だけを見ても、どのインスタンス変数が必要なのかわからない。

### 問題 3：CancelOrderService との「コピペ的共有」

さらに問題なのは、同じ concern が別のサービスでも使われている点だ。

```ruby
# cancel_order_service.rb
class CancelOrderService
  include ServiceBase
  include FulfillmentOwnershipValidatable
  include FulfillmentAssigneeSettable
  include CancellationCreatable

  # ...
end
```

一見すると「コードの再利用」に見えるが、 **実際の振る舞いは異なる** 。

**CreateOrderService の場合：**

```ruby
def process_assignee(customer)
  return if become_customer_assignee.nil?

  if become_customer_assignee
    customer.update!(assignee_id: current_staff_id)
  else
    customer.update!(assignee_id: nil)
  end
end
```

- `become_customer_assignee` が `true` なら **誰でも担当スタッフになれる**

**CancelOrderService の場合：**

```ruby
def process_assignee(customer)
  return if become_customer_assignee.nil?

  if become_customer_assignee
    # キャンセル処理は担当スタッフのみが可能
    unless customer.assignee_id == current_staff_id
      raise UnauthorizedAssigneeError, "キャンセルは担当スタッフのみ実行できます"
    end
  else
    customer.update!(assignee_id: nil)
  end
end
```

- `become_customer_assignee` が `true` で、かつ **既に担当スタッフでなければエラー**

同じメソッド名 `process_assignee` でありながら、 **振る舞いが違う** 。これは concern の「見かけ上の共通化」が、実際には **異なるビジネスルールを隠蔽している** 例だ。

これでは、concern のコードを変更したときに「どのサービスに影響するか」が追いにくい。

### 問題 4：テストが肥大化する

この設計では、`CreateOrderService` のテストが **4 つの責務すべて** をカバーしなければならない。

```ruby
# create_order_service_spec.rb
RSpec.describe CreateOrderService do
  describe '#call' do
    # ① 注文作成のテスト
    context '注文が正常に作成される' do
      it '注文レコードが作成される'
      it '注文明細が作成される'
      it '決済方法が正しく記録される'
      it '配送先が正しく記録される'
    end

    # ② 配送タスクのテスト
    context '配送タスクが指定されている' do
      it 'タスクが作成される'
      it '削除対象のタスクが削除される'
      it '他の顧客のタスクは削除できない（エラー）'
    end

    # ③ 担当スタッフのテスト
    context 'become_customer_assignee が true' do
      it '担当スタッフが設定される'
    end

    context 'become_customer_assignee が false' do
      it '担当スタッフが解除される'
    end

    # ④ 顧客ステータスのテスト
    context '顧客ステータスが変わる条件' do
      it 'ステータスが更新される'
      it 'ステータスが変わらない場合は更新されない'
    end
  end
end
```

これらは **すべて異なる関心事** なのに、1 つのテストファイルに混在している。

さらに、組み合わせのテストケースも必要になる：

- 「配送タスクあり + 担当スタッフ設定あり」
- 「顧客ステータス更新あり + 配送タスクなし」
- ...

こうして **テストの複雑度が組み合わせ爆発** を起こす。

---

## リファクタリングの方針

問題を整理すると、以下のようになる：

- **責務が混在している** → 4 つの異なる「変更の理由」がある
- **concern が暗黙の依存を持っている** → include だけでは依存がわからない
- **concern が異なる振る舞いを隠している** → 同じメソッド名でも意味が違う
- **テストが肥大化している** → 1 つのテストが 4 つの関心事をカバー

これを解決するため、以下の方針でリファクタリングする。

### 方針 1：責務ごとにサービスを分離する

1 つのサービスが持つ責務を **1 つに限定** する。

- `OrderRecorder` → 注文の記録のみ
- `FulfillmentTaskProcessor` → 配送タスクの処理のみ
- `CustomerAssigneeProcessor` → 担当スタッフの変更のみ
- `CustomerStatusUpdater` → 顧客ステータスの更新のみ

### 方針 2：元のサービスを「オーケストレーター」にする

`CreateOrderService` は、これらのサービスを **呼び出す調整役** に徹する。

```ruby
def call
  OrderRecorder.call(...)
  FulfillmentTaskProcessor.call(...)
  CustomerAssigneeProcessor.call(...)
  CustomerStatusUpdater.call(...)
end
```

### 方針 3：concern を最小限にする

concern は **本当に共通化すべきもの** だけに限定する。例えば `ServiceBase` のような、すべてのサービスで使う基盤部分のみ。

ビジネスロジックを含む concern は、 **独立したサービスとして切り出す** 。

---

## After：責務ごとにサービスを分離する

### Step 1：責務を洗い出す

まず、元のコードから **4 つの責務** を明確にする。

| 責務 | やること |
|---|---|
| ① 注文の記録 | Order と OrderItem の作成 |
| ② 配送タスクの処理 | FulfillmentTask の作成・削除、所有権の検証 |
| ③ 担当スタッフの変更 | Customer の assignee_id の更新 |
| ④ 顧客ステータスの更新 | Customer の status_id の更新 |

### Step 2：各責務を独立したサービスにする

#### ① OrderRecorder

```ruby
# order_recorder.rb
class OrderRecorder
  include ServiceBase

  initialize_with :customer_id,
                  :cart_id,
                  :shipping_address_id,
                  :payment_method_id,
                  :current_staff_id,
                  :memo,
                  :status_from,
                  :effective_status

  is_callable

  def call
    customer = Customer.find(customer_id)
    cart = Cart.find_by!(uuid: cart_id)
    cart_item = CartItem.find_by!(
      cart: cart,
      customer: customer
    )

    order = Order.create!(
      customer: customer,
      payment_method_id: payment_method_id,
      shipping_address_id: shipping_address_id,
      current_staff_id: current_staff_id,
      memo: memo,
      status_from: status_from,
      status: effective_status
    )

    OrderItem.create!(
      order: order,
      cart_item: cart_item
    )

    order
  end
end
```

**ポイント：**
- 注文の記録だけに責務を限定
- concern を使わず、すべてのロジックをこのクラス内に記述
- 依存が **明示的** （`initialize_with` で必要なパラメータがすべて見える）

#### ② FulfillmentTaskProcessor

```ruby
# fulfillment_task_processor.rb
class FulfillmentTaskProcessor
  include ServiceBase

  initialize_with :customer_id,
                  :current_staff_id,
                  fulfillment_tasks: [],
                  task_ids_to_delete: []

  is_callable

  def call
    validate_task_ownership!
    validate_delete_task_ownership!

    delete_tasks
    create_tasks
  end

  private

  def validate_task_ownership!
    return if fulfillment_tasks.blank?

    fulfillment_tasks.each do |task_params|
      # 新規作成の場合は customer_id が一致するか事前チェック
      unless task_params[:customer_id] == customer_id
        raise InvalidTaskOwnershipError
      end
    end
  end

  def validate_delete_task_ownership!
    return if task_ids_to_delete.blank?

    task_ids_to_delete.each do |task_id|
      task = FulfillmentTask.find(task_id)
      unless task.customer_id == customer_id
        raise InvalidTaskOwnershipError
      end
    end
  end

  def delete_tasks
    return if task_ids_to_delete.blank?

    FulfillmentTask.where(id: task_ids_to_delete).destroy_all
  end

  def create_tasks
    return if fulfillment_tasks.blank?

    fulfillment_tasks.each do |task_params|
      FulfillmentTask.create!(task_params)
    end
  end
end
```

**ポイント：**
- 配送タスクの処理だけに責務を限定
- `UpsertFulfillmentTaskService` や `DeleteFulfillmentTaskService` を内部で呼ぶことも可能（さらに細分化する場合）
- 所有権の検証ロジックが **このクラス内で完結** している

#### ③ CustomerAssigneeProcessor

```ruby
# customer_assignee_processor.rb
class CustomerAssigneeProcessor
  include ServiceBase

  initialize_with :customer_id,
                  :current_staff_id,
                  :become_customer_assignee

  is_callable

  def call
    return if become_customer_assignee.nil?

    customer = Customer.find(customer_id)

    if become_customer_assignee
      customer.update!(assignee_id: current_staff_id)
    else
      customer.update!(assignee_id: nil)
    end
  end
end
```

**ポイント：**
- 担当スタッフの変更だけに責務を限定
- `become_customer_assignee` の判定ロジックが **明示的に見える**
- CancelOrderService で使う場合は、別のサービス（例：`CancellationAssigneeProcessor`）を作る

#### ④ CustomerStatusUpdater

```ruby
# customer_status_updater.rb
class CustomerStatusUpdater
  include ServiceBase

  initialize_with :customer_id,
                  :next_status

  is_callable

  def call
    return if next_status.blank?

    customer = Customer.find(customer_id)
    customer.update!(status: next_status)
  end
end
```

**ポイント：**
- 顧客ステータスの更新だけに責務を限定
- `next_status` の決定ロジックは **外部に委譲** （オーケストレーター側で決める）

### Step 3：元のサービスをオーケストレーターに変える

```ruby
# create_order_service.rb
class CreateOrderService
  include ServiceBase

  initialize_with :customer_id,
                  :project_id,
                  :cart_id,
                  :shipping_address_id,
                  :current_staff_id,
                  :payment_method_id,
                  memo: nil,
                  fulfillment_tasks: [],
                  task_ids_to_delete: [],
                  become_customer_assignee: nil

  is_callable

  def call
    customer = Customer.find(customer_id)
    next_status = determine_next_customer_status(customer)
    status_from = customer.status_id
    effective_status = next_status || customer.status

    ActiveRecord::Base.transaction do
      # ① 注文を記録する
      OrderRecorder.call(
        customer_id: customer_id,
        cart_id: cart_id,
        shipping_address_id: shipping_address_id,
        payment_method_id: payment_method_id,
        current_staff_id: current_staff_id,
        memo: memo,
        status_from: status_from,
        effective_status: effective_status
      )

      # ② 配送タスクを処理する
      FulfillmentTaskProcessor.call(
        customer_id: customer_id,
        current_staff_id: current_staff_id,
        fulfillment_tasks: fulfillment_tasks,
        task_ids_to_delete: task_ids_to_delete
      )

      # ③ 担当スタッフを変更する
      CustomerAssigneeProcessor.call(
        customer_id: customer_id,
        current_staff_id: current_staff_id,
        become_customer_assignee: become_customer_assignee
      )

      # ④ 顧客ステータスを更新する
      CustomerStatusUpdater.call(
        customer_id: customer_id,
        next_status: next_status
      )

      customer.reload
    end
  end

  private

  def determine_next_customer_status(customer)
    # ビジネスロジック（省略）
  end
end
```

**ポイント：**
- `CreateOrderService` は **4 つのサービスを呼び出すだけ**
- トランザクションの制御はここで行う（ビジネス要件として必要なら）
- concern は一切使わない
- 各サービスの呼び出しが **何をしているか明示的**

### Step 4：concern を最小限にする

元のコードでは 3 つの concern を使っていたが、リファクタリング後は **ServiceBase のみ** になった。

```ruby
# service_base.rb
module ServiceBase
  extend ActiveSupport::Concern

  included do
    # 共通のエラーハンドリングやロギングなど
  end

  class_methods do
    def call(*args, **kwargs)
      new(*args, **kwargs).call
    end
  end
end
```

**FulfillmentOwnershipValidatable、FulfillmentAssigneeSettable、OrderCreatable は削除** 。それぞれのロジックは、対応するサービスクラスの中に移動した。

---

## テストの変化

リファクタリング前は、1 つのテストファイルが 4 つの責務をカバーしていた。リファクタリング後は、 **責務ごとにテストが分離** される。

### Before

```ruby
# create_order_service_spec.rb
RSpec.describe CreateOrderService do
  describe '#call' do
    # ① 注文作成のテスト（10 ケース）
    # ② 配送タスクのテスト（8 ケース）
    # ③ 担当スタッフのテスト（5 ケース）
    # ④ 顧客ステータスのテスト（7 ケース）
    # → 合計 30 ケース
  end
end
```

### After

```ruby
# order_recorder_spec.rb
RSpec.describe OrderRecorder do
  describe '#call' do
    # ① 注文作成のテスト（10 ケース）
  end
end

# fulfillment_task_processor_spec.rb
RSpec.describe FulfillmentTaskProcessor do
  describe '#call' do
    # ② 配送タスクのテスト（8 ケース）
  end
end

# customer_assignee_processor_spec.rb
RSpec.describe CustomerAssigneeProcessor do
  describe '#call' do
    # ③ 担当スタッフのテスト（5 ケース）
  end
end

# customer_status_updater_spec.rb
RSpec.describe CustomerStatusUpdater do
  describe '#call' do
    # ④ 顧客ステータスのテスト（7 ケース）
  end
end

# create_order_service_spec.rb
RSpec.describe CreateOrderService do
  describe '#call' do
    # オーケストレーションのテスト（5 ケース）
    # - 各サービスが正しく呼ばれるか
    # - トランザクションが正しく動作するか
  end
end
```

**メリット：**
- 各テストの **関心が明確**
- テストの実行速度が向上（必要なテストだけ実行できる）
- 失敗したテストを見れば **どの責務に問題があるか** すぐわかる

---

## ファイル構成の変化

### Before

```
app/
└── services/
    ├── create_order_service.rb          # 200 行
    ├── cancel_order_service.rb          # 180 行
    └── concerns/
        ├── fulfillment_ownership_validatable.rb
        ├── fulfillment_assignee_settable.rb
        └── order_creatable.rb
```

### After

```
app/
└── services/
    ├── create_order_service.rb          # 50 行（オーケストレーター）
    ├── cancel_order_service.rb          # 40 行（オーケストレーター）
    ├── order_recorder.rb                # 30 行
    ├── fulfillment_task_processor.rb    # 40 行
    ├── customer_assignee_processor.rb   # 20 行
    ├── customer_status_updater.rb       # 15 行
    ├── cancellation_recorder.rb         # 30 行
    ├── cancellation_assignee_processor.rb  # 25 行（CreateOrder と振る舞いが違う）
    └── concerns/
        └── service_base.rb              # 基盤のみ
```

**変化：**
- concern が 3 つ → 1 つに減った
- サービスの数は増えたが、1 ファイルあたりの行数は減った
- **責務が明確になり、どこに何があるか探しやすくなった**

---

## CancelOrderService への波及

リファクタリングによって、`CancelOrderService` も恩恵を受ける。

### Before

```ruby
# cancel_order_service.rb
class CancelOrderService
  include ServiceBase
  include FulfillmentOwnershipValidatable      # CreateOrder と共有
  include FulfillmentAssigneeSettable          # CreateOrder と共有（だが振る舞いが違う！）
  include CancellationCreatable

  # ...
end
```

### After

```ruby
# cancel_order_service.rb
class CancelOrderService
  include ServiceBase

  initialize_with :customer_id,
                  :current_staff_id,
                  :reason,
                  fulfillment_tasks: [],
                  task_ids_to_delete: [],
                  become_customer_assignee: nil

  is_callable

  def call
    customer = Customer.find(customer_id)

    ActiveRecord::Base.transaction do
      # ① キャンセルを記録する
      CancellationRecorder.call(
        customer_id: customer_id,
        current_staff_id: current_staff_id,
        reason: reason
      )

      # ② 配送タスクを処理する（CreateOrder と同じロジック）
      FulfillmentTaskProcessor.call(
        customer_id: customer_id,
        current_staff_id: current_staff_id,
        fulfillment_tasks: fulfillment_tasks,
        task_ids_to_delete: task_ids_to_delete
      )

      # ③ 担当スタッフを検証・変更する（CreateOrder と違うロジック）
      CancellationAssigneeProcessor.call(
        customer_id: customer_id,
        current_staff_id: current_staff_id,
        become_customer_assignee: become_customer_assignee
      )

      customer.reload
    end
  end
end
```

**CancellationAssigneeProcessor の中身：**

```ruby
# cancellation_assignee_processor.rb
class CancellationAssigneeProcessor
  include ServiceBase

  initialize_with :customer_id,
                  :current_staff_id,
                  :become_customer_assignee

  is_callable

  def call
    return if become_customer_assignee.nil?

    customer = Customer.find(customer_id)

    if become_customer_assignee
      # キャンセル処理は担当スタッフのみが可能
      unless customer.assignee_id == current_staff_id
        raise UnauthorizedAssigneeError, "キャンセルは担当スタッフのみ実行できます"
      end
    else
      customer.update!(assignee_id: nil)
    end
  end
end
```

**ポイント：**
- `FulfillmentTaskProcessor` は **CreateOrder と CancelOrder で共有** できる（振る舞いが同じ）
- `CancellationAssigneeProcessor` は **別のクラス** として切り出した（振る舞いが違う）
- concern の「見かけ上の共通化」が、 **実際の振る舞いの違いを明示的にした**

---

## よくある疑問

### Q1：「サービスの数が増えすぎないか？」

**A：増えるが、それは良いこと。**

1 つのファイルが複数の責務を持つより、複数のファイルがそれぞれ 1 つの責務を持つほうが、 **理解しやすく、変更しやすい** 。

「ファイルが増える」ことを恐れるより、「1 つのファイルに複雑さが集中する」ことを恐れるべきだ。

### Q2：「オーケストレーターが肥大化しないか？」

**A：肥大化したら、それも分離する。**

例えば、「注文作成」と「在庫の引き当て」と「メール送信」がすべて必要なら、さらに上位のサービスを作る。

```ruby
# order_workflow_service.rb
class OrderWorkflowService
  def call
    CreateOrderService.call(...)
    ReserveInventoryService.call(...)
    SendOrderConfirmationEmailService.call(...)
  end
end
```

オーケストレーションのレベルを **階層的に分ける** ことで、複雑さを管理できる。

### Q3：「トランザクションはどこで管理するか？」

**A：ビジネス要件に応じて決める。**

- **すべて成功 or すべて失敗** が必要なら、オーケストレーター（`CreateOrderService`）でトランザクションを張る
- **部分的に失敗しても続行** したいなら、各サービス内でトランザクションを張る

今回の例では、「注文作成」「配送タスク」「担当スタッフ」「顧客ステータス」は **すべて同時に成功すべき** なので、オーケストレーター側でトランザクションを張っている。

---

## まとめ

### SRP 違反のサイン

以下に当てはまったら、リファクタリングを検討しよう。

- [ ] 1 つのサービスが 3 つ以上の concern を include している
- [ ] `initialize_with` に 7 個以上のパラメータがある
- [ ] `call` メソッドの中に「① ② ③」とコメントで区切りたくなる処理がある
- [ ] concern の中で、別の concern のメソッドを呼んでいる
- [ ] 同じ concern を使う別のサービスで、振る舞いが異なる
- [ ] テストファイルが複数の関心事を扱っている

### リファクタリングの手順

1. **責務を洗い出す** → `call` メソッドの処理をグループ化
2. **各責務を独立したサービスにする** → concern を使わず、すべてクラス内に記述
3. **元のサービスをオーケストレーターにする** → 各サービスを呼び出すだけにする
4. **concern を最小限にする** → ビジネスロジックを含む concern は削除

### 最終的な設計原則

- **1 サービス = 1 責務** （変更の理由は 1 つ）
- **concern はインフラのみ** （ビジネスロジックを含めない）
- **依存を明示的にする** （`initialize_with` で必要なものがすべて見える）
- **テストを分離する** （責務ごとにテストファイルを分ける）

「1 つのサービスにまとめたほうが楽」という誘惑に負けず、 **責務を分離** しよう。それが、変更に強いコードを書く第一歩だ。

---

*この記事で取り上げたコードは、典型的な EC サイトの設計パターンをベースに簡略化した例です。*
