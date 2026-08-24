#!/usr/bin/env node
/**
 * inject-design.mjs — 설계 명세 정적 주입기 (Static Design Spec Injector)
 *
 * 목적:
 *   하위 에이전트가 런타임에 `Read` 도구로 `design.md`를 읽는 구조를 제거하고,
 *   하네스(시스템) 단에서 `design.md` 전문을 파일 시스템으로 직접 읽어
 *   각 에이전트의 **시스템 프롬프트 최상단**에 정적으로 보간(Interpolation)한다.
 *
 * 왜:
 *   Claude Code·Codex 모두에서 `<surface>/agents/<name>.md`(`.claude/` 또는 `.codex/`)의
 *   본문은 그대로 해당 서브 에이전트의 시스템 프롬프트가 된다. 시스템 프롬프트는
 *   대화의 불변 접두사이므로, 같은 에이전트 타입을 여러 번 스폰해도 이 영역은
 *   캐시 히트된다. 반면 `Read` 도구 호출은 (1) 에이전트마다 왕복 1회를 추가로
 *   소모하고, (2) 설계 전문이 접두사가 아니라 대화 중간에 들어가며, (3) 에이전트가
 *   일부만 읽거나 건너뛰는 비결정적 동작을 허용한다.
 *
 * 이 스크립트는 표면(`.claude`/`.codex`) 어느 쪽에 설치되어도 동일하게 동작한다.
 * 자기 위치(`import.meta.url`)로 어느 표면인지 판별해 그 표면의 `agents/`에만
 * 주입하지만, `design.md`는 표면과 무관하게 항상 `<repoRoot>/.claude/_workspace/`에서
 * 읽는다 — 두 표면이 같은 프로젝트에서 서로 다른 설계 명세를 SSOT로 삼으면 안 되기
 * 때문이다 (`bin/cli.mjs` 상단 설명 참고).
 *
 * 사용법 (설치된 표면의 경로를 그대로 쓴다. 아래는 `.claude` 기준 예시):
 *   node .claude/tools/inject-design.mjs            # 주입 (기본)
 *   node .claude/tools/inject-design.mjs --check    # 주입 상태 검증만 (드리프트 시 exit 1)
 *   node .claude/tools/inject-design.mjs --clear     # 주입 블록 제거 (하네스 원본 복원)
 *   node .claude/tools/inject-design.mjs --dry-run   # 변경 없이 결과만 출력
 *   node .claude/tools/inject-design.mjs --json      # 결과를 JSON으로 출력
 *   node .claude/tools/inject-design.mjs --sections # design.md 필수 섹션 완결성만 검사 (미충족 시 exit 1)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────
// 경로 상수
// ─────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACE_DIR = resolve(HERE, '..');          // 이 스크립트가 설치된 표면 자신: .claude 또는 .codex
const REPO_ROOT = resolve(SURFACE_DIR, '..');
// design.md·워크스페이스는 표면과 무관하게 항상 `.claude/_workspace/`에 고정한다.
const DESIGN_PATH = join(REPO_ROOT, '.claude', '_workspace', '01_architecture', 'design.md');
const AGENTS_DIR = join(SURFACE_DIR, 'agents');

const BEGIN = '<!-- DESIGN_SPEC:BEGIN -->';
const END = '<!-- DESIGN_SPEC:END -->';

/**
 * 주입 대상: `design.md`를 스택 SSOT로 소비하는 에이전트만.
 *
 * 제외 대상과 근거:
 *   - system-architect : `design.md`를 **생산**하는 주체. 자기 산출물을 주입받으면
 *                        갱신 직전의 낡은 사본을 SSOT로 오인할 수 있다.
 *   - release-manager  : Git push / PR·MR 생성만 담당하며 스택 의존성이 없다.
 */
const TARGETS = [
  'backend-developer',
  'backend-qa',
  'code-reviewer',
  'db-engineer',
  'devops-engineer',
  'e2e-tester',
  'frontend-developer',
  'frontend-qa',
  'issue-pm',
  'tech-leader',
  'tech-writer',
];

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
// design.md 필수 섹션 완결성 검사 (--sections)
// ─────────────────────────────────────────────────────────────
/**
 * 오케스트레이터가 Phase 0·1에서 확인해야 하는 것은 설계서 "전문"이 아니라
 * 필수 섹션이 채워졌는지 여부뿐이다. 그 판정을 하네스 단으로 내려
 * design.md 본문이 오케스트레이터 컨텍스트에 실리지 않게 한다.
 * 그러므로 이 모드는 어떤 경우에도 design.md 본문을 출력하지 않는다.
 */
const REQUIRED_SECTIONS = [
  { key: 'stack', label: '기술 스택', match: (t) => /(기술|테크)\s*스택|tech(nology)?\s*stack/.test(t) },
  {
    key: 'ownership',
    label: '디렉터리 구조 및 소유권',
    match: (t) => /(디렉터리|디렉토리|폴더|directory)\s*(구조|structure)/.test(t) || /소유권|ownership/.test(t),
  },
  { key: 'commands', label: '표준 명령어', match: (t) => /표준\s*(명령어|커맨드)|standard\s*command/.test(t) },
  { key: 'contract', label: '계약 산출 형식', match: (t) => /계약.*(형식|포맷|산출)|contract.*(format|output)/.test(t) },
  {
    key: 'convention',
    label: '아키텍처 규약',
    match: (t) => /아키텍처\s*(규약|규칙|원칙)|architecture\s*(convention|rule|principle)/.test(t),
  },
];

/** 본문이 실질적으로 비어 있음을 뜻하는 자리표시자. 이것만 있으면 미충족으로 본다. */
const PLACEHOLDER = /^(tbd|todo|t\.b\.d\.?|n\/?a|미정|추후\s*작성|작성\s*예정|-+)$/i;

/** 헤딩 텍스트에서 번호·강조·괄호류·이모지를 벗겨 표기 흔들림을 흡수한다. */
function normalizeHeading(raw) {
  return raw
    .replace(/[`*_~]/g, '')
    .replace(/^[\s#]*(?:\d+(?:[.\-)]\d+)*[.)\-]?|[ivxlcdm]+[.)])\s*/i, '')
    .replace(/[^\p{L}\p{N}\s/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * design.md를 헤딩 단위로 훑어 필수 섹션의 존재와 본문 유무를 판정한다.
 * 본문 구간은 "해당 헤딩부터 같거나 더 상위 레벨의 다음 헤딩까지"로 잡아,
 * 내용이 하위 섹션에 들어 있는 경우도 충족으로 인정한다.
 * 코드 펜스 안의 `#` 주석은 헤딩으로 오인하지 않는다.
 */
function auditSections(design) {
  const found = new Map();

  if (design !== null) {
    const lines = design.split('\n');
    const headings = [];
    let inFence = false;

    lines.forEach((line, idx) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
      if (m) headings.push({ level: m[1].length, text: normalizeHeading(m[2]), start: idx });
    });

    headings.forEach((h, i) => {
      const next = headings.slice(i + 1).find((n) => n.level <= h.level);
      const end = next ? next.start : lines.length;
      const body = lines
        .slice(h.start + 1, end)
        .filter((l) => !/^#{1,6}\s/.test(l))
        .map((l) => l.trim())
        .filter((l) => l !== '' && !PLACEHOLDER.test(l));

      for (const spec of REQUIRED_SECTIONS) {
        if (!spec.match(h.text)) continue;
        const prev = found.get(spec.key);
        // 같은 섹션이 여러 번 나오면 "본문이 있는 쪽"을 채택한다.
        if (!prev || (!prev.filled && body.length > 0)) found.set(spec.key, { filled: body.length > 0 });
      }
    });
  }

  return REQUIRED_SECTIONS.map((spec) => {
    const hit = found.get(spec.key);
    if (!hit) return { key: spec.key, label: spec.label, ok: false, reason: '섹션 없음' };
    if (!hit.filled) return { key: spec.key, label: spec.label, ok: false, reason: '본문 비어 있음' };
    return { key: spec.key, label: spec.label, ok: true, reason: '충족' };
  });
}

/** 섹션 검사 결과만 보고한다. 파일을 쓰지 않으며 설계 본문을 출력하지 않는다. */
function reportSections(design) {
  const sections = auditSections(design);
  const fingerprint =
    design === null ? 'none' : fingerprintOf(design.split(END).join('<!-- DESIGN_SPEC:END(escaped) -->'));
  const missing = sections.filter((s) => !s.ok);
  const summary = {
    mode: MODE,
    dryRun: DRY_RUN,
    design: design === null ? null : rel(DESIGN_PATH),
    fingerprint,
    designReady: design !== null,
    sections,
    results: [],
    ok: missing.length === 0,
  };

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    console.log('[inject-design] 모드=섹션검사 (읽기 전용)');
    console.log(
      `[inject-design] design.md=${design === null ? '없음 (NOT READY)' : rel(DESIGN_PATH)}  fingerprint=${fingerprint}`,
    );
    for (const s of sections) console.log(`  ${s.ok ? '✓' : '✗'} ${s.label} — ${s.reason}`);
    if (missing.length === 0) {
      console.log('[inject-design] ✓ 필수 섹션이 모두 충족되었다.');
    } else {
      console.error(`[inject-design] ✗ 필수 섹션 ${missing.length}개가 미충족이다: ${missing.map((s) => s.label).join(', ')}`);
      console.error('[inject-design] system-architect에게 보완을 지시하라. design.md 본문을 직접 열어 확인하지 마라.');
    }
  }

  if (missing.length > 0) process.exit(1);
}

/**
 * 본문에서 프론트매터(--- ... ---)의 끝 오프셋을 찾는다.
 * 프론트매터는 Claude Code의 에이전트 설정이고, 그 뒤 본문이 시스템 프롬프트다.
 * 따라서 "시스템 프롬프트 최상단" = 프론트매터 직후.
 */
function frontmatterEnd(text) {
  if (!text.startsWith('---\n')) return 0;
  const close = text.indexOf('\n---\n', 4);
  if (close === -1) return 0;
  return close + '\n---\n'.length;
}

// ─────────────────────────────────────────────────────────────
// 주입 블록 생성
// ─────────────────────────────────────────────────────────────
function buildBlock(design) {
  const header = [
    BEGIN,
    '<!-- 자동 생성 영역: `node .claude/tools/inject-design.mjs`가 관리한다. 직접 편집하지 마라. -->',
  ];

  if (design === null) {
    return [
      ...header,
      '',
      '## ⛔ 설계 명세 (DESIGN SPEC) — `[NOT READY]`',
      '',
      '`design.md`가 아직 존재하지 않아 이 프로젝트의 기술 스택이 확정되지 않았다.',
      '',
      '- 스택·경로 소유권·표준 명령어에 의존하는 작업에 **착수하지 마라.**',
      '- `design.md`를 도구로 찾아 읽으려 시도하지 마라. 존재하지 않으며, 읽는 것은 이 하네스의 규약 위반이다.',
      '- 즉시 `[STACK UNRESOLVED]` 플래그와 함께 오케스트레이터에게 반환하고 종료한다.',
      '',
      '`DESIGN_FINGERPRINT: none`',
      '',
      END,
    ].join('\n');
  }

  // design.md 본문이 종료 마커를 포함하면 블록 경계가 깨지므로 무력화한다.
  const safe = design.split(END).join('<!-- DESIGN_SPEC:END(escaped) -->');
  const fp = fingerprintOf(safe);

  return [
    ...header,
    `<!-- source: ${rel(DESIGN_PATH)} | fingerprint: ${fp} | bytes: ${Buffer.byteLength(safe, 'utf8')} -->`,
    '',
    '## ⛔ 설계 명세 (DESIGN SPEC) — 이 프로젝트의 유일한 스택 근거',
    '',
    `아래 \`<design_spec>\` 블록은 \`${rel(DESIGN_PATH)}\` 전문이며, 하네스가 스폰 직전에 정적으로 주입했다.`,
    '기술 스택·디렉터리 소유권·표준 명령어·계약 형식·아키텍처 규약에 대한 판단은 **전부 이 블록에서만** 가져온다.',
    '',
    '**절대 규칙**',
    '',
    `1. \`design.md\`를 \`Read\`·\`Glob\`·\`Grep\`·\`Bash\`(\`cat\`/\`type\`/\`head\` 등) 등 **어떤 도구로도 다시 읽지 마라.** 이미 아래에 전문이 있다. 중복 조회는 토큰 낭비이며 규약 위반이다.`,
    '2. 아래 블록에 없는 프레임워크·라이브러리·도구·명령어를 임의로 도입하지 마라.',
    '3. 필요한 정보가 아래 블록에 **없으면** 추측하지 말고, 즉시 `[SPEC GAP: <필요한 항목>]`을 붙여 오케스트레이터에게 질의한다.',
    '4. 최종 보고 첫 줄에 `DESIGN_FINGERPRINT: ' + fp + '` 를 그대로 포함한다. 오케스트레이터가 주입 최신성을 대조하는 데 쓴다.',
    '',
    `<design_spec fingerprint="${fp}">`,
    safe.trimEnd(),
    '</design_spec>',
    '',
    END,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// 파일 단위 처리
// ─────────────────────────────────────────────────────────────
function applyToAgent(agentName, block) {
  const path = join(AGENTS_DIR, `${agentName}.md`);
  if (!existsSync(path)) return { agent: agentName, status: 'missing', path: rel(path) };

  const raw = readFileSync(path, 'utf8');
  // 파싱은 LF를 전제하므로 정규화하되, 기록 시점에 원본 줄바꿈으로 되돌린다.
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
    // 기존 블록을 같은 자리에서 교체한다 (멱등).
    next = original.slice(0, beginIdx) + block + original.slice(endIdx + END.length);
  } else {
    // 최초 주입: 프론트매터 직후 = 시스템 프롬프트 최상단.
    const at = frontmatterEnd(original);
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
  let design = null;
  if (MODE !== 'clear') {
    if (existsSync(DESIGN_PATH)) {
      design = normalizeEol(readFileSync(DESIGN_PATH, 'utf8'));
      if (design.trim() === '') design = null;
    } else {
      // 워크스페이스 경로는 **실제 주입에서만** 미리 확보한다 (아키텍트가 바로 쓸 수 있도록).
      // --check / --sections / --dry-run은 문서상 검증·미리보기 전용이므로 파일 시스템을 바꾸지 않는다.
      if (MODE === 'inject' && !DRY_RUN) mkdirSync(dirname(DESIGN_PATH), { recursive: true });
    }
  }

  // 섹션 검사 모드는 에이전트 파일을 건드리지 않고 여기서 끝난다.
  if (MODE === 'sections') return reportSections(design);

  const block = MODE === 'clear' ? null : buildBlock(design);
  const fingerprint = design === null ? 'none' : fingerprintOf(design.split(END).join('<!-- DESIGN_SPEC:END(escaped) -->'));
  const results = TARGETS.map((name) => applyToAgent(name, block));

  const drift = results.filter((r) => r.status === 'stale' || r.status === 'missing');
  const summary = {
    mode: MODE,
    dryRun: DRY_RUN,
    design: design === null ? null : rel(DESIGN_PATH),
    fingerprint,
    designReady: design !== null,
    results,
    ok: drift.length === 0,
  };

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    const label = { inject: '주입', check: '검증', clear: '제거' }[MODE];
    console.log(`[inject-design] 모드=${label}${DRY_RUN ? ' (dry-run)' : ''}`);
    console.log(`[inject-design] design.md=${design === null ? '없음 (NOT READY)' : rel(DESIGN_PATH)}  fingerprint=${fingerprint}`);
    for (const r of results) console.log(`  - ${r.agent.padEnd(20)} ${r.status}`);
    if (MODE === 'check' && !summary.ok) {
      console.error('[inject-design] ✗ 주입 상태가 최신이 아니다. `node .claude/tools/inject-design.mjs`를 먼저 실행하라.');
    } else if (MODE === 'check') {
      console.log('[inject-design] ✓ 모든 대상 에이전트의 주입 상태가 최신이다.');
    }
    // clear 모드는 design.md를 읽지 않아 design이 항상 null이다. 주입 모드에서만 경고한다.
    if (MODE === 'inject' && design === null) {
      console.warn('[inject-design] ⚠ design.md가 비어 있어 [NOT READY] 블록을 주입했다. 구현 페이즈 진입 전 아키텍처를 확정하라.');
    }
  }

  if (MODE === 'check' && !summary.ok) process.exit(1);
  if (drift.some((r) => r.status === 'missing')) process.exit(1);
}

main();
