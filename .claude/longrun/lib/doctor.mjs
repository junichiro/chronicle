// longrun doctor: リポジトリ側の準備がそろっているかを、項目ごとに確かめる。
// GitHub は REST の読み取りだけを使う（何も書き込まない）。クラウドのセッションでも動く。
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { componentEnabled, installedSettings } from './config.mjs';

export const OK = 'ok';
export const NG = 'ng';
export const UNKNOWN = 'unknown';

const item = (name, status, detail, fix) => (fix && status !== OK ? { name, status, detail, fix } : { name, status, detail });

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function readJson(path) {
  const text = readText(path);
  if (text === undefined) return { missing: true };
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: error.message };
  }
}

// ---- ワークフローの YAML から、名前と pull_request の対象ブランチを読む ----
// YAML の全部は読まない。GitHub Actions のワークフローでよく使う書き方だけを扱い、読めなければ undefined を返す

const unquote = (text) => text.trim().replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');

function parseInlineList(text) {
  const inner = text.trim().replace(/\s+#.*$/, '');
  if (!inner.startsWith('[') || !inner.endsWith(']')) return undefined;
  return inner.slice(1, -1).split(',').map(unquote).filter(Boolean);
}

const indentOf = (line) => line.match(/^ */)[0].length;
const meaningful = (line) => line.trim() !== '' && !line.trim().startsWith('#');

// lines[start] の子（字下げが深い行）を返す
function childLines(lines, start) {
  const parent = indentOf(lines[start]);
  const children = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!meaningful(lines[i])) continue;
    if (indentOf(lines[i]) <= parent) break;
    children.push(lines[i]);
  }
  return children;
}

// 子の行のうち、すぐ下の段のキー key を探す。{ index, value } を返す
function findKey(lines, key) {
  const top = Math.min(...lines.filter(meaningful).map(indentOf));
  const pattern = new RegExp(`^ {${top}}(?:${key}|'${key}'|"${key}"):(.*)$`);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(pattern);
    if (match) return { index: i, value: match[1].trim().replace(/^#.*$/, '') };
  }
  return undefined;
}

function readList(lines, found) {
  if (found.value) return parseInlineList(found.value) ?? [unquote(found.value)];
  return childLines(lines, found.index).map((line) => line.trim()).filter((line) => line.startsWith('- ')).map((line) => unquote(line.slice(2)));
}

// 返り値: { name, pullRequest: undefined（pull_request で走らない）| { branches?, branchesIgnore? } }
export function parseWorkflow(text, fileName) {
  const lines = text.split(/\r?\n/);
  const nameLine = lines.find((line) => /^name:/.test(line));
  const name = nameLine ? unquote(nameLine.slice(5)) : `.github/workflows/${fileName}`;
  const on = findKey(lines, '(?:on|true)');
  if (!on) return { name, pullRequest: undefined };
  if (on.value) {
    const events = parseInlineList(on.value) ?? [unquote(on.value)];
    return { name, pullRequest: events.includes('pull_request') ? {} : undefined };
  }
  const events = childLines(lines, on.index);
  const pr = findKey(events, 'pull_request');
  if (!pr) return { name, pullRequest: undefined };
  if (pr.value && !['{}', 'null', '~'].includes(pr.value)) return { name, unreadable: true };
  const filters = childLines(events, pr.index);
  const result = {};
  const branches = findKey(filters, 'branches');
  const ignore = findKey(filters, 'branches-ignore');
  if (branches) result.branches = readList(filters, branches);
  if (ignore) result.branchesIgnore = readList(filters, ignore);
  return { name, pullRequest: result };
}

// GitHub の branches フィルタの書き方（* は / を含まない、** は何でも）で比べる
export function matchBranch(pattern, branch) {
  const regex = pattern
    .split(/(\*\*|\*)/)
    .map((part) => (part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${regex}$`).test(branch);
}

export function runsOnPullRequestTo(pullRequest, branch) {
  if (!pullRequest) return false;
  if (pullRequest.branches) {
    // ! で始まるものは除外。後ろに書いたものが勝つ
    let matched = false;
    for (const pattern of pullRequest.branches) {
      if (pattern.startsWith('!')) {
        if (matchBranch(pattern.slice(1), branch)) matched = false;
      } else if (matchBranch(pattern, branch)) matched = true;
    }
    return matched;
  }
  if (pullRequest.branchesIgnore) return !pullRequest.branchesIgnore.some((pattern) => matchBranch(pattern, branch));
  return true;
}

// ---- 項目 ----

async function checkBranches(ctx) {
  const { baseBranch, productionBranch } = ctx.config;
  const results = [];
  for (const branch of new Set([baseBranch, productionBranch])) {
    const exists = await ctx.gh.branchExists(branch);
    results.push(item(
      `ブランチ ${branch}`,
      exists ? OK : NG,
      exists ? 'ある' : 'ない',
      branch === baseBranch ? `${productionBranch} から ${baseBranch} を作る` : `config.json の productionBranch を本番のブランチ名にする`,
    ));
  }
  return results;
}

async function checkLabels(ctx) {
  const wanted = Object.values(ctx.config.labels);
  const existing = new Set((await ctx.gh.listLabels()).map((label) => label.name));
  const missing = wanted.filter((name) => !existing.has(name));
  if (missing.length === 0) return item('ラベル', OK, 'すべてある');
  const repo = await ctx.gh.getRepo();
  const permissions = repo?.permissions;
  if (!permissions) return item('ラベル', UNKNOWN, `ない: ${missing.join(', ')}。作れる権限があるかは確かめられない`, 'longrun start が作る。作れなければ GitHub で作る');
  const canCreate = Boolean(permissions.admin || permissions.maintain || permissions.push);
  return item(
    'ラベル',
    canCreate ? OK : NG,
    canCreate ? `ない: ${missing.join(', ')}。longrun start のときに作る` : `ない: ${missing.join(', ')}。作る権限がない`,
    'リポジトリに書き込める人が GitHub でラベルを作る',
  );
}

function checkCiWorkflows(ctx, root) {
  const dir = join(root, '.github/workflows');
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)) : [];
  const workflows = files.map((name) => ({ file: name, ...parseWorkflow(readFileSync(join(dir, name), 'utf8'), name) }));
  const { baseBranch } = ctx.config;
  return ctx.config.ciWorkflows.map((wanted) => {
    const name = `CI のワークフロー「${wanted}」`;
    const found = workflows.filter((workflow) => workflow.name === wanted);
    if (found.length === 0) {
      const names = workflows.map((workflow) => workflow.name).filter((n) => !n.startsWith('longrun-'));
      return item(name, NG, `.github/workflows/ に name: が「${wanted}」のワークフローがない（あるのは ${names.join(', ') || 'なし'}）`, 'config.json の ciWorkflows を CI の name: に合わせ、install.mjs を流し直す');
    }
    if (found.some((workflow) => !workflow.unreadable && runsOnPullRequestTo(workflow.pullRequest, baseBranch))) {
      return item(name, OK, `${found.map((w) => w.file).join(', ')} が ${baseBranch} 宛ての PR で走る`);
    }
    if (found.some((workflow) => workflow.unreadable)) {
      return item(name, UNKNOWN, `${found.map((w) => w.file).join(', ')} の pull_request の書き方を読めない`, `pull_request が ${baseBranch} 宛ての PR で走るかを目で確かめる`);
    }
    const runs = found.some((workflow) => runsOnPullRequestTo(workflow.pullRequest, baseBranch));
    return item(
      name,
      runs ? OK : NG,
      runs ? `${found.map((w) => w.file).join(', ')} が ${baseBranch} 宛ての PR で走る` : `${found.map((w) => w.file).join(', ')} が ${baseBranch} 宛ての PR で走らない`,
      `on.pull_request.branches に ${baseBranch} を足す（走らないと自動マージされない）`,
    );
  });
}

// 入れたときの設定の値と、今の config.json の値が同じか。違えば入れ直しを忘れている
function checkInstalledConfig(root, config) {
  const name = '入れたときの設定';
  const manifest = readJson(join(root, '.claude/longrun/manifest.json'));
  if (manifest.missing || manifest.error) return item(name, UNKNOWN, 'manifest.json がないか読めない', 'install.mjs で入れ直す');
  const stored = manifest.value.config;
  if (!stored) return item(name, UNKNOWN, 'manifest.json に入れたときの設定がない（残す前の版で入れた）', 'install.mjs で入れ直す');
  const now = installedSettings(config);
  const changed = Object.keys(now).filter((key) => JSON.stringify(now[key]) !== JSON.stringify(stored[key]));
  if (changed.length === 0) return item(name, OK, '今の config.json のとおりに入っている');
  return item(
    name,
    NG,
    `config.json を変えたあと入れ直していない: ${changed.join(', ')}。手順書・ワークフロー・settings.json は前の値のまま`,
    'プラグインのある手元で install.mjs を流し直し、差分を commit する',
  );
}

// 入れたファイルが、入れたときの中身のままか（manifest.json のハッシュと比べる）
function checkInstalledFiles(root) {
  const name = '入れたファイル';
  const fix = 'プラグインの install.mjs で入れ直す（node <プラグイン>/install.mjs check <パス> で、プラグインの版と比べられる）';
  const manifest = readJson(join(root, '.claude/longrun/manifest.json'));
  if (manifest.missing) return item(name, UNKNOWN, '.claude/longrun/manifest.json がない（一覧を残す前の版で入れた）', fix);
  if (manifest.error) return item(name, NG, `manifest.json を読めない: ${manifest.error}`, fix);
  const changed = [];
  for (const [path, hash] of Object.entries(manifest.value.files ?? {})) {
    const text = readText(join(root, path));
    if (text === undefined) changed.push(`${path}（ない）`);
    else if (createHash('sha256').update(text).digest('hex') !== hash) changed.push(`${path}（変わった）`);
  }
  const version = readText(join(root, '.claude/longrun/VERSION'))?.trim();
  if (changed.length > 0) return item(name, NG, `入れたときと違う: ${changed.join(', ')}`, fix);
  return item(name, OK, `版 ${version ?? manifest.value.version} のまま`);
}

async function checkRoutineSecret(ctx) {
  const name = 'routine の起動（dispatch）';
  if (!componentEnabled(ctx.config, 'dispatch')) return item(name, OK, 'components.dispatch が false なので、Actions から routine を起動しない');
  if (!ctx.config.routineId) return item(name, OK, 'routineId がないので、Actions から routine を起動しない');
  const secrets = await ctx.gh.listSecretNames();
  if (secrets === null) return item(name, UNKNOWN, 'シークレットの一覧を読めない（管理者の権限が要る）', 'GitHub の Settings → Secrets and variables → Actions に LONGRUN_ROUTINE_TOKEN があるか確かめる');
  const has = secrets.includes('LONGRUN_ROUTINE_TOKEN');
  return item(name, has ? OK : NG, has ? 'シークレット LONGRUN_ROUTINE_TOKEN がある' : 'シークレット LONGRUN_ROUTINE_TOKEN がない', '本人が gh secret set LONGRUN_ROUTINE_TOKEN -R <owner>/<repo> で routine のトークンを登録する');
}

async function checkActionsPermissions(ctx) {
  const name = 'Actions の権限';
  const permissions = await ctx.gh.getWorkflowPermissions();
  if (permissions === null) return item(name, UNKNOWN, 'Actions の権限の設定を読めない（管理者の権限が要る）', 'Settings → Actions → General → Workflow permissions を確かめる');
  if (permissions.default_workflow_permissions === 'write') return item(name, OK, 'GITHUB_TOKEN の既定は読み書き');
  return item(
    name,
    UNKNOWN,
    'GITHUB_TOKEN の既定は読み取りだけ。longrun のワークフローは permissions: で書き込みを求めるので、組織の設定で上限が絞られていなければ動く',
    '自動マージが権限の不足で落ちるなら、Settings → Actions → General → Workflow permissions を Read and write permissions にする（組織で絞られていれば組織の設定も）',
  );
}

function checkSettingsHooks(root) {
  const name = '.claude/settings.json の hook';
  const fix = 'install.mjs を流し直す';
  const settings = readJson(join(root, '.claude/settings.json'));
  if (settings.missing) return item(name, NG, 'settings.json がない', fix);
  if (settings.error) return item(name, NG, `settings.json を JSON として読めない: ${settings.error}`, 'コメントや末尾のカンマを取り除く');
  const commands = (event) => (settings.value.hooks?.[event] ?? []).flatMap((entry) => entry.hooks ?? []).map((hook) => hook.command ?? '');
  const missing = [];
  if (!commands('Stop').some((command) => command.includes('.claude/longrun/hooks/stop.mjs'))) missing.push('Stop（stop.mjs）');
  if (!commands('PreToolUse').some((command) => command.includes('.claude/longrun/hooks/guard.mjs'))) missing.push('PreToolUse（guard.mjs）');
  if (missing.length > 0) return item(name, NG, `ない: ${missing.join(', ')}`, fix);
  return item(name, OK, 'Stop と PreToolUse の hook がある');
}

// 確認コマンドがありそうか。目安なので、見つからなくても NG にはしない
const COMMAND_PATTERN = /\b(npm (?:test|run)|pnpm |yarn |npx |make |pytest|python -m|go test|cargo (?:test|clippy|fmt)|bundle exec|rspec|rake|gradle|mvn|dotnet test|deno |bun |tox|ruff|eslint|tsc)\b/;

export function checkClaudeMd(root, config = {}) {
  const name = '確認コマンド';
  if (config.verify?.length) return item(name, OK, `config.json の verify: ${config.verify.join(', ')}`);
  const text = readText(join(root, 'CLAUDE.md'));
  if (text === undefined) return item(name, NG, 'リポジトリのルートに CLAUDE.md がない', 'config.json の verify に CI と同じ確認コマンドを書くか、CLAUDE.md を作って書く');
  if (COMMAND_PATTERN.test(text)) return item(name, OK, '確認コマンドらしきものがある（目安）');
  return item(name, UNKNOWN, '確認コマンドらしきものが見つからない（目安）', 'config.json の verify か CLAUDE.md に、CI と同じ確認コマンドを書く');
}

// 項目ごとの結果を集める。GitHub の呼び出しが失敗した項目は「確かめられない」にする
export async function runDoctor(ctx, root) {
  const checks = [];
  const guarded = async (name, fn) => {
    try {
      const result = await fn();
      checks.push(...[result].flat());
    } catch (error) {
      checks.push(item(name, UNKNOWN, `確かめられなかった: ${error.message}`, 'gh auth status で GitHub に入れているか、トークンにリポジトリを読む権限があるかを確かめ、もう一度実行する'));
    }
  };
  await guarded('ブランチ', () => checkBranches(ctx));
  await guarded('ラベル', () => checkLabels(ctx));
  await guarded('CI のワークフロー', () => checkCiWorkflows(ctx, root));
  await guarded('入れたファイル', () => checkInstalledFiles(root));
  await guarded('入れたときの設定', () => checkInstalledConfig(root, ctx.config));
  await guarded('routine の起動（dispatch）', () => checkRoutineSecret(ctx));
  await guarded('Actions の権限', () => checkActionsPermissions(ctx));
  await guarded('.claude/settings.json の hook', () => checkSettingsHooks(root));
  await guarded('確認コマンド', () => checkClaudeMd(root, ctx.config));
  const count = (status) => checks.filter((check) => check.status === status).length;
  return { ok: count(NG) === 0, summary: { ok: count(OK), ng: count(NG), unknown: count(UNKNOWN) }, checks };
}
