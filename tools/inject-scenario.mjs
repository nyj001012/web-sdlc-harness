#!/usr/bin/env node
/**
 * inject-scenario.mjs — 요구사항 시나리오 정적 주입기 (Static Scenario Spec Injector)
 *
 * 목적:
 *   `business-analyst`가 사용자와 요구사항을 정제해 확정한 Gherkin 시나리오
 *   (`scenario.feature`)를, `inject-design.mjs`가 `design.md`에 대해 하는 것과
 *   동일한 방식으로 소비 대상 에이전트의 **시스템 프롬프트 최상단**에 정적으로
 *   보간(Interpolation)한다.
 *
 * 왜 `inject-design.mjs`와 별도 스크립트인가:
 *   `design.md`와 `scenario.feature`는 생명주기와 검증 규칙, 소비 대상이 다르다.
 *   - 생명주기: `design.md` 부재는 구현 착수를 **차단**하지만, `scenario.feature`
 *     부재는 차단 사유가 아니다 (BA 단계를 거치지 않는 경로도 있고, 기존
 *     `requirements.md`로 폴백할 수 있다).
 *   - 검증 규칙: `design.md`는 5개 필수 섹션 완결성을, `scenario.feature`는
 *     Gherkin 최소 구조(Feature/Scenario/Given·When·Then)를 검사한다.
 *   - 소비 대상: `design.md`는 구현·QA·리뷰 전 계층이 소비하지만, 시나리오는
 *     `system-architect`·`issue-pm` 두 곳만 소비한다 (계약 설계는 `design_spec`
 *     만으로 충분하며 원본 요구사항을 보지 않는 기존 구조를 유지한다).
 *   두 관심사를 한 스크립트에 조건 분기로 욱여넣기보다, 각 파일을 계속
 *   자기완결적으로 유지하기 위해 `inject-design.mjs`의 구조를 복제한다.
 *
 * 사용법 (설치된 호스트의 경로를 그대로 쓴다. 아래는 `.claude` 기준 예시):
 *   node .claude/tools/inject-scenario.mjs            # 주입 (기본)
 *   node .claude/tools/inject-scenario.mjs --check    # 주입 상태 검증만 (드리프트 시 exit 1)
 *   node .claude/tools/inject-scenario.mjs --clear     # 주입 블록 제거 (하네스 원본 복원)
 *   node .claude/tools/inject-scenario.mjs --dry-run   # 변경 없이 결과만 출력
 *   node .claude/tools/inject-scenario.mjs --json      # 결과를 JSON으로 출력
 *   node .claude/tools/inject-scenario.mjs --sections # scenario.feature 최소 Gherkin 구조만 검사 (미충족 시 exit 1)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────
// 경로 상수
// ─────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_DIR = resolve(HERE, '..');          // 이 스크립트가 설치된 호스트 자신: .claude 또는 .codex
const REPO_ROOT = resolve(HOST_DIR, '..');
// scenario.feature·워크스페이스는 이 스크립트가 설치된 호스트(HOST_DIR) 밑에 독립적으로 둔다.
const SCENARIO_PATH = join(HOST_DIR, '_workspace', '00_scenario', 'scenario.feature');
const AGENTS_DIR = join(HOST_DIR, 'agents');

/** 호스트별 에이전트 정의 형식. `inject-design.mjs`와 동일한 판별 로직. */
const FORMAT = basename(HOST_DIR) === '.codex' ? 'toml' : 'md';
const AGENT_EXT = FORMAT === 'toml' ? '.toml' : '.md';

const BEGIN = '<!-- SCENARIO_SPEC:BEGIN -->';
const END = '<!-- SCENARIO_SPEC:END -->';

/**
 * 주입 대상: `scenario.feature`를 요구사항 SSOT로 소비하는 에이전트만.
 *
 * 제외 대상과 근거:
 *   - business-analyst : `scenario.feature`를 **생산**하는 주체. 자기 산출물을
 *                        주입받으면 갱신 직전의 낡은 사본을 SSOT로 오인할 수 있다.
 *   - tech-leader 등 그 외 전원 : 원본 요구사항을 애초에 보지 않고 `<design_spec>`
 *                        (계약 산출 형식·아키텍처 규약)만으로 계약·구현·테스트를
 *                        수행하는 기존 구조를 유지한다. 시나리오까지 이중으로
 *                        받으면 두 SSOT가 계층마다 갈릴 여지가 생긴다.
 */
const TARGETS = ['system-architect', 'issue-pm'];

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────
const argv = new Set(process.argv.slice(2));
const MODE = argv.has('--clear')
  ? 'clear'
  : argv.has('--sections')
    ? 'sections'
    : argv.has('--check')
      ? 'check'
      : 'inject';
const DRY_RUN = argv.has('--dry-run');
const AS_JSON = argv.has('--json');

const fingerprintOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
const rel = (p) => relative(REPO_ROOT, p).split('\\').join('/');

/** CRLF/CR을 LF로 정규화해 지문(fingerprint)이 개행 방식에 흔들리지 않게 한다. */
const normalizeEol = (text) => text.replace(/\r\n?/g, '\n');

// ─────────────────────────────────────────────────────────────
// scenario.feature 최소 Gherkin 구조 검사 (--sections)
// ─────────────────────────────────────────────────────────────
/**
 * design.md의 5개 필수 섹션과 달리, Gherkin 파일은 헤딩이 아니라 키워드 라인으로
 * 구조를 이룬다. 여기서는 "제목이 붙은 Feature 1개 이상", "Scenario(Outline)
 * 1개 이상", "실질적인 Given/When/Then 단계 2줄 이상"만 확인한다 — design.md의
 * 5개 섹션 감사와 달리 자리표시자만 걸러내면 충분한 가벼운 구조 검사다.
 */
function auditGherkin(scenario) {
  const text = scenario ?? '';
  const featureLines = text.match(/^\s*Feature:\s*\S.*$/gm) || [];
  const scenarioLines = text.match(/^\s*Scenario(?: Outline)?:\s*\S.*$/gm) || [];
  const stepLines = text.match(/^\s*(Given|When|Then|And|But)\s+\S.*$/gm) || [];

  return [
    {
      key: 'feature',
      label: 'Feature 선언',
      ok: scenario !== null && featureLines.length > 0,
      reason: scenario === null ? '파일 없음' : featureLines.length > 0 ? '충족' : '없음',
    },
    {
      key: 'scenario',
      label: 'Scenario 1개 이상',
      ok: scenario !== null && scenarioLines.length > 0,
      reason: scenario === null ? '파일 없음' : scenarioLines.length > 0 ? `${scenarioLines.length}개` : '없음',
    },
    {
      key: 'steps',
      label: 'Given/When/Then 본문 2줄 이상',
      ok: scenario !== null && stepLines.length >= 2,
      reason: scenario === null ? '파일 없음' : stepLines.length >= 2 ? `${stepLines.length}줄` : '부족',
    },
  ];
}

/** 구조 검사 결과만 보고한다. 파일을 쓰지 않으며 시나리오 본문을 출력하지 않는다. */
function reportSections(scenario) {
  const sections = auditGherkin(scenario);
  const fingerprint =
    scenario === null ? 'none' : fingerprintOf(scenario.split(END).join('<!-- SCENARIO_SPEC:END(escaped) -->'));
  const missing = sections.filter((s) => !s.ok);
  const summary = {
    mode: MODE,
    dryRun: DRY_RUN,
    scenario: scenario === null ? null : rel(SCENARIO_PATH),
    fingerprint,
    scenarioReady: scenario !== null,
    sections,
    results: [],
    ok: missing.length === 0,
  };

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    console.log('[inject-scenario] 모드=구조검사 (읽기 전용)');
    console.log(
      `[inject-scenario] scenario.feature=${scenario === null ? '없음 (NOT READY)' : rel(SCENARIO_PATH)}  fingerprint=${fingerprint}`,
    );
    for (const s of sections) console.log(`  ${s.ok ? '✓' : '✗'} ${s.label} — ${s.reason}`);
    if (missing.length === 0) {
      console.log('[inject-scenario] ✓ 최소 Gherkin 구조가 모두 충족되었다.');
    } else {
      console.error(`[inject-scenario] ✗ 구조 요건 ${missing.length}개가 미충족이다: ${missing.map((s) => s.label).join(', ')}`);
      console.error('[inject-scenario] business-analyst에게 보완을 지시하라. scenario.feature 본문을 직접 열어 확인하지 마라.');
    }
  }

  if (missing.length > 0) process.exit(1);
}

/**
 * 본문에서 프론트매터(--- ... ---)의 끝 오프셋을 찾는다.
 * `inject-design.mjs`와 동일한 로직.
 */
function frontmatterEnd(text) {
  if (!text.startsWith('---\n')) return 0;
  const close = text.indexOf('\n---\n', 4);
  if (close === -1) return 0;
  return close + '\n---\n'.length;
}

/** Codex TOML 에이전트의 `developer_instructions = '''` 본문 시작 오프셋. `inject-design.mjs`와 동일. */
function tomlBodyStart(text) {
  const m = /developer_instructions\s*=\s*'''\r?\n/.exec(text);
  if (!m) return 0;
  return m.index + m[0].length;
}

/** TOML 리터럴 문자열(`'''...'''`)을 조기 종료시키는 `'''` 시퀀스를 무력화한다. */
function escapeTomlLiteral(text) {
  return text.replace(/'''/g, "''’'");
}

// ─────────────────────────────────────────────────────────────
// 주입 블록 생성
// ─────────────────────────────────────────────────────────────
function buildBlock(scenario) {
  const header = [
    BEGIN,
    `<!-- 자동 생성 영역: \`node ${basename(HOST_DIR)}/tools/inject-scenario.mjs\`가 관리한다. 직접 편집하지 마라. -->`,
  ];

  if (scenario === null) {
    return [
      ...header,
      '',
      '## 📋 요구사항 시나리오 (SCENARIO SPEC) — `[NOT READY]`',
      '',
      '`scenario.feature`가 아직 확정되지 않았다 — `business-analyst`가 요구사항을 정제하지 않았거나, 이 프로젝트가 BA 단계를 거치지 않는 경로다.',
      '',
      '- **이것은 차단 사유가 아니다.** `design.md`의 `[NOT READY]`와 달리, 이 경우 사용자 요구사항 컨텍스트 또는 프로젝트 루트의 `requirements.md`를 근거로 그대로 작업을 진행한다.',
      '- `scenario.feature`를 도구로 찾아 읽으려 시도하지 마라. 존재하지 않으며, 읽는 것은 이 하네스의 규약 위반이다.',
      '',
      '`SCENARIO_FINGERPRINT: none`',
      '',
      END,
    ].join('\n');
  }

  // scenario.feature 본문이 종료 마커를 포함하면 블록 경계가 깨지므로 무력화한다.
  const safe = scenario.split(END).join('<!-- SCENARIO_SPEC:END(escaped) -->');
  const fp = fingerprintOf(safe);
  const embedded = FORMAT === 'toml' ? escapeTomlLiteral(safe) : safe;

  return [
    ...header,
    `<!-- source: ${rel(SCENARIO_PATH)} | fingerprint: ${fp} | bytes: ${Buffer.byteLength(safe, 'utf8')} -->`,
    '',
    '## 📋 요구사항 시나리오 (SCENARIO SPEC) — 이 프로젝트의 요구사항 SSOT (Gherkin)',
    '',
    `아래 \`<scenario_spec>\` 블록은 \`${rel(SCENARIO_PATH)}\` 전문이며, 하네스가 스폰 직전에 정적으로 주입했다.`,
    '사용자가 무엇을 원하는지에 대한 판단은 **전부 이 블록에서만** 가져온다.',
    '',
    '**절대 규칙**',
    '',
    `1. \`scenario.feature\`를 \`Read\`·\`Glob\`·\`Grep\`·\`Bash\`(\`cat\`/\`type\`/\`head\` 등) 등 **어떤 도구로도 다시 읽지 마라.** 이미 아래에 전문이 있다.`,
    '2. 아래 블록에 없는 시나리오·기능을 임의로 추가하거나, 있는 시나리오를 축소·재해석하지 마라.',
    '3. 필요한 시나리오가 아래 블록에 **없으면** 추측하지 말고, 즉시 `[SCENARIO GAP: <필요한 항목>]`을 붙여 오케스트레이터에게 질의한다.',
    '4. 최종 보고 첫 줄에 `SCENARIO_FINGERPRINT: ' + fp + '` 를 그대로 포함한다.',
    '',
    `<scenario_spec fingerprint="${fp}">`,
    embedded.trimEnd(),
    '</scenario_spec>',
    '',
    END,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// 파일 단위 처리
// ─────────────────────────────────────────────────────────────
function applyToAgent(agentName, block) {
  const path = join(AGENTS_DIR, `${agentName}${AGENT_EXT}`);
  if (!existsSync(path)) return { agent: agentName, status: 'missing', path: rel(path) };

  const raw = readFileSync(path, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const original = normalizeEol(raw);
  const beginIdx = original.indexOf(BEGIN);
  const endIdx = original.indexOf(END);
  const hasBlock = beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx;

  let next;
  if (MODE === 'clear') {
    if (!hasBlock) return { agent: agentName, status: 'clean', path: rel(path) };
    const before = original.slice(0, beginIdx).trimEnd();
    const after = original.slice(endIdx + END.length).replace(/^\n+/, '');
    next = `${before}\n\n${after}`;
  } else if (hasBlock) {
    next = original.slice(0, beginIdx) + block + original.slice(endIdx + END.length);
  } else {
    const at = FORMAT === 'toml' ? tomlBodyStart(original) : frontmatterEnd(original);
    const head = original.slice(0, at);
    const tail = original.slice(at).replace(/^\n+/, '');
    next = `${head}\n${block}\n\n${tail}`;
  }

  if (next === original) return { agent: agentName, status: 'unchanged', path: rel(path) };
  if (MODE === 'check') return { agent: agentName, status: 'stale', path: rel(path) };
  if (!DRY_RUN) writeFileSync(path, eol === '\n' ? next : next.replace(/\n/g, eol), 'utf8');
  return { agent: agentName, status: MODE === 'clear' ? 'cleared' : hasBlock ? 'updated' : 'injected', path: rel(path) };
}

// ─────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────
function main() {
  let scenario = null;
  if (MODE !== 'clear') {
    if (existsSync(SCENARIO_PATH)) {
      scenario = normalizeEol(readFileSync(SCENARIO_PATH, 'utf8'));
      if (scenario.trim() === '') scenario = null;
    } else {
      // 워크스페이스 경로는 **실제 주입에서만** 미리 확보한다 (BA가 바로 쓸 수 있도록).
      if (MODE === 'inject' && !DRY_RUN) mkdirSync(dirname(SCENARIO_PATH), { recursive: true });
    }
  }

  if (MODE === 'sections') return reportSections(scenario);

  const block = MODE === 'clear' ? null : buildBlock(scenario);
  const fingerprint =
    scenario === null ? 'none' : fingerprintOf(scenario.split(END).join('<!-- SCENARIO_SPEC:END(escaped) -->'));
  const results = TARGETS.map((name) => applyToAgent(name, block));

  const drift = results.filter((r) => r.status === 'stale' || r.status === 'missing');
  const summary = {
    mode: MODE,
    dryRun: DRY_RUN,
    scenario: scenario === null ? null : rel(SCENARIO_PATH),
    fingerprint,
    scenarioReady: scenario !== null,
    results,
    ok: drift.length === 0,
  };

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    const label = { inject: '주입', check: '검증', clear: '제거' }[MODE];
    console.log(`[inject-scenario] 모드=${label}${DRY_RUN ? ' (dry-run)' : ''}`);
    console.log(
      `[inject-scenario] scenario.feature=${scenario === null ? '없음 (NOT READY)' : rel(SCENARIO_PATH)}  fingerprint=${fingerprint}`,
    );
    for (const r of results) console.log(`  - ${r.agent.padEnd(20)} ${r.status}`);
    if (MODE === 'check' && !summary.ok) {
      console.error(`[inject-scenario] ✗ 주입 상태가 최신이 아니다. \`node ${basename(HOST_DIR)}/tools/inject-scenario.mjs\`를 먼저 실행하라.`);
    } else if (MODE === 'check') {
      console.log('[inject-scenario] ✓ 모든 대상 에이전트의 주입 상태가 최신이다.');
    }
    if (MODE === 'inject' && scenario === null) {
      console.warn('[inject-scenario] ⚠ scenario.feature가 비어 있어 [NOT READY] 블록을 주입했다 (차단 사유는 아니다).');
    }
  }

  if (MODE === 'check' && !summary.ok) process.exit(1);
  if (drift.some((r) => r.status === 'missing')) process.exit(1);
}

main();
