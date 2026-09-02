#!/usr/bin/env node
/**
 * web-sdlc-harness-guard-ssot-read.mjs — SSOT 재열람 차단 훅 (PreToolUse)
 *
 * 이 훅은 web-sdlc-harness가 설치한 것이다. `npx github:nyj001012/web-sdlc-harness`로
 * 대상 프로젝트에 배포되므로, 대상 프로젝트가 이미 갖고 있을 다른 훅과 섞였을 때도
 * 파일명·태그(`[web-sdlc-harness]`)로 이 훅의 출처를 바로 식별할 수 있게 한다.
 *
 * 목적:
 *   `design.md`(system-architect 산출물)와 `scenario.feature`(business-analyst
 *   산출물)는 `inject-design.mjs`/`inject-scenario.mjs`가 소비 대상 에이전트의
 *   시스템 프롬프트에 이미 정적으로 주입한다. 그런데도 하위 에이전트가 `Read`·
 *   `Grep`·`Bash`(cat/type/head 등)로 같은 내용을 다시 조회하면 이중 SSOT가
 *   생기고, 주입 시점 이후의 변경(드리프트) 여지도 생긴다. 각 에이전트 정의(md)
 *   본문에 이미 "다시 읽지 마라"는 규약이 있지만 그건 설득일 뿐 강제가 아니므로,
 *   이 훅이 도구 호출 자체를 막는다.
 *
 * 범위 (하네스 문서화된 예외를 존중한다):
 *   - design.md      : Read/Grep/Bash 전부 차단. system-architect(생산자)도
 *                       자기 초안을 도구로 재조회해야 한다는 예외 조항이
 *                       agents/system-architect.md에 없으므로 전면 차단한다.
 *   - scenario.feature: Grep/Bash만 차단, Read는 허용한다.
 *                       agents/business-analyst.md 13행이 "자신이 이전
 *                       라운드에 쓴 scenario.feature 초안(재작성 시)"의 Read를
 *                       명시적으로 허용하고 있어, Read까지 막으면 그 문서화된
 *                       워크플로우가 깨진다.
 *
 * 이 훅은 호출자(어느 서브에이전트인지)를 구분할 수 없다 — PreToolUse stdin에
 * session_id·tool_name·tool_input만 있고 에이전트 신원은 없다. 그래서 위 범위는
 * "가장 널리 문서화된 예외 하나만 살리고 나머지는 막는다"는 보수적 절충이다.
 *
 * 입력(stdin): { tool_name, tool_input, ... } — Claude Code PreToolUse 훅 표준 스키마.
 * 출력: 차단 시 hookSpecificOutput.permissionDecision="deny" JSON, 허용 시 무출력(exit 0).
 */

import { readFileSync } from 'node:fs';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  if (!raw) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = payload.tool_name;
  const toolInput = payload.tool_input || {};

  const norm = (s) => (typeof s === 'string' ? s.replace(/\\/g, '/').toLowerCase() : '');
  const isDesignTarget = (s) => {
    const n = norm(s);
    return n.includes('design.md') || n.includes('_workspace/01_architecture');
  };
  const isScenarioTarget = (s) => {
    const n = norm(s);
    return n.includes('scenario.feature') || n.includes('_workspace/00_scenario');
  };
  // Bash는 자유 텍스트라 파일명이 커밋 메시지·주석 등 "언급"으로만 등장해도
  // 전체 명령어 문자열 기준으로는 매칭될 수 있다("Claude Code hooks"의 "Code"가
  // `code` 명령으로 오인되고, 그 문자열 어딘가에 "design.md"가 또 있으면 오탐).
  // 그래서 (1) 명령어를 절(clause) 단위로 나누고 (2) 같은 절 안에 열람 동사와
  // 대상 파일이 함께 있을 때만 차단한다 — 실제 `cat design.md` 같은 호출은 한
  // 절 안에 동사·파일이 붙어 있지만, 여러 줄짜리 커밋 메시지 본문은 동사와
  // 파일명이 서로 다른 줄(=다른 절)에 흩어져 있어 걸리지 않는다.
  const CLAUSE_SPLIT = /\r?\n|&&|\|\||;|\|/;
  const BASH_READ_VERB = /(^|[\s(])(cat|type|head|tail|less|more|sed|awk|grep|egrep|fgrep|findstr|get-content|gc|bat|nl|vim|vi|nano|code)\s/i;
  const isBashReadAttempt = (command, target) => {
    if (typeof command !== 'string') return false;
    return command
      .split(CLAUSE_SPLIT)
      .some((clause) => BASH_READ_VERB.test(clause) && target(clause));
  };

  const DESIGN_REASON =
    '[web-sdlc-harness] design.md는 이미 시스템 프롬프트 최상단에 정적 주입되어 있다. 도구로 다시 읽지 말고 주입된 <design_spec> 블록만 사용하라.';
  const SCENARIO_REASON =
    '[web-sdlc-harness] scenario.feature는 이미 소비 대상 에이전트의 시스템 프롬프트에 정적 주입되어 있다. Grep/Bash로 재조회하지 말고 주입된 <scenario_spec> 블록만 사용하라.';

  function deny(reason) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }) + '\n',
    );
    process.exit(0);
  }

  if (toolName === 'Read') {
    if (isDesignTarget(toolInput.file_path)) deny(DESIGN_REASON);
    // scenario.feature Read는 business-analyst의 재작성 워크플로우를 위해 허용한다.
  } else if (toolName === 'Grep') {
    if (isDesignTarget(toolInput.path)) deny(DESIGN_REASON);
    if (isScenarioTarget(toolInput.path)) deny(SCENARIO_REASON);
  } else if (toolName === 'Bash') {
    if (isBashReadAttempt(toolInput.command, isDesignTarget)) deny(DESIGN_REASON);
    if (isBashReadAttempt(toolInput.command, isScenarioTarget)) deny(SCENARIO_REASON);
  }

  process.exit(0);
}

main();
