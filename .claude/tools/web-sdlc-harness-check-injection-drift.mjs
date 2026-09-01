#!/usr/bin/env node
/**
 * web-sdlc-harness-check-injection-drift.mjs — 주입 드리프트 경고 훅 (SessionStart)
 *
 * 이 훅은 web-sdlc-harness가 설치한 것이다. `npx github:nyj001012/web-sdlc-harness`로
 * 대상 프로젝트에 배포되므로, 대상 프로젝트가 이미 갖고 있을 다른 훅과 섞였을 때도
 * 파일명·태그(`[web-sdlc-harness]`)로 이 훅의 출처를 바로 식별할 수 있게 한다.
 *
 * 목적:
 *   `inject-design.mjs --check`·`inject-scenario.mjs --check`를 세션 시작 시
 *   자동 실행해, 에이전트 정의(.claude/agents/*.md)에 주입된 `<design_spec>`·
 *   `<scenario_spec>` 블록이 원본(design.md/scenario.feature)과 어긋나 있으면
 *   경고한다. 사람이 파이프라인 중간에 주입 스크립트 실행을 깜빡하면, 에이전트가
 *   낡은 설계·시나리오를 SSOT로 오인한 채 작업을 시작할 수 있기 때문이다.
 *
 * 세션을 막지는 않는다(비차단 경고) — 이 훅은 일반 Claude Code 세션에서도 매번
 * 실행되므로, SDLC 파이프라인을 아직 시작하지 않은 신규 클론·무관한 작업에서까지
 * 세션 시작을 가로막으면 과도하다. 대신 systemMessage로 드리프트를 알려
 * 오케스트레이터/사용자가 재주입 여부를 판단하게 한다.
 *
 * 사용법: node .claude/tools/check-injection-drift.mjs
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
    '`node .claude/tools/inject-design.mjs`와 `node .claude/tools/inject-scenario.mjs`를 실행해 에이전트 정의를 최신 상태로 맞춰라.',
  ].join('\n');

  process.stdout.write(JSON.stringify({ systemMessage: message }) + '\n');
  process.exit(0);
}

main();
