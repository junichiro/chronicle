---
author: junichiro
pubDatetime: 2026-01-30T14:13:45+09:00
title: "「架電アクティビティ作成」に 4 つの仕事をさせていませんか？ — 単一責任の原則で Rails サービスを分解する"
slug: rails-srp-activity-service-refactoring
featured: true
draft: true
tags:
  - rails
  - refactoring
  - design-pattern
  - architecture
  - ruby
description: "Rails の CreateSomethingService が複数の責務を持つ問題を、実際のプロダクションコード（CTI架電アクティビティ作成）を題材に SRP に基づいてリファクタリングする方法を解説"
---

## はじめに

Rails アプリケーションで `CreateSomethingService` を書いたことがあるだろうか。最初は「Something を作る」だけのシンプルなサービスだったはずが、いつの間にか **関連するタスクの処理** 、 **担当者の変更** 、 **ステータスの更新** まで担当している。

```ruby
def call
  create_activity         # 本来の仕事
  process_tasks           # ...これも？
  process_assignee        # ...これも？？
  update_status           # ...これも？？？
end
```

「1 回の API リクエストで全部やらなきゃいけないんだから、1 つのサービスにまとめるのが自然でしょ？」

気持ちはわかる。だが、それは **単一責任の原則（SRP）** に反している。この記事では、実際のプロダクションコードを題材に、SRP 違反がどう問題を引き起こし、どうリファクタリングすべきかを詳しく解説する。

---

## 題材：架電アクティビティ作成サービス

今回取り上げるのは、CTI（電話）システムのバックエンドにある `CreateApproachTargetCallActivityService` だ。オペレーターが顧客に電話をかけた後、その結果を記録するためのサービスである。

### ビジネスの流れ

1. オペレーターが顧客に架電する
2. 通話が終わったら、フロントエンドから「アクション結果」「メモ」「次回タスク」「担当者になるかどうか」を送信する
3. バックエンドが **架電アクティビティを作成** し、関連する処理を実行する

一見すると「架電アクティビティの作成」という 1 つの仕事に見える。しかし実際のコードを見ると、そうではないことがわかる。

---

## Before：1 サービスに 4 つの仕事

### 全体像

まずファイルの構造を俯瞰しよう。

```ruby
# create_approach_target_call_activity_service.rb
class CreateApproachTargetCallActivityService
  include ServiceBase
  include TaskOwnershipValidatable      # タスク所有権の検証
  include TaskAssigneeSettable          # タスク担当者の自動設定
  include ApproachTargetActivityCreatable  # アクティビティ作成の共通処理

  initialize_with :approach_target_id,
                  :project_id,
                  :call_uuid,
                  :phone_number_id,
                  :current_organization_user_id,
                  :action_result_id,
                  memo: nil,
                  tasks: [],                           # タスク処理用
                  task_ids_to_delete: [],               # タスク削除用
                  become_approach_target_assignee: nil  # 担当者処理用

  is_callable
end
```

この時点で 3 つの concern を include し、10 個のパラメータを受け取っている。名前は「CallActivity を Create する Service」だが、パラメータを見ると `tasks`, `task_ids_to_delete`, `become_approach_target_assignee` という **明らかにアクティビティ作成とは別の仕事のためのデータ** が混じっている。

### call メソッドの中身

```ruby
def call
  # バリデーション（タスク関連）
  validate_task_ownership!
  validate_delete_task_ownership!

  # 準備
  approach_target = find_approach_target
  call = find_call
  approach_target_call = find_approach_target_call(call)
  next_status = determine_next_status(approach_target)
  status_from = approach_target.status_id
  effective_status = next_status || approach_target.status

  ActiveRecord::Base.transaction do
    # ① アクティビティ + CallActivity 作成
    activity = create_activity(approach_target, status_from, effective_status)
    create_call_activity(activity, approach_target_call)

    # ② タスクの作成/更新/完了/削除
    process_tasks(approach_target)

    # ③ 担当者の割り当て/解除
    process_assignee(approach_target)

    # ④ ステータスの更新
    update_status(approach_target, next_status) if next_status.present?

    approach_target.reload
  end
end
```

コメントの番号を見てほしい。 **4 つの異なる処理** がこの `call` メソッドの中で実行されている。

---

## 何が問題なのかを掘り下げる

### 問題 1：4 つの異なる「変更の理由」がある

SRP の定義は「クラスは 1 つの理由でのみ変更されるべき」だ。このサービスには以下の変更理由がある。

| 変更の理由 | 例 |
|-----------|-----|
| アクティビティの記録方法が変わる | `ApproachTargetCallActivity` に新しいカラムを追加する |
| タスクの処理ルールが変わる | タスクの自動完了条件を変更する |
| 担当者の割り当てルールが変わる | 「既に担当者がいる場合の振る舞い」を変更する |
| ステータス遷移ルールが変わる | 新しいアクション結果に対するステータス遷移を追加する |

4 つの理由のうちどれか 1 つが変わるだけで、このファイルを修正する必要がある。

### 問題 2：concern の「隠れた依存」

3 つの concern がそれぞれ **特定のアクセサの存在を前提としている** 。

```ruby
# TaskOwnershipValidatable が要求するもの
#   - tasks
#   - task_ids_to_delete
#   - current_organization_user_id
#   - find_approach_target （メソッド）

# TaskAssigneeSettable が要求するもの
#   - tasks
#   - current_organization_user_id

# ApproachTargetActivityCreatable が要求するもの
#   - approach_target_id
#   - project_id
#   - current_organization_user_id
#   - memo
#   - tasks （process_tasks で使う）
#   - task_ids_to_delete （process_tasks で使う）
#   - version （verify_version! で使う）
```

`ApproachTargetActivityCreatable` は特に問題だ。「アクティビティを作る」という名前だが、実際には **タスク処理** （`process_tasks`）と **ステータス更新** （`update_status`）と **バージョン検証** （`verify_version!`）も含んでいる。

```ruby
# approach_target_activity_creatable.rb の中身
module ApproachTargetActivityCreatable
  private

  def find_approach_target                        # アプローチ先の検索
    ApproachTarget.find_by!(id: approach_target_id, project_id: project_id)
  end

  def create_activity(approach_target, ...)        # アクティビティの作成
    ApproachTargetActivity.create!(...)
  end

  def update_status(approach_target, next_status)  # ステータス更新
    approach_target.update!(status_id: next_status.id)
  end

  def process_tasks(approach_target)               # タスク処理
    UpsertApproachTargetTaskService.call(approach_target: approach_target, tasks: tasks_with_assignee)
    DeleteApproachTargetTaskService.call(approach_target: approach_target, task_ids: task_ids_to_delete)
  end

  def verify_version!(approach_target)             # バージョン検証
    return if version.blank?
    return if approach_target.latest_version?(version)
    raise VersionConflictError, '他のユーザーによってデータが更新されました。'
  end
end
```

concern が 4 つの責務をバンドルしているため、include した時点でこの 4 つすべてに依存することになる。

### 問題 3：DisqualificationActivityService との「コピペ的共有」

この concern はもう 1 つのサービス `CreateApproachTargetDisqualificationActivityService` でも使われている。しかし 2 つのサービスでは **`process_assignee` の振る舞いが全く違う** 。

```ruby
# CallActivityService の process_assignee
# → become_approach_target_assignee が true なら担当者に「なれる」
def process_assignee(approach_target)
  if become_approach_target_assignee
    assign_to_current_user(approach_target)
  else
    unassign_from_current_user(approach_target)
  end
end

# DisqualificationActivityService の process_assignee
# → become_approach_target_assignee が true で担当者でなければ「エラー」
def process_assignee(approach_target)
  return if become_approach_target_assignee.nil?
  if become_approach_target_assignee == false
    approach_target.unassign_in_charge if is_current_user_assignee
  elsif become_approach_target_assignee == true && !is_current_user_assignee
    raise ContractValidationError, { become_approach_target_assignee: ['担当者でないユーザーは架電前に担当者になれません'] }
  end
end
```

同じパラメータ名、同じメソッド名、しかし **`true` を渡したときの振る舞いが正反対** 。concern で共通化されている部分と、各サービスで個別に定義されている部分の境界が曖昧で、全体の設計が把握しづらくなっている。

### 問題 4：テストが肥大化する

```ruby
RSpec.describe CreateApproachTargetCallActivityService do
  # テストの setup に Call, ApproachTargetCall, ApproachTarget, Project,
  # OrganizationUser, Task, PhoneNumber などの factory が全部必要

  context 'アクティビティ作成' do
    it 'ApproachTargetActivity が作成される' do ... end
    it 'ApproachTargetCallActivity が作成される' do ... end
  end

  context 'タスク処理' do
    context '新規タスクの場合' do
      it 'タスクが作成される' do ... end
    end
    context '既存タスクの完了の場合' do
      it 'completed_at が設定される' do ... end
    end
    context 'タスクの削除の場合' do
      it 'タスクが削除される' do ... end
    end
    context '他人のタスクを更新しようとした場合' do
      it 'エラーになる' do ... end
    end
  end

  context '担当者処理' do
    context '担当者になる場合' do
      it '担当者が割り当てられる' do ... end
    end
    context '既に別の担当者がいる場合' do
      it 'エラーになる' do ... end
    end
    context '担当者を外れる場合' do
      it '担当者が解除される' do ... end
    end
  end

  context 'ステータス更新' do
    it 'ステータスが遷移する' do ... end
    it '遷移先がない場合は更新しない' do ... end
  end
end
```

アクティビティ作成のテストを書いているのに、タスクや担当者の setup まで必要になる。テストが遅く、壊れやすく、何を検証しているのかが読みにくい。

---

## リファクタリングの方針

以下の原則に従う。

1. **各責務を独立したサービスに分離する**
2. 元のサービスは **オーケストレーション（調整役）** に徹する
3. 分離したサービスは **個別にテスト可能** にする
4. concern は **本当に共通な最小限のメソッド** だけ提供する

---

## After：責務ごとにサービスを分離する

### Step 1: 責務を洗い出す

現在の `call` メソッドを観察して、独立した責務を抽出する。

| # | 責務 | 現在の実装場所 | 依存するデータ |
|---|------|---------------|---------------|
| 1 | 架電アクティビティの作成 | `create_activity` + `create_call_activity` | approach_target, call_uuid, phone_number_id, action_result_id, memo |
| 2 | タスクの作成/更新/削除 | `process_tasks` (concern) → 2 つの子サービス | approach_target, tasks, task_ids_to_delete, current_user_id |
| 3 | 担当者の割り当て/解除 | `process_assignee` (サービス内) | approach_target, become_assignee, current_user_id |
| 4 | ステータスの更新 | `update_status` (concern) | approach_target, action_result_id |

### Step 2: 各責務を独立したサービスにする

#### 1. CallActivityRecorder — アクティビティの作成だけに集中

```ruby
# app/services/call_activity_recorder.rb
#
# 架電アクティビティのレコード作成のみを担当する。
# タスク・担当者・ステータスの変更は行わない。
class CallActivityRecorder
  include ServiceBase

  initialize_with :approach_target,
                  :call_uuid,
                  :phone_number_id,
                  :current_organization_user_id,
                  :action_result_id,
                  :memo

  is_callable

  # @return [ApproachTargetActivity] 作成されたアクティビティ
  def call
    call_record = find_call!
    approach_target_call = find_approach_target_call!(call_record)
    next_status = determine_next_status

    status_from = approach_target.status_id
    effective_status = next_status || approach_target.status

    activity = ApproachTargetActivity.create!(
      approach_target: approach_target,
      organization_user_id: current_organization_user_id,
      executed_at: Time.current,
      status_from: status_from,
      status_to: effective_status.id,
      memo: memo,
    )

    ApproachTargetCallActivity.create!(
      approach_target_activity: activity,
      approach_target_call: approach_target_call,
      phone_number_id: phone_number_id,
      call_action_result_id: action_result_id,
    )

    { activity: activity, next_status: next_status }
  end

  private

  def find_call!
    Call.find_by(uuid: call_uuid) ||
      raise(ContractValidationError, { call_uuid: ['有効な通話が見つかりません'] })
  end

  def find_approach_target_call!(call_record)
    call_record.approach_target_call ||
      raise(ContractValidationError, { call_uuid: ['通話に紐付くApproachTargetCallが見つかりません'] })
  end

  def determine_next_status
    action_result = ApproachTargetCallActivity::CallActionResult[action_result_id]
    approach_target.status.next_status(action_result)
  end
end
```

**ポイント** : パラメータはアクティビティ作成に必要なものだけ。`tasks` や `become_approach_target_assignee` は含まない。

#### 2. ApproachTargetAssigneeProcessor — 担当者の変更だけに集中

```ruby
# app/services/approach_target_assignee_processor.rb
#
# アプローチ先の担当者割り当て/解除のみを担当する。
class ApproachTargetAssigneeProcessor
  include ServiceBase

  initialize_with :approach_target,
                  :current_organization_user_id,
                  :become_assignee

  is_callable

  # @return [void]
  def call
    return if become_assignee.nil?

    if become_assignee
      assign_to_current_user
    else
      unassign_from_current_user
    end
  end

  private

  def assign_to_current_user
    return if already_assignee?

    validate_no_existing_assignee!
    approach_target.assign_in_charge(find_current_user!)
  end

  def unassign_from_current_user
    return unless already_assignee?

    approach_target.unassign_in_charge
  end

  def already_assignee?
    approach_target.in_charge_user&.id == current_organization_user_id
  end

  def validate_no_existing_assignee!
    existing = approach_target.in_charge_user
    return if existing.nil? || existing.id == current_organization_user_id

    raise ContractValidationError,
          { become_approach_target_assignee: ['既に別の担当者が割り当てられています'] }
  end

  def find_current_user!
    OrganizationUser.find_by(id: current_organization_user_id) ||
      raise(ContractValidationError, { become_approach_target_assignee: ['組織ユーザーが見つかりません'] })
  end
end
```

**ポイント** : 担当者処理のロジックが完全にここに閉じている。`CallActivityService` と `DisqualificationActivityService` で振る舞いが違う場合は、それぞれ別の Processor を用意するか、コンストラクタでポリシーを注入すればよい。

#### 3. ApproachTargetStatusUpdater — ステータス更新だけに集中

```ruby
# app/services/approach_target_status_updater.rb
#
# アプローチ先のステータス更新のみを担当する。
class ApproachTargetStatusUpdater
  include ServiceBase

  initialize_with :approach_target, :next_status

  is_callable

  # @return [void]
  def call
    return if next_status.blank?

    approach_target.update!(status_id: next_status.id)
  end
end
```

**ポイント** : たった 1 行のロジックだが、独立させることで「ステータスは誰が更新するのか」が明確になる。

#### 4. タスク処理 — 既存の子サービスをそのまま使う

タスクの作成/更新は `UpsertApproachTargetTaskService`、削除は `DeleteApproachTargetTaskService` が既に存在する。concern 経由で呼んでいたものを直接呼べばよい。

### Step 3: 元のサービスをオーケストレーターに変える

```ruby
# create_approach_target_call_activity_service.rb（リファクタリング後）
#
# 架電後のアクティビティ作成をオーケストレーションするサービス
#
# 以下の処理を順番に実行する:
# 1. バリデーション
# 2. 架電アクティビティの作成
# 3. タスクの処理
# 4. 担当者の変更
# 5. ステータスの更新
class CreateApproachTargetCallActivityService
  include ServiceBase
  include TaskOwnershipValidatable
  include TaskAssigneeSettable

  initialize_with :approach_target_id,
                  :project_id,
                  :call_uuid,
                  :phone_number_id,
                  :current_organization_user_id,
                  :action_result_id,
                  memo: nil,
                  tasks: [],
                  task_ids_to_delete: [],
                  become_approach_target_assignee: nil

  is_callable

  def call
    validate_task_ownership!
    validate_delete_task_ownership!

    approach_target = find_approach_target

    ActiveRecord::Base.transaction do
      # ① 架電アクティビティの作成
      result = CallActivityRecorder.call(
        approach_target: approach_target,
        call_uuid: call_uuid,
        phone_number_id: phone_number_id,
        current_organization_user_id: current_organization_user_id,
        action_result_id: action_result_id,
        memo: memo,
      )

      # ② タスクの作成/更新/削除
      UpsertApproachTargetTaskService.call(
        approach_target: approach_target,
        tasks: tasks_with_assignee,
      )
      DeleteApproachTargetTaskService.call(
        approach_target: approach_target,
        task_ids: task_ids_to_delete,
      )

      # ③ 担当者の割り当て/解除
      ApproachTargetAssigneeProcessor.call(
        approach_target: approach_target,
        current_organization_user_id: current_organization_user_id,
        become_assignee: become_approach_target_assignee,
      )

      # ④ ステータスの更新
      ApproachTargetStatusUpdater.call(
        approach_target: approach_target,
        next_status: result[:next_status],
      )

      approach_target.reload
    end
  end

  private

  def find_approach_target
    ApproachTarget.find_by!(id: approach_target_id, project_id: project_id)
  end
end
```

### Step 4: concern を最小限にする

`ApproachTargetActivityCreatable` は不要になる。`find_approach_target` はサービスに直接書けばよい。`process_tasks` と `update_status` は独立したサービスに分離済み。

残す concern は以下の 2 つだけ:

- **`TaskOwnershipValidatable`** — タスク所有権の検証（純粋なバリデーション）
- **`TaskAssigneeSettable`** — タスク担当者の自動設定（データ変換）

---

## テストの変化

### Before：すべての context が 1 つのテストファイルに

```ruby
RSpec.describe CreateApproachTargetCallActivityService do
  # setup: Call, ApproachTargetCall, ApproachTarget, Project,
  #        OrganizationUser, Task, PhoneNumber の factory がすべて必要

  # 4つのドメインのテストが混在（全部で 15+ テストケース）
  context 'アクティビティ作成' do ... end    # 2 cases
  context 'タスク処理' do ... end            # 5 cases
  context '担当者処理' do ... end            # 4 cases
  context 'ステータス更新' do ... end        # 2 cases
  context '異常系' do ... end               # 3 cases
end
```

### After：各サービスが独立してテスト可能に

```ruby
# spec/services/call_activity_recorder_spec.rb
# 必要な factory: Call, ApproachTargetCall, ApproachTarget のみ
RSpec.describe CallActivityRecorder do
  it 'ApproachTargetActivity を作成する' do ... end
  it 'ApproachTargetCallActivity を作成する' do ... end
  it 'next_status を返す' do ... end
  it 'Call が見つからない場合はエラー' do ... end
end

# spec/services/approach_target_assignee_processor_spec.rb
# 必要な factory: ApproachTarget, OrganizationUser のみ
RSpec.describe ApproachTargetAssigneeProcessor do
  context 'become_assignee が true' do
    it '担当者が割り当てられる' do ... end
    it '既に別の担当者がいる場合はエラー' do ... end
  end
  context 'become_assignee が false' do
    it '担当者が解除される' do ... end
  end
  context 'become_assignee が nil' do
    it '何もしない' do ... end
  end
end

# spec/services/approach_target_status_updater_spec.rb
# 必要な factory: ApproachTarget のみ
RSpec.describe ApproachTargetStatusUpdater do
  it 'ステータスを更新する' do ... end
  it 'next_status が nil の場合は更新しない' do ... end
end

# spec/services/create_approach_target_call_activity_service_spec.rb
# オーケストレーションのテスト — 各サービスが呼ばれることを検証
RSpec.describe CreateApproachTargetCallActivityService do
  it '全サービスがトランザクション内で呼ばれる' do
    expect(CallActivityRecorder).to receive(:call).and_return({ activity: activity, next_status: status })
    expect(UpsertApproachTargetTaskService).to receive(:call)
    expect(DeleteApproachTargetTaskService).to receive(:call)
    expect(ApproachTargetAssigneeProcessor).to receive(:call)
    expect(ApproachTargetStatusUpdater).to receive(:call)

    described_class.call(...)
  end
end
```

**各テストの変化:**

| テストファイル | Before の setup | After の setup |
|-------------|----------------|----------------|
| アクティビティ作成 | Call + ApproachTargetCall + AT + Project + User + Task + Phone | Call + ApproachTargetCall + AT |
| 担当者処理 | 同上すべて | AT + User のみ |
| ステータス更新 | 同上すべて | AT のみ |
| オーケストレーション | 同上すべて | モック中心 |

---

## ファイル構成の変化

### Before

```
app/services/
├── create_approach_target_call_activity_service.rb  # 140行: 4つの責務が混在
├── concerns/
│   ├── approach_target_activity_creatable.rb         # 82行: 5つのメソッドを束ねた concern
│   ├── task_ownership_validatable.rb                 # バリデーション
│   └── task_assignee_settable.rb                     # データ変換
├── upsert_approach_target_task_service.rb            # タスクの作成/更新
└── delete_approach_target_task_service.rb             # タスクの削除
```

### After

```
app/services/
├── create_approach_target_call_activity_service.rb  # 60行: オーケストレーションのみ
├── call_activity_recorder.rb                         # 60行: アクティビティ作成のみ
├── approach_target_assignee_processor.rb             # 50行: 担当者処理のみ
├── approach_target_status_updater.rb                 # 15行: ステータス更新のみ
├── concerns/
│   ├── task_ownership_validatable.rb                 # バリデーション（変更なし）
│   └── task_assignee_settable.rb                     # データ変換（変更なし）
├── upsert_approach_target_task_service.rb            # タスクの作成/更新（変更なし）
└── delete_approach_target_task_service.rb             # タスクの削除（変更なし）
```

`approach_target_activity_creatable.rb` は削除。各サービスが必要なメソッドを自分で持つ。

---

## DisqualificationActivityService への波及

リファクタリングの効果は、もう 1 つのサービス `CreateApproachTargetDisqualificationActivityService` にも及ぶ。

### Before：concern 経由で暗黙的に共有

```ruby
class CreateApproachTargetDisqualificationActivityService
  include ApproachTargetActivityCreatable  # 同じ concern を include
  # しかし process_assignee は独自に再定義...
end
```

### After：各サービスを明示的に呼ぶ

```ruby
class CreateApproachTargetDisqualificationActivityService
  def call
    # ...

    ActiveRecord::Base.transaction do
      if action_result_id.present?
        result = DisqualificationActivityRecorder.call(...)  # 別のレコーダー
        ApproachTargetStatusUpdater.call(...)                 # 共通のステータス更新
      end

      UpsertApproachTargetTaskService.call(...)              # タスク処理は共通
      DeleteApproachTargetTaskService.call(...)

      DisqualificationAssigneeProcessor.call(...)            # 担当者処理は別ロジック
    end
  end
end
```

**CallActivity と Disqualification で振る舞いが異なる部分** （`ActivityRecorder`, `AssigneeProcessor`）は別クラスにし、 **共通する部分** （`StatusUpdater`, `TaskService`）は同じクラスを再利用する。concern で暗黙的に共有するのではなく、 **どのサービスを使うかを各オーケストレーターが明示的に選ぶ** 。

---

## よくある疑問

### 「サービスが増えすぎでは？」

ファイル数は増える。しかし各ファイルは 15〜60 行で、1 つの仕事しかしない。重要なのは「ファイル数」ではなく以下の指標だ:

| 指標 | Before | After |
|------|--------|-------|
| 1ファイルの最大行数 | 140行 | 60行 |
| 変更時の影響ファイル数 | 1（だが全テストに影響） | 1（そのサービスのテストのみ影響） |
| テスト 1 件の setup 量 | 多い（全ドメインの factory） | 少ない（そのドメインの factory のみ） |
| コードの場所の予測可能性 | 低い（concern を追わないとわからない） | 高い（ファイル名で責務がわかる） |

### 「1 つのトランザクションにまとめる必要があるのでは？」

その通り。だから **オーケストレーターが残る** 。トランザクション管理はオーケストレーターの仕事であり、各サービスは「トランザクションの中で呼ばれる」ことを前提にしてよい。

```ruby
# オーケストレーターがトランザクションを管理する
ActiveRecord::Base.transaction do
  CallActivityRecorder.call(...)        # 自分ではトランザクションを張らない
  UpsertApproachTargetTaskService.call(...)
  ApproachTargetAssigneeProcessor.call(...)
  ApproachTargetStatusUpdater.call(...)
end
```

### 「Controller から直接各サービスを呼べばいいのでは？」

Controller がビジネスロジックの順序を知ることになるので推奨しない。Controller は「何を呼ぶか」だけ知っていればよく、「どの順序で何を実行するか」はサービス層の責務だ。

```ruby
# NG: Controller がオーケストレーションを担う
class CallActivitiesController < ApplicationController
  def create
    approach_target = ApproachTarget.find(params[:id])
    CallActivityRecorder.call(...)
    UpsertApproachTargetTaskService.call(...)
    ApproachTargetAssigneeProcessor.call(...)
    ApproachTargetStatusUpdater.call(...)
  end
end

# OK: Controller はオーケストレーターを呼ぶだけ
class CallActivitiesController < ApplicationController
  def create
    CreateApproachTargetCallActivityService.call(
      approach_target_id: params[:id],
      # ...
    )
  end
end
```

---

## まとめ

### SRP 違反のサイン

このリファクタリングが必要だったサインをまとめる。

1. **パラメータが 7 個を超えている** — `tasks`, `task_ids_to_delete`, `become_approach_target_assignee` は「アクティビティ作成」のためのパラメータではない
2. **concern が複数の無関係なメソッドを束ねている** — `ApproachTargetActivityCreatable` に `process_tasks` と `update_status` が入っている
3. **テストの setup が巨大** — アクティビティ作成のテストにタスクの factory が必要
4. **同名メソッドが異なるサービスで違う振る舞いをする** — `process_assignee` が CallActivity と Disqualification で正反対

### リファクタリングの手順

1. `call` メソッド内の処理を **番号付きコメントで区分** する（既にやっていた）
2. 各番号が **独立した変更理由** を持つか確認する
3. 独立した責務ごとに **新しいサービスクラス** を作る
4. 元のサービスを **オーケストレーター** に変える
5. concern を見直し、 **不要になったメソッドを削除** する
6. テストを各サービスに **分散** させる

### 最終的な設計原則

> **サービスの名前が「〜を作成する」なら、本当に作成だけをやっているか確認しよう。**
> 作成 + タスク処理 + 担当者変更 + ステータス更新 = 4 つのサービスであり、1 つではない。

---

*この記事で取り上げたコードは、実際のプロダクションコードをベースに簡略化したものです。*
