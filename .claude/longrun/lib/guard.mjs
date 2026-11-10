// run の最中に、守るべきブランチを壊すコマンドを見分ける。
// ブランチ保護を使えないリポジトリでも、マージを GitHub Actions（longrun-automerge）に一本化するための仕組み。

const MERGE_ONLY_VIA_LONGRUN = 'マージは GitHub Actions（longrun-automerge）が CI を確かめてから行います。longrun wait で待ってください';

function segments(command) {
  return command.split(/&&|\|\||;|\|/).map((part) => part.trim().split(/\s+/).filter(Boolean));
}

function pushTargets(tokens) {
  const args = tokens.slice(tokens.indexOf('push') + 1).filter((token) => !token.startsWith('-'));
  // 先頭は remote、残りが refspec
  return args.slice(1).map((refspec) => {
    const target = refspec.includes(':') ? refspec.split(':').pop() : refspec;
    return { force: refspec.startsWith('+'), branch: target.replace(/^\+/, '').replace(/^refs\/heads\//, '') };
  });
}

function checkPush(tokens, config) {
  const flags = tokens.filter((token) => token.startsWith('-'));
  const targets = pushTargets(tokens);
  if (flags.includes('--force') || flags.includes('-f') || targets.some((target) => target.force)) {
    return 'force push は禁止です。--force-with-lease を使ってください';
  }
  const protectedBranches = [config.baseBranch, config.productionBranch];
  const hit = targets.find((target) => protectedBranches.includes(target.branch));
  if (hit) return `${hit.branch} への直接の push は禁止です。作業ブランチに push して PR にしてください`;
  return null;
}

function checkGh(tokens) {
  if (tokens[1] === 'pr' && tokens[2] === 'merge') return MERGE_ONLY_VIA_LONGRUN;
  if (tokens[1] === 'api' && tokens.some((token) => /pulls\/\d+\/merge\b|\/merges\b/.test(token))) return MERGE_ONLY_VIA_LONGRUN;
  return null;
}

export function forbiddenReason(command, config) {
  for (const tokens of segments(command)) {
    const gitAt = tokens.indexOf('git');
    if (gitAt !== -1 && tokens[gitAt + 1] === 'push') {
      const reason = checkPush(tokens.slice(gitAt), config);
      if (reason) return reason;
    }
    const ghAt = tokens.indexOf('gh');
    if (ghAt !== -1) {
      const reason = checkGh(tokens.slice(ghAt));
      if (reason) return reason;
    }
  }
  return null;
}
