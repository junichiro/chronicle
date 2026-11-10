// GitHub の REST API を gh api で呼ぶ。
// クラウドの GitHub プロキシは GraphQL を通さないため、gh issue / gh pr は使わない。
// マージ（merges・pulls/N/merge）はプロキシが拒否するので、GitHub Actions からだけ呼ぶ。
import { spawn } from 'node:child_process';

const PAGE_SIZE = 100;

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export function parseResponse(stdout) {
  const separator = stdout.search(/\r?\n\r?\n/);
  const head = separator === -1 ? stdout : stdout.slice(0, separator);
  const body = separator === -1 ? '' : stdout.slice(separator).trim();
  const match = head.match(/^HTTP\/[\d.]+ (\d{3})/);
  if (!match) throw new GitHubError(`gh api の応答を読めません: ${stdout.slice(0, 200)}`, 0);
  return { status: Number(match[1]), data: body ? JSON.parse(body) : null };
}

// remote の URL から owner/repo を取り出す（https・ssh・クラウドのプロキシに対応）
export function parseRepo(remoteUrl) {
  const match = remoteUrl.trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error(`remote の URL から owner/repo を読めません: ${remoteUrl}`);
  return `${match[1]}/${match[2]}`;
}

export function runGh(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

const enc = encodeURIComponent;

export class GitHub {
  constructor(repo, run = runGh) {
    this.repo = repo;
    this.run = run;
  }

  // 失敗の状態コードも返す。allowed にない 4xx/5xx は例外にする
  async request(method, path, body, allowed = []) {
    const args = ['api', '--include', '-X', method, path ? `repos/${this.repo}/${path}` : `repos/${this.repo}`];
    if (body !== undefined) args.push('--input', '-');
    const result = await this.run(args, body === undefined ? undefined : JSON.stringify(body));
    if (!result.stdout) throw new GitHubError(`gh api ${method} ${path} が失敗しました: ${result.stderr.trim()}`, 0);
    const response = parseResponse(result.stdout);
    if (response.status >= 400 && !allowed.includes(response.status)) {
      const message = response.data?.message ?? result.stderr.trim();
      throw new GitHubError(`gh api ${method} ${path} が ${response.status} を返しました: ${message}`, response.status);
    }
    return response;
  }

  async listOpenIssues(label) {
    const issues = [];
    for (let page = 1; ; page += 1) {
      const { data } = await this.request('GET', `issues?state=open&labels=${enc(label)}&per_page=${PAGE_SIZE}&page=${page}`);
      issues.push(...data);
      if (data.length < PAGE_SIZE) return issues;
    }
  }

  // 1 件の取得は一覧と違って反映の遅れがない
  async getIssue(number) {
    return (await this.request('GET', `issues/${number}`)).data;
  }

  async ensureLabel(name) {
    await this.request('POST', 'labels', { name, color: 'ededed' }, [422]);
  }

  async createIssue({ title, body, labels }) {
    return (await this.request('POST', 'issues', { title, body, labels })).data;
  }

  async addLabels(number, labels) {
    await this.request('POST', `issues/${number}/labels`, { labels });
  }

  async removeLabel(number, name) {
    await this.request('DELETE', `issues/${number}/labels/${enc(name)}`, undefined, [404]);
  }

  async closeIssue(number) {
    await this.request('PATCH', `issues/${number}`, { state: 'closed', state_reason: 'completed' });
  }

  async comment(number, body) {
    await this.request('POST', `issues/${number}/comments`, { body });
  }

  async listComments(number) {
    const comments = [];
    for (let page = 1; ; page += 1) {
      const { data } = await this.request('GET', `issues/${number}/comments?per_page=${PAGE_SIZE}&page=${page}`);
      comments.push(...data);
      if (data.length < PAGE_SIZE) return comments;
    }
  }

  async branchExists(name) {
    const { status } = await this.request('GET', `branches/${enc(name)}`, undefined, [404]);
    return status === 200;
  }

  // head を base に取り込む。衝突は例外にせず 'conflict' を返す
  async mergeBranches(base, head) {
    const message = `Merge ${head} into ${base}（longrun）`;
    const { status } = await this.request('POST', 'merges', { base, head, commit_message: message }, [409]);
    if (status === 409) return 'conflict';
    return status === 204 ? 'up-to-date' : 'merged';
  }

  async listOpenPrs(base) {
    const prs = [];
    for (let page = 1; ; page += 1) {
      const { data } = await this.request('GET', `pulls?state=open&base=${enc(base)}&per_page=${PAGE_SIZE}&page=${page}`);
      prs.push(...data);
      if (data.length < PAGE_SIZE) return prs;
    }
  }

  async createPr({ head, base, title, body }) {
    return (await this.request('POST', 'pulls', { head, base, title, body })).data;
  }

  async getPr(number) {
    return (await this.request('GET', `pulls/${number}`)).data;
  }

  async listCheckRuns(sha) {
    return (await this.request('GET', `commits/${sha}/check-runs?per_page=${PAGE_SIZE}`)).data.check_runs;
  }

  async listLabels() {
    const labels = [];
    for (let page = 1; ; page += 1) {
      const { data } = await this.request('GET', `labels?per_page=${PAGE_SIZE}&page=${page}`);
      labels.push(...data);
      if (data.length < PAGE_SIZE) return labels;
    }
  }

  async getRepo() {
    return (await this.request('GET', '')).data;
  }

  // シークレットの名前だけを返す。読む権限がなければ null
  async listSecretNames() {
    const names = [];
    for (let page = 1; ; page += 1) {
      const { status, data } = await this.request('GET', `actions/secrets?per_page=${PAGE_SIZE}&page=${page}`, undefined, [403, 404]);
      if (status !== 200) return null;
      names.push(...data.secrets.map((secret) => secret.name));
      if (data.secrets.length < PAGE_SIZE) return names;
    }
  }

  // Actions の GITHUB_TOKEN の既定の権限。読む権限がなければ null
  async getWorkflowPermissions() {
    const { status, data } = await this.request('GET', 'actions/permissions/workflow', undefined, [403, 404]);
    return status === 200 ? data : null;
  }

  async mergePr(number, method) {
    await this.request('PUT', `pulls/${number}/merge`, { merge_method: method });
  }

  // ブランチを消す。すでになければ（422 Reference does not exist）消えたものとして扱う。404 は権限不足でも返るので隠さない
  async deleteBranch(name) {
    const path = name.split('/').map(encodeURIComponent).join('/');
    await this.request('DELETE', `git/refs/heads/${path}`, undefined, [422]);
  }
}
