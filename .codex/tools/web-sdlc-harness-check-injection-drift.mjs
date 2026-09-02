#!/usr/bin/env node
/**
 * web-sdlc-harness-check-injection-drift.mjs — 주입 드리프트 경고 훅 (SessionStart, Codex 호스트)
 *
 * `.claude/tools/web-sdlc-harness-check-injection-drift.mjs`의 Codex CLI 포트다.
 * `.codex/tools/inject-design.mjs --check`·`inject-scenario.mjs --check`를 세션 시작 시
 * 자동 실행해, `.codex/agents/*.toml`에 주입된 `<design_spec>`·`<scenario_spec>` 블록이
 * 원본(design.md/scenario.feature)과 어긋나 있으면 경고한다. 세션을 막지는 않는다.
 *
 * ⚠ `web-sdlc-harness-guard-ssot-read.mjs`와 같은 이유로, 네이티브 Windows에서는
 * SessionStart 훅 자체가 발동하지 않는 것을 직접 확인했다(openai/codex#17478).
 * macOS/Linux/WSL에서는 정상 작동할 것으로 예상된다.
 *
 * 사용법: node .codex/tools/web-sdlc-harness-check-injection-drift.mjs
 * (SessionStart 훅으로 등록되어 인자 없이 실행된다.)
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function runCheck(script, label) {
  const res = spawnSync(process.execPath, [join(HERE, script), '--check', '--json'], {
    encoding: 'utf8',
  });
  let summary = null;
  try {
    summary = JSON.parse(res.stdout);
  } catch {
    // --json 파싱 실패는 스크립트 자체 오류일 수 있으니 drift로 취급하지 않고 조용히 넘어간다.
  }
  return { script, label, ok: res.status === 0, summary };
}

function main() {
  const results = [
    runCheck('inject-design.mjs', 'design.md'),
    runCheck('inject-scenario.mjs', 'scenario.feature'),
  ];
  const drifted = results.filter((r) => !r.ok && r.summary);

  if (drifted.length === 0) process.exit(0);

  const lines = drifted.map((r) => {
    const staleAgents = (r.summary.results || [])
      .filter((a) => a.status === 'stale' || a.status === 'missing')
      .map((a) => a.agent);
    return `- ${r.label}: 주입 상태가 최신이 아님${staleAgents.length ? ` (대상: ${staleAgents.join(', ')})` : ''}`;
  });

  const message = [
    '[web-sdlc-harness] 정적 주입 드리프트가 감지되었다.',
    ...lines,
    '`node .codex/tools/inject-design.mjs`와 `node .codex/tools/inject-scenario.mjs`를 실행해 에이전트 정의를 최신 상태로 맞춰라.',
  ].join('\n');

  process.stdout.write(JSON.stringify({ systemMessage: message }) + '\n');
  process.exit(0);
}

main();
