// longrun の判定をまとめた純粋関数群。GitHub やファイルには触らない。

const MARKER_PATTERN = /<!--\s*longrun:(\{.*?\})\s*-->/s;

// 指定タイムゾーンでの「時」と「日付」を返す
function localParts(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

// 記録用 issue の識別子。指定タイムゾーンでの日付
export function journalKey(now, timezone) {
  return localParts(now, timezone).date;
}

export function isWithinWindow(now, config) {
  if (!config.window) return true;
  const { startHour, endHour } = config.window;
  const { hour } = localParts(now, config.timezone);
  if (startHour <= endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

// 末尾から数えた連続失敗の件数
function countTrailingFailures(events) {
  // 人間の判断待ちはエージェントの失敗ではないので数えない
  const results = events.filter((event) => event.kind === 'result' && !event.needsHuman);
  let count = 0;
  for (let i = results.length - 1; i >= 0 && !results[i].ok; i -= 1) count += 1;
  return count;
}

export function evaluateStop({ now, config, events }) {
  if (!isWithinWindow(now, config)) {
    return { stop: true, reason: '実行の時間外になった' };
  }
  const failures = countTrailingFailures(events);
  const max = config.limits.maxConsecutiveFailures;
  if (failures >= max) {
    return { stop: true, reason: `続けて ${failures} 件失敗した（上限 ${max}）` };
  }
  return { stop: false };
}

export function countSpawned(events) {
  return events.filter((event) => event.kind === 'spawned').length;
}

export function writeMarker(data) {
  return `<!-- longrun:${JSON.stringify(data)} -->`;
}

export function readMarker(text) {
  if (!text) return null;
  const match = text.match(MARKER_PATTERN);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function depthOf(issue) {
  const marker = readMarker(issue.body);
  if (!marker || marker.kind !== 'spawned') return 0;
  return Number(marker.depth) || 0;
}

const OK_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

export function evaluateChecks(checkRuns) {
  if (checkRuns.length === 0) return 'none';
  const completed = checkRuns.filter((run) => run.status === 'completed');
  if (completed.some((run) => !OK_CONCLUSIONS.has(run.conclusion))) return 'failure';
  if (completed.length < checkRuns.length) return 'pending';
  return 'success';
}

function labelNames(issue) {
  return (issue.labels || []).map((label) => (typeof label === 'string' ? label : label.name));
}

// 確保してよい issue を古い順に並べる
export function rankCandidates(issues, config) {
  const { queue, wip, failed, journal, deferred, needsHuman, awaitingMerge } = config.labels;
  const excluded = new Set([wip, failed, journal, deferred, needsHuman, awaitingMerge].filter(Boolean));
  return issues
    .filter((issue) => !issue.pull_request)
    .filter((issue) => (issue.state ?? 'open') === 'open')
    .filter((issue) => {
      const names = labelNames(issue);
      return names.includes(queue) && !names.some((name) => excluded.has(name));
    })
    .filter((issue) => depthOf(issue) <= config.limits.maxDepth)
    .sort((a, b) => a.number - b.number);
}

export function pickCandidate(issues, config) {
  return rankCandidates(issues, config)[0] ?? null;
}
