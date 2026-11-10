// routine を API で起動する（https://platform.claude.com/docs/en/api/claude-code/routines-fire）。
// experimental な API なので、形が変わったらここだけを直す。
const API_BASE = 'https://api.anthropic.com/v1/claude_code/routines';
const API_VERSION = '2026-10-21';

export function createFire({ routineId, token, fetchImpl = fetch }) {
  if (!routineId) throw new Error('routine の ID がありません。.claude/longrun/config.json の routineId に trig_ で始まる ID を書いてください');
  if (!token) throw new Error('routine のトークンがありません。GitHub のシークレット LONGRUN_ROUTINE_TOKEN に登録してください');
  return async (text = 'longrun の dispatch から起動しました') => {
    const response = await fetchImpl(`${API_BASE}/${routineId}/fire`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const kind = body?.error?.type ?? 'unknown_error';
      throw new Error(`${response.status} ${kind}: ${body?.error?.message ?? ''}`.trim());
    }
    return body;
  };
}
