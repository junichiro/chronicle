#!/usr/bin/env node
// Stop hook。run の最中で、まだ片づけられる issue があれば止めずに続けさせる。
// run が始まっていなければ何もしない（GitHub にもつながない）。
import { createContext } from '../lib/context.mjs';
import { shouldKeepGoing } from '../lib/commands.mjs';

async function main() {
  const ctx = createContext();
  const { keepGoing, reason } = await shouldKeepGoing(ctx);
  if (!keepGoing) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `[longrun] ${reason}` }));
}

main().catch((error) => {
  // hook の不具合で止まれなくなるより、止まるほうを選ぶ
  process.stderr.write(`[longrun] Stop hook でエラー: ${error.message}\n`);
});
