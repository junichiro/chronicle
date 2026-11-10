#!/usr/bin/env node
// longrun の CLI。結果は JSON で標準出力に出す。
//
//   start                                   run を始める（記録用 issue・ロック・本番のブランチの取り込み）
//   peek                                    片づける issue があるかを見るだけ（GitHub に何も書かない）
//   next                                    次の issue を確保する
//   spawn --title T (--body B | --body-file F)  見つけた課題を issue にする
//   pr --branch B --title T (--body B | --body-file F)  取り込み先（baseBranch）宛ての PR を作る
//   wait --pr N [--seconds 540]             PR が取り込み先にマージされるのを待つ（マージは GitHub Actions が行う）
//   finish (--ok | --failed | --needs-human) --note "..."  作業中の issue を締める
//   end [--reason R]                        run を終える
//   status                                  ローカルの状態を見る
//   doctor                                  導入できたかを項目ごとに確かめる（GitHub に何も書かない。NG があれば終了コード 1）
import { readFileSync } from 'node:fs';
import { createContext } from '../lib/context.mjs';
import { startRun, claimNext, spawnIssue, openPr, waitForMerge, finishIssue, endRun, peekWork } from '../lib/commands.mjs';
import { runDoctor } from '../lib/doctor.mjs';

// コマンド 1 回の実行時間の上限（10 分）より短くする
const DEFAULT_WAIT_SECONDS = 540;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i].replace(/^--/, '');
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = value;
      i += 1;
    }
  }
  return { command, options };
}

function required(options, key) {
  if (options[key] === undefined || options[key] === true) throw new Error(`--${key} を指定してください`);
  return options[key];
}

function bodyOf(options) {
  if (options['body-file']) return readFileSync(options['body-file'], 'utf8');
  return typeof options.body === 'string' ? options.body : '';
}

const COMMANDS = {
  peek: (ctx) => peekWork(ctx),
  start: (ctx) => startRun(ctx),
  next: (ctx) => claimNext(ctx),
  spawn: (ctx, o) => spawnIssue(ctx, { title: required(o, 'title'), body: bodyOf(o) }),
  pr: (ctx, o) => openPr(ctx, { branch: required(o, 'branch'), title: required(o, 'title'), body: bodyOf(o) }),
  wait: (ctx, o) => waitForMerge(ctx, { pr: Number(required(o, 'pr')), waitSeconds: Number(o.seconds ?? DEFAULT_WAIT_SECONDS) }),
  finish: (ctx, o) => {
    if (!o.ok && !o.failed && !o['needs-human']) throw new Error('--ok・--failed・--needs-human のどれかを指定してください');
    return finishIssue(ctx, { ok: Boolean(o.ok), needsHuman: Boolean(o['needs-human']), note: required(o, 'note') });
  },
  end: (ctx, o) => endRun(ctx, typeof o.reason === 'string' ? o.reason : '終了'),
  status: (ctx) => ctx.state.load() ?? { running: false },
  doctor: async (ctx) => {
    const result = await runDoctor(ctx, ctx.root);
    if (!result.ok) process.exitCode = 1;
    return result;
  },
};

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const handler = COMMANDS[command];
  if (!handler) throw new Error(`知らないコマンドです: ${command}。使えるのは ${Object.keys(COMMANDS).join(', ')}`);
  const result = await handler(createContext(), options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
});
