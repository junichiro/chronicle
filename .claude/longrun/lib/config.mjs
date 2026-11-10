import { existsSync, readFileSync } from 'node:fs';

export const DEFAULT_CONFIG = Object.freeze({
  // エージェントがマージしてよいブランチ。本番のブランチは人間がマージする
  baseBranch: 'develop',
  productionBranch: 'main',
  timezone: 'Asia/Tokyo',
  // 新しい issue に手をつけてよい時間帯。既定はいつでも。
  // 例: 夜だけ回すなら { "startHour": 23, "endHour": 7 }
  window: null,
  // 1 回の run の持ち時間。毎時の routine で回すなら間隔（1 時間）より短くする
  runBudgetMinutes: 50,
  // これより古いロックは、落ちた run の残りとみなして引き継ぐ
  lockTtlMinutes: 90,
  // Actions が routine を起動してから、この時間は次の起動を控える（起動された run がロックを書くまでの隙間を埋める）
  fireGraceMinutes: 15,
  // Actions から起動する routine の ID（trig_ で始まる）。トークンは GitHub のシークレット LONGRUN_ROUTINE_TOKEN に置く
  routineId: null,
  limits: { maxSpawned: 10, maxDepth: 2, maxConsecutiveFailures: 3 },
  // PR を作ってからこの時間 CI が一つも現れなければ失敗とみなす
  noChecksGraceMinutes: 10,
  // 確認コマンド。手順書は PR の前にこれをすべて実行する。空なら CLAUDE.md に書いたものを使う。
  // install.mjs が、無人で走れるようにこれらの許可を settings.json に足す。例: ["pnpm lint", "pnpm test"]
  verify: [],
  // settings.json に足したい許可（verify のほかに要るもの）。例: ["Bash(docker compose run:*)"]
  allow: [],
  // 入れる部品（GitHub Actions のワークフロー）。false にすると install.mjs が入れず、入れてあれば消す
  //   dispatch:  要るときだけ routine を起動する。routine を使わず手元や claude --cloud だけで回すなら要らない
  //   sync:      本番のブランチを baseBranch に取り込む。別の仕組みで取り込むなら要らない（baseBranch と productionBranch が同じなら入れない）
  //   automerge: CI が通った PR をマージする。false なら人間がマージし、エージェントは CI が通ったところで次へ進む
  components: { dispatch: true, sync: true, automerge: true },
  // 自動マージ（GitHub Actions）の設定
  mergeMethod: 'squash',
  headPrefix: 'claude/',
  // 自動マージしたあと、PR の作業ブランチを消す
  deleteBranchAfterMerge: true,
  automergeCheckName: 'longrun-automerge',
  // 自動マージを起こすワークフローの名前（install がワークフローに書き込む）
  ciWorkflows: ['CI'],
  labels: {
    queue: 'longrun',
    wip: 'longrun:wip',
    failed: 'longrun:failed',
    journal: 'longrun:journal',
    deferred: 'longrun:deferred',
    needsHuman: 'longrun:needs-human',
    // components.automerge が false のとき、CI が通って人間のマージを待っている issue
    awaitingMerge: 'longrun:awaiting-merge',
  },
});

export function loadConfig(path) {
  if (!existsSync(path)) return DEFAULT_CONFIG;
  const custom = JSON.parse(readFileSync(path, 'utf8'));
  return {
    ...DEFAULT_CONFIG,
    ...custom,
    limits: { ...DEFAULT_CONFIG.limits, ...custom.limits },
    components: { ...DEFAULT_CONFIG.components, ...custom.components },
    labels: { ...DEFAULT_CONFIG.labels, ...custom.labels },
  };
}

export const COMPONENTS = Object.freeze(['dispatch', 'sync', 'automerge']);

// 部品を使うか。sync は取り込むものがなければ（baseBranch と productionBranch が同じなら）使わない
export function componentEnabled(config, name) {
  if (config.components?.[name] === false) return false;
  if (name === 'sync') return config.baseBranch !== config.productionBranch;
  return true;
}

// install.mjs が手順書・ワークフロー・settings.json に書き込む設定の値。
// manifest.json に残し、doctor が今の config.json と比べる（変えて入れ直していなければ食い違う）
export function installedSettings(config) {
  return {
    baseBranch: config.baseBranch,
    productionBranch: config.productionBranch,
    headPrefix: config.headPrefix,
    ciWorkflows: config.ciWorkflows,
    queueLabel: config.labels?.queue,
    components: COMPONENTS.map((name) => [name, componentEnabled(config, name)]),
    verify: config.verify ?? [],
    allow: config.allow ?? [],
  };
}

// install が新しいリポジトリに置く最小の設定。ほかは DEFAULT_CONFIG に任せる
export const INITIAL_CONFIG = Object.freeze({
  baseBranch: DEFAULT_CONFIG.baseBranch,
  productionBranch: DEFAULT_CONFIG.productionBranch,
});
