#!/usr/bin/env node
/**
 * web-sdlc-harness-guard-ssot-read.mjs — SSOT 재열람 차단 훅 (PreToolUse, Codex 호스트)
 *
 * `.claude/tools/web-sdlc-harness-guard-ssot-read.mjs`의 Codex CLI 포트다. 목적과 대상
 * 파일(design.md·scenario.feature)은 동일하지만, Codex는 Claude Code와 달리 파일을
 * 읽는 별도의 `Read`/`Grep` 도구가 없다 — 전부 통합 셸 도구(`Bash` 매처, 문서:
 * learn.chatgpt.com/docs/hooks) 하나를 거친다. 그래서 이 훅은 Bash 한 갈래만 본다.
 *
 * Claude 쪽은 "Read(전체 열람)는 허용, Grep/Bash(부분 열람)는 차단"으로 design.md는
 * 전면 차단하되 scenario.feature만 business-analyst.md의 문서화된 "이전 라운드
 * 재작성" 예외(Read 허용)를 살렸다. Codex는 Read와 Grep이 물리적으로 같은 도구라
 * 그 구분을 그대로 옮길 수 없어서, **열람 동사의 종류**로 같은 의도를 재현한다:
 *   - 전체 덤프 동사(cat/type/get-content/bat 등)  → Claude의 Read에 대응. design.md는
 *     차단하지만 scenario.feature는 허용해 business-analyst의 재작성 워크플로우를 보존한다.
 *   - 부분 열람 동사(head/tail/grep/sed/awk/findstr/nl/vim/vi/nano/code 등) → Claude의
 *     Grep/Bash에 대응. design.md·scenario.feature 둘 다 차단한다.
 *
 * (Claude 쪽과 동일하게) 명령어 전체 문자열이 아니라 **같은 절(clause)** 안에서
 * 동사와 대상 파일이 함께 나타날 때만 차단한다 — 그렇지 않으면 이 훅 자체를 설명하는
 * 커밋 메시지처럼 파일명이 프로즈로만 언급된 경우까지 오탐으로 막힌다(Claude 포트
 * 작업 중 실제로 겪은 버그, git 이력 참고).
 *
 * ⚠ 알려진 제약: 이 글 작성 시점 기준, 네이티브 Windows에서 Codex CLI의 hooks가
 * 스키마상으로는 인식되지만 실제로 도구 호출을 차단하지 않는 것이 직접 확인됐고
 * (`codex exec` 3가지 배치 방식 모두 미발동), 업스트림에도 동일 증상의 이슈가 열려
 * 있다(openai/codex#17478, "Enable hooks on Windows"). macOS/Linux/WSL에서는 정상
 * 작동할 것으로 예상되나(공식 스키마 그대로 구현했다) 직접 검증하지는 못했다. 이
 * 파일은 스키마가 고쳐지면 별도 수정 없이 그대로 작동하도록 작성했다.
 *
 * 입력(stdin): Codex PreToolUse 훅 표준 스키마 — { tool_name, tool_input, ... }.
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
  if (toolName !== 'Bash') process.exit(0);

  const command = toolInput.command;
  if (typeof command !== 'string') process.exit(0);

  const norm = (s) => (typeof s === 'string' ? s.replace(/\\/g, '/').toLowerCase() : '');
  const isDesignTarget = (s) => {
    const n = norm(s);
    return n.includes('design.md') || n.includes('_workspace/01_architecture');
  };
  const isScenarioTarget = (s) => {
    const n = norm(s);
    return n.includes('scenario.feature') || n.includes('_workspace/00_scenario');
  };

  // 절(clause) 분리: 명령어를 줄바꿈·논리연산자·파이프 단위로 쪼개, 같은 절 안에서만
  // 동사·대상 co-occurrence를 본다 (여러 줄짜리 커밋 메시지 오탐 방지 — 위 주석 참고).
  const CLAUSE_SPLIT = /\r?\n|&&|\|\||;|\|/;
  const DUMP_VERB = /(^|[\s(])(cat|type|get-content|gc|bat)\s/i;
  const PARTIAL_VERB = /(^|[\s(])(head|tail|less|more|sed|awk|grep|egrep|fgrep|findstr|nl|vim|vi|nano|code)\s/i;

  const clauses = command.split(CLAUSE_SPLIT);
  const anyClause = (verbRe, target) => clauses.some((c) => verbRe.test(c) && target(c));

  const DESIGN_REASON =
    '[web-sdlc-harness] design.md는 이미 시스템 프롬프트 최상단에 정적 주입되어 있다. 셸로 다시 읽지 말고 주입된 <design_spec> 블록만 사용하라.';
  const SCENARIO_REASON =
    '[web-sdlc-harness] scenario.feature는 이미 소비 대상 에이전트의 시스템 프롬프트에 정적 주입되어 있다. head/tail/grep 등으로 부분 열람하지 말고 주입된 <scenario_spec> 블록만 사용하라.';

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

  // design.md: 전체 덤프·부분 열람 동사 모두 차단 (Claude의 Read+Grep+Bash 전면 차단과 동일).
  if (anyClause(DUMP_VERB, isDesignTarget)) deny(DESIGN_REASON);
  if (anyClause(PARTIAL_VERB, isDesignTarget)) deny(DESIGN_REASON);

  // scenario.feature: 부분 열람 동사만 차단. 전체 덤프(cat 등)는 business-analyst의
  // "이전 라운드 재작성" 문서화된 예외(Claude의 Read 허용)를 보존하기 위해 허용한다.
  if (anyClause(PARTIAL_VERB, isScenarioTarget)) deny(SCENARIO_REASON);

  process.exit(0);
}

main();
