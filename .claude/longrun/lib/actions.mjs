// GitHub Actions から動かす処理。クラウドのエージェントにはマージの API が許されていないため、
// マージと本番のブランチの取り込みはここで行う。
import { componentEnabled } from './config.mjs';
import { evaluateChecks, readMarker, writeMarker } from './rules.mjs';
import { peekWork, findOrCreateJournal, record } from './commands.mjs';

function isLongrunPr(pr, config) {
  const sameRepo = pr.head.repo?.full_name === pr.base.repo?.full_name;
  return sameRepo && pr.head.ref.startsWith(config.headPrefix);
}

async function alreadyReported(ctx, pr) {
  const comments = await ctx.gh.listComments(pr.number);
  return comments.some((comment) => {
    const marker = readMarker(comment.body);
    return marker?.kind === 'automerge-failed' && marker.sha === pr.head.sha;
  });
}

async function reportFailure(ctx, pr, reason) {
  if (await alreadyReported(ctx, pr)) return;
  const text = `longrun の自動マージに失敗しました（${pr.head.sha.slice(0, 7)}）: ${reason}`;
  await ctx.gh.comment(pr.number, `${text}\n\n${writeMarker({ kind: 'automerge-failed', sha: pr.head.sha, reason })}`);
}

async function tryMerge(ctx, pr) {
  const runs = (await ctx.gh.listCheckRuns(pr.head.sha)).filter((run) => run.name !== ctx.config.automergeCheckName);
  const verdict = evaluateChecks(runs);
  if (verdict !== 'success') return { pr: pr.number, merged: false, why: verdict };
  try {
    await ctx.gh.mergePr(pr.number, ctx.config.mergeMethod);
  } catch (error) {
    await reportFailure(ctx, pr, error.message);
    return { pr: pr.number, merged: false, why: error.message };
  }
  const result = { pr: pr.number, merged: true };
  if (ctx.config.deleteBranchAfterMerge === false) return result;
  // 消すのは longrun の PR の head だけ（tryMerge に来るのはそれだけ）。失敗してもマージは成功のまま返す
  try {
    await ctx.gh.deleteBranch(pr.head.ref);
    result.branchDeleted = true;
  } catch (error) {
    result.branchDeleted = false;
    result.branchDeleteError = error.message;
  }
  return result;
}

// 取り込み先（baseBranch）宛ての longrun の PR のうち、CI がすべて成功したものをマージする
export async function automergeSweep(ctx) {
  if (!componentEnabled(ctx.config, 'automerge')) return { merged: [], skipped: [], reason: 'components.automerge が false なのでマージしない' };
  const prs = (await ctx.gh.listOpenPrs(ctx.config.baseBranch)).filter((pr) => isLongrunPr(pr, ctx.config));
  const results = [];
  for (const pr of prs) results.push(await tryMerge(ctx, pr));
  return {
    merged: results.filter((result) => result.merged).map((result) => result.pr),
    skipped: results.filter((result) => !result.merged),
    // マージはできたが作業ブランチを消せなかったもの（理由つき）
    branchDeleteFailed: results
      .filter((result) => result.merged && result.branchDeleted === false)
      .map((result) => ({ pr: result.pr, error: result.branchDeleteError })),
  };
}

// 本番のブランチ（productionBranch）を取り込み先（baseBranch）に取り込む。衝突したら人間に知らせる issue を立てる
export async function syncBase(ctx) {
  const { baseBranch, productionBranch, labels } = ctx.config;
  // 一本のブランチで運用するなら、取り込むものがない。部品を外していれば何もしない
  if (baseBranch === productionBranch) return { result: 'same-branch' };
  if (!componentEnabled(ctx.config, 'sync')) return { result: 'disabled' };
  const result = await ctx.gh.mergeBranches(baseBranch, productionBranch);
  if (result !== 'conflict') return { result };

  const title = `${productionBranch} を ${baseBranch} に取り込めません（衝突）`;
  const open = await ctx.gh.listOpenIssues(labels.needsHuman);
  const existing = open.find((issue) => issue.title === title);
  if (existing) return { result, issue: existing.number };
  const body = `longrun の取り込み（${productionBranch} → ${baseBranch}）が衝突しました。手元で ${baseBranch} に ${productionBranch} をマージして衝突を解き、push してください。解消したらこの issue を閉じてください。`;
  const issue = await ctx.gh.createIssue({ title, body, labels: [labels.needsHuman] });
  return { result, issue: issue.number };
}

// 片づける issue があり、ほかの run が動いていなければ routine を起動する。
// fire は routine の /fire を呼ぶ関数（テストでは差し替える）
export async function dispatchRoutine(ctx, fire) {
  if (!componentEnabled(ctx.config, 'dispatch')) return { fired: false, reason: 'components.dispatch が false なので起動しない' };
  const peeked = await peekWork(ctx, { honorFired: true });
  if (!peeked.work) return { fired: false, reason: peeked.reason };
  let response;
  try {
    response = await fire();
  } catch (error) {
    return { fired: false, reason: `routine を起動できませんでした: ${error.message}` };
  }
  const journal = await findOrCreateJournal(ctx);
  const url = response?.claude_code_session_url ?? '';
  await record(ctx, journal, `🚀 #${peeked.issue} があるので routine を起動 ${url}`.trim(), { kind: 'fired', at: ctx.now().toISOString() });
  return { fired: true, issue: peeked.issue, session: url };
}
