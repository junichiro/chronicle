// longrun の各手順。GitHub 操作は ctx.gh、ローカルの状態は ctx.state に任せる。
import { componentEnabled } from './config.mjs';
import { journalKey, isWithinWindow, evaluateStop, countSpawned, writeMarker, readMarker, depthOf, evaluateChecks, pickCandidate, rankCandidates } from './rules.mjs';

const MINUTE = 60 * 1000;
const CHECK_POLL_SECONDS = 15;

function minutesSince(ctx, iso) {
  return (ctx.now().getTime() - new Date(iso).getTime()) / MINUTE;
}

function requireState(ctx) {
  const state = ctx.state.load();
  if (!state) throw new Error('run が始まっていません。先に start を実行してください');
  return state;
}

export async function record(ctx, journal, text, event) {
  await ctx.gh.comment(journal, `${text}\n\n${writeMarker(event)}`);
}

async function readEvents(ctx, journal) {
  const comments = await ctx.gh.listComments(journal);
  return comments.map((comment) => readMarker(comment.body)).filter(Boolean);
}

async function ensureLabels(ctx) {
  for (const name of Object.values(ctx.config.labels)) await ctx.gh.ensureLabel(name);
}

function journalTitle(ctx) {
  return `longrun 記録 ${journalKey(ctx.now(), ctx.config.timezone)}`;
}

// 今日の記録用 issue を探す（作らない）
async function findJournal(ctx) {
  const open = await ctx.gh.listOpenIssues(ctx.config.labels.journal);
  return open.find((issue) => issue.title === journalTitle(ctx))?.number ?? null;
}

export async function findOrCreateJournal(ctx) {
  const existing = await findJournal(ctx);
  if (existing) return existing;
  const title = journalTitle(ctx);
  const body = 'longrun の記録です。run ごと・issue ごとの結果がコメントで積まれます。朝に確認したら閉じてください。';
  const created = await ctx.gh.createIssue({ title, body, labels: [ctx.config.labels.journal] });
  return created.number;
}

// honorFired: Actions が起動したばかりで、まだロックを書いていない run も「動いている」とみなす
function activeLock(ctx, events, { honorFired = false } = {}) {
  const kinds = honorFired ? ['lock', 'unlock', 'fired'] : ['lock', 'unlock'];
  const last = events.filter((event) => kinds.includes(event.kind)).at(-1);
  if (!last || last.kind === 'unlock') return null;
  if (last.kind === 'fired') {
    return minutesSince(ctx, last.at) < ctx.config.fireGraceMinutes ? { ...last, run: `起動したばかりの run（${last.at}）` } : null;
  }
  if (last.run === ctx.runId) return null;
  if (minutesSince(ctx, last.at) >= ctx.config.lockTtlMinutes) return null;
  return last;
}

export async function startRun(ctx) {
  if (!isWithinWindow(ctx.now(), ctx.config)) {
    return { ok: false, reason: '設定した実行の時間外です（config.json の window）' };
  }
  const { baseBranch, productionBranch } = ctx.config;
  if (!(await ctx.gh.branchExists(baseBranch))) {
    return { ok: false, reason: `${baseBranch} ブランチがありません。${productionBranch} から作ってください` };
  }
  await ensureLabels(ctx);
  const journal = await findOrCreateJournal(ctx);
  const lock = activeLock(ctx, await readEvents(ctx, journal));
  if (lock) return { ok: false, reason: `run ${lock.run} が ${lock.at} から実行中です` };

  // 状態を先に保存し、ロックを書いたあとで何が起きても end で外せるようにする
  const startedAt = ctx.now().toISOString();
  ctx.state.save({ run: ctx.runId, journal, startedAt, current: null, pr: null });
  await record(ctx, journal, `▶ run ${ctx.runId} を開始`, { kind: 'lock', run: ctx.runId, at: startedAt });
  return { ok: true, journal, run: ctx.runId };
}

function budgetLeft(ctx, state) {
  return minutesSince(ctx, state.startedAt) < ctx.config.runBudgetMinutes;
}

async function stopReason(ctx, state) {
  if (!budgetLeft(ctx, state)) return 'この run の持ち時間を使い切りました';
  const verdict = evaluateStop({ now: ctx.now(), config: ctx.config, events: await readEvents(ctx, state.journal) });
  return verdict.stop ? verdict.reason : null;
}

// issue の一覧は反映が遅れ、閉じたばかりの issue や付けたばかりの作業中の印が見えないことがある。
// 一覧で選んだ候補を 1 件ずつ取り直し、今も確保してよいものを返す
async function findCandidate(ctx) {
  const ranked = rankCandidates(await ctx.gh.listOpenIssues(ctx.config.labels.queue), ctx.config);
  for (const listed of ranked) {
    const fresh = await ctx.gh.getIssue(listed.number);
    if (pickCandidate([fresh], ctx.config)) return fresh;
  }
  return null;
}

// 読むだけの下見。GitHub には何も書かない（記録用 issue も作らない）。
// honorFired: Actions の下見で使う。起動された routine 自身の下見では、自分を起動した印を無視する
export async function peekWork(ctx, { honorFired = false } = {}) {
  if (!isWithinWindow(ctx.now(), ctx.config)) return { work: false, reason: '設定した実行の時間外です' };
  const journal = await findJournal(ctx);
  const events = journal ? await readEvents(ctx, journal) : [];
  const lock = activeLock(ctx, events, { honorFired });
  if (lock) return { work: false, reason: `${lock.run} が動いています` };
  const verdict = evaluateStop({ now: ctx.now(), config: ctx.config, events });
  if (verdict.stop) return { work: false, reason: verdict.reason };
  const issue = await findCandidate(ctx);
  if (!issue) return { work: false, reason: '片づける issue がありません' };
  return { work: true, issue: issue.number };
}

export async function claimNext(ctx) {
  const state = requireState(ctx);
  if (state.current) return { done: false, reason: `#${state.current} がまだ作業中です。finish してから次へ進んでください` };
  const reason = await stopReason(ctx, state);
  if (reason) return { done: true, reason };
  const issue = await findCandidate(ctx);
  if (!issue) return { done: true, reason: '片づける issue がもうありません' };

  await ctx.gh.addLabels(issue.number, [ctx.config.labels.wip]);
  await record(ctx, state.journal, `🔧 #${issue.number} ${issue.title} に着手`, { kind: 'claim', issue: issue.number });
  ctx.state.save({ ...state, current: issue.number, pr: null });
  return { done: false, issue: { number: issue.number, title: issue.title, body: issue.body, depth: depthOf(issue) } };
}

async function parentInfo(ctx, number) {
  if (!number) return { parent: null, depth: 0 };
  const parent = await ctx.gh.getIssue(number);
  return { parent: number, depth: depthOf(parent) };
}

export async function spawnIssue(ctx, { title, body }) {
  const state = requireState(ctx);
  const { limits, labels } = ctx.config;
  const spawned = countSpawned(await readEvents(ctx, state.journal));
  if (spawned >= limits.maxSpawned) {
    const text = `📝 issue の作成上限（${limits.maxSpawned} 件）に達したため起票しなかった課題: ${title}\n\n${body}`;
    await record(ctx, state.journal, text, { kind: 'skipped-spawn', title });
    return { created: false, reason: '今日の issue 作成上限に達しています。課題は記録用 issue に残しました' };
  }

  const { parent, depth: parentDepth } = await parentInfo(ctx, state.current);
  const depth = parentDepth + 1;
  const queued = depth <= limits.maxDepth;
  const marker = writeMarker({ kind: 'spawned', parent, depth });
  const fullBody = [body, parent ? `親: #${parent}` : null, marker].filter(Boolean).join('\n\n');
  const issue = await ctx.gh.createIssue({ title, body: fullBody, labels: [queued ? labels.queue : labels.deferred] });
  const note = queued ? 'キューに積んだ' : `深さ ${depth} が上限を超えるので保留にした`;
  await record(ctx, state.journal, `➕ #${issue.number} ${title} を起票（${note}）`, { kind: 'spawned', issue: issue.number, parent, queued });
  return { created: true, number: issue.number, queued };
}

export async function openPr(ctx, { branch, title, body }) {
  const state = requireState(ctx);
  // 人間がマージするなら、マージで issue が閉じるようにする。自動マージなら finish で閉じる
  const keyword = componentEnabled(ctx.config, 'automerge') ? 'Refs' : 'Closes';
  const refs = state.current ? `\n\n${keyword} #${state.current}` : '';
  const pr = await ctx.gh.createPr({ head: branch, base: ctx.config.baseBranch, title, body: `${body}${refs}` });
  ctx.state.save({ ...state, pr: pr.number });
  return { number: pr.number, url: pr.html_url };
}

function relevantRuns(ctx, runs) {
  return runs.filter((run) => run.name !== ctx.config.automergeCheckName);
}

function failedNames(runs) {
  return runs
    .filter((run) => run.status === 'completed' && !['success', 'skipped', 'neutral'].includes(run.conclusion))
    .map((run) => `${run.name}(${run.conclusion})`)
    .join(', ');
}

async function automergeFailure(ctx, pr) {
  const comments = await ctx.gh.listComments(pr.number);
  const markers = comments.map((comment) => readMarker(comment.body)).filter(Boolean);
  return markers.find((marker) => marker.kind === 'automerge-failed' && marker.sha === pr.head.sha) ?? null;
}

// 一度だけ状態を見る。決着していれば結果を、まだなら null を返す
async function inspectPr(ctx, number) {
  const pr = await ctx.gh.getPr(number);
  const { baseBranch } = ctx.config;
  if (pr.base.ref !== baseBranch) return { merged: false, reason: `PR #${number} の宛先が ${pr.base.ref} です。longrun が扱うのは ${baseBranch} 宛てだけです` };
  if (pr.merged) return { merged: true };
  if (pr.state === 'closed') return { merged: false, reason: `PR #${number} はマージされずに閉じられました` };
  const runs = relevantRuns(ctx, await ctx.gh.listCheckRuns(pr.head.sha));
  const verdict = evaluateChecks(runs);
  if (verdict === 'failure') return { merged: false, reason: `CI が失敗しました: ${failedNames(runs)}` };
  const failed = await automergeFailure(ctx, pr);
  if (!componentEnabled(ctx.config, 'automerge') && verdict === 'success') {
    return {
      merged: false,
      awaitingHuman: true,
      reason: `CI がすべて通りました。この設定（components.automerge: false）ではマージは人間が行います。longrun finish --ok で締めて次へ進んでください`,
    };
  }
  if (failed) return { merged: false, reason: `自動マージに失敗しました: ${failed.reason}。${ctx.config.baseBranch} に rebase して push し直してください` };
  if (verdict === 'none' && minutesSince(ctx, pr.created_at) >= ctx.config.noChecksGraceMinutes) {
    return { merged: false, reason: 'CI が一つも走っていません。ワークフローの対象ブランチを確認してください' };
  }
  return null;
}

// マージは GitHub Actions（longrun-automerge）が行う。ここでは決着を待つだけ
export async function waitForMerge(ctx, { pr: number, waitSeconds }) {
  const deadline = ctx.now().getTime() + waitSeconds * 1000;
  for (;;) {
    const settled = await inspectPr(ctx, number);
    if (settled) return settled;
    if (ctx.now().getTime() >= deadline) {
      return { merged: false, pending: true, reason: 'まだマージされていません（CI の実行中か、自動マージ待ち）。もう一度 longrun wait を実行してください' };
    }
    await ctx.sleep(CHECK_POLL_SECONDS * 1000);
  }
}

function closingLabel(labels, needsHuman) {
  return needsHuman ? labels.needsHuman : labels.failed;
}

export async function finishIssue(ctx, { ok, needsHuman = false, note }) {
  const state = requireState(ctx);
  if (!state.current) throw new Error('作業中の issue がありません');
  const { current, pr } = state;
  const { labels } = ctx.config;
  const prText = pr ? `（PR #${pr}）` : '';

  await ctx.gh.removeLabel(current, labels.wip);
  if (ok && !componentEnabled(ctx.config, 'automerge')) {
    // マージは人間が行う。PR の Closes でマージ時に閉じるので、ここでは閉じずに印を付ける
    await ctx.gh.comment(current, `longrun が PR を作り、CI が通りました${prText}。マージは人間が行います（マージするとこの issue は閉じます）。\n\n${note}`);
    await ctx.gh.addLabels(current, [labels.awaitingMerge]);
  } else if (ok) {
    await ctx.gh.comment(current, `longrun が ${ctx.config.baseBranch} に取り込みました${prText}。\n\n${note}`);
    await ctx.gh.closeIssue(current);
  } else {
    const heading = needsHuman ? 'longrun は人間の判断が要ると判断して手を止めました' : 'longrun は片づけられませんでした';
    await ctx.gh.comment(current, `${heading}${prText}。\n\n${note}`);
    await ctx.gh.addLabels(current, [closingLabel(labels, needsHuman)]);
  }
  const mark = ok ? '✅' : needsHuman ? '🙋' : '❌';
  const event = needsHuman ? { kind: 'result', ok, needsHuman, issue: current, pr: pr ?? null } : { kind: 'result', ok, issue: current, pr: pr ?? null };
  await record(ctx, state.journal, `${mark} #${current}${prText}: ${note}`, event);
  ctx.state.save({ ...state, current: null, pr: null });
  return { ok, needsHuman, issue: current };
}

export async function endRun(ctx, reason = '終了') {
  const state = ctx.state.load();
  if (!state) return { ended: false };
  await record(ctx, state.journal, `⏹ run ${state.run} を終了: ${reason}`, { kind: 'unlock', run: state.run });
  ctx.state.clear();
  return { ended: true };
}

// Stop hook から呼ぶ。止めてよいときはロックを放す
export async function shouldKeepGoing(ctx) {
  const state = ctx.state.load();
  if (!state) return { keepGoing: false };
  if (state.current) {
    return { keepGoing: true, reason: `#${state.current} が作業中です。マージまで進めるか、片づけられないなら longrun finish --failed（判断が要るなら --needs-human）で締めてください` };
  }
  const reason = await stopReason(ctx, state);
  if (reason) {
    await endRun(ctx, reason);
    return { keepGoing: false };
  }
  if (!(await findCandidate(ctx))) {
    await endRun(ctx, '片づける issue がなくなった');
    return { keepGoing: false };
  }
  return { keepGoing: true, reason: 'まだ持ち時間があり、片づける issue が残っています。longrun next で次の issue に進んでください' };
}
