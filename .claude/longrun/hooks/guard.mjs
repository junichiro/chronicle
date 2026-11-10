#!/usr/bin/env node
// PreToolUse hook（Bash）。run の最中だけ、守るべきブランチを壊すコマンドを拒否する。
import { readFileSync } from 'node:fs';
import { createContext } from '../lib/context.mjs';
import { forbiddenReason } from '../lib/guard.mjs';

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const command = input.tool_input?.command;
  if (!command) return;
  const ctx = createContext();
  if (!ctx.state.load()) return;
  const reason = forbiddenReason(command, ctx.config);
  if (!reason) return;
  process.stderr.write(`[longrun] ${reason}\n`);
  process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`[longrun] guard hook でエラー: ${error.message}\n`);
}
