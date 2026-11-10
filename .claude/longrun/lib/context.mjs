// CLI と hook が共有する、実環境の部品の組み立て。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { GitHub, parseRepo } from './github.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function projectRoot(cwd = process.cwd()) {
  return process.env.CLAUDE_PROJECT_DIR || git(cwd, ['rev-parse', '--show-toplevel']);
}

// 状態は .git の中に置く。commit されず、worktree からも同じものが見える
export class FileState {
  constructor(dir) {
    this.path = join(dir, 'run.json');
    this.dir = dir;
  }
  load() {
    if (!existsSync(this.path)) return null;
    return JSON.parse(readFileSync(this.path, 'utf8'));
  }
  save(value) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(value, null, 2)}\n`);
  }
  clear() {
    rmSync(this.path, { force: true });
  }
}

function resolveRepo(root, config) {
  if (config.repo) return config.repo;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return parseRepo(git(root, ['remote', 'get-url', 'origin']));
}

export function createContext(cwd = process.cwd()) {
  const root = projectRoot(cwd);
  const config = loadConfig(join(root, '.claude/longrun/config.json'));
  const stateDir = join(resolve(root, git(root, ['rev-parse', '--git-common-dir'])), 'longrun');
  let gh = null;
  return {
    root,
    config,
    state: new FileState(stateDir),
    now: () => new Date(),
    runId: `${hostname()}-${Date.now().toString(36)}`,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    // GitHub は必要になったときに初めて remote を読む
    get gh() {
      gh ??= new GitHub(resolveRepo(root, config));
      return gh;
    },
  };
}
