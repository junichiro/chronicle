#!/usr/bin/env node
// GitHub Actions から呼ぶ入口。結果は JSON で標準出力に出す。
//
//   automerge   取り込み先（baseBranch）宛ての、作業ブランチ（headPrefix）の PR のうち、CI がすべて成功したものをマージする
//   sync        本番のブランチを取り込み先に取り込む（衝突したら issue を立てる）
//   dispatch    片づける issue があり、ほかの run が動いていなければ routine を起動する
//               （環境変数 LONGRUN_ROUTINE_TOKEN と config.json の routineId を使う）
import { createContext } from '../lib/context.mjs';
import { automergeSweep, syncBase, dispatchRoutine } from '../lib/actions.mjs';
import { createFire } from '../lib/routine-api.mjs';

const COMMANDS = {
  automerge: (ctx) => automergeSweep(ctx),
  sync: (ctx) => syncBase(ctx),
  // 設定（routineId・トークン）は、起動が要るときにだけ読む
  dispatch: (ctx) => dispatchRoutine(ctx, () => createFire({ routineId: ctx.config.routineId, token: process.env.LONGRUN_ROUTINE_TOKEN })()),
};

async function main() {
  const command = process.argv[2];
  const handler = COMMANDS[command];
  if (!handler) throw new Error(`知らないコマンドです: ${command}。使えるのは ${Object.keys(COMMANDS).join(', ')}`);
  const result = await handler(createContext());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
