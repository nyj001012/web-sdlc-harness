#!/usr/bin/env node
/**
 * web-sdlc-harness — 하네스 스캐폴더 (Harness Scaffolder)
 *
 * 목적:
 *   이 하네스의 배포 단위는 실행 파일이 아니라 `.claude/` 파일 트리다.
 *   오케스트레이터는 프로그램이 아니라 `run_web_sdlc/SKILL.md` 프롬프트이며,
 *   파이프라인을 구동하는 주체는 Claude Code 런타임이다.
 *   따라서 "설치"란 대상 프로젝트에 에이전트·스킬·툴 정의를 놓는 일이다.
 *
 * 왜 전역 설치가 아니라 프로젝트별 복사인가:
 *   `inject-design.mjs`는 `.claude/agents/*.md`를 제자리에서 다시 쓴다.
 *   전역에 한 벌만 두면 여러 프로젝트가 같은 정의 파일을 공유하며 서로의
 *   `<design_spec>` 블록을 덮어쓴다. 프로젝트 A에 Spring 명세를 주입한 뒤
 *   프로젝트 B가 FastAPI 명세를 주입하면 A가 조용히 오염된다.
 *   프로젝트별 사본은 편의가 아니라 설계상 필수다.
 *
 * 왜 쓰기 전에 전수 조사하는가:
 *   주 사용 사례는 빈 폴더 신규 설치가 아니라, 이미 `.claude/`와 `.gitignore`가
 *   있는 기존 프로젝트에 얹는 **병합**이다. 복사 도중 실패하면 반쯤 덮어쓴
 *   상태가 남으므로, 한 건이라도 충돌하면 아무것도 쓰지 않고 멈춘다.
 *
 * 사용법 (npm 미게시 상태이므로 `github:` 스펙으로 저장소에서 직접 받는다.
 * 패키지명만 주면 레지스트리를 조회해 404로 실패한다):
 *   npx github:nyj001012/web-sdlc-harness            # init (기본) — 신규 설치
 *   npx github:nyj001012/web-sdlc-harness update     # 코어만 최신화, 사용자 자산 보존
 *   npx github:nyj001012/web-sdlc-harness --dry-run  # 쓰지 않고 계획만 출력
 *   node bin/cli.mjs --preflight                             # 배포 전 오염 검사 (publish 게이트)
 */

import {
  readdirSync, statSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');

/**
 * 대상 프로젝트로 복사할 하위 트리. `_workspace/`는 런타임 산출물이라 제외한다.
 *
 * `core` 표시는 update 모드에서 교체 대상인지를 뜻한다. 세 디렉터리 모두 코어다 —
 * `agents/`도 사용자 편집 영역이 아니라 `inject-design.mjs`가 기계적으로
 * 재작성하는 자리이므로, 사용자 자산으로 보호할 대상이 아니다.
 */
const COPY_DIRS = ['agents', 'skills', 'tools'];

/**
 * 대상에 빈 디렉터리로 확보할 경로.
 * 두 경로는 추적 대상 합의물(`design.md`·인터페이스 계약)이 놓이는 자리이므로
 * 미리 만들어 준다. 나머지 `_workspace` 경로(log·handoff·02_issues)는
 * 실행 중 생성되는 휘발성 상태라서 만들지 않는다.
 */
const ENSURE_DIRS = [
  ['_workspace', '01_architecture'],
  ['_workspace', '03_contracts'],
];

/** 대상 `.gitignore`에 보장해야 하는 런타임 경로. 하네스 저장소의 .gitignore와 같은 근거다. */
const IGNORE_ENTRIES = [
  '.claude/_workspace/log/',
  '.claude/_workspace/handoff/',
  '.claude/_workspace/02_issues/',
];
const IGNORE_HEADER = '# web-sdlc-harness 런타임 산출물 (재현 가능하므로 추적하지 않는다)';

/** 주입 블록 시작 표지. `inject-design.mjs`의 BEGIN과 같은 값이어야 한다. */
const INJECT_BEGIN = '<!-- DESIGN_SPEC:BEGIN -->';

// ─────────────────────────────────────────────────────────────
// 인자 파싱
// ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : null;
};

const FORCE = has('--force');
const DRY_RUN = has('--dry-run');
const TARGET_ROOT = resolve(valueOf('--target') ?? process.cwd());
const TARGET_CLAUDE = join(TARGET_ROOT, '.claude');

const positional = argv.filter((a) => !a.startsWith('-'));
const targetValue = valueOf('--target');
const COMMAND = positional.filter((a) => a !== targetValue)[0] ?? 'init';

const toPosix = (p) => p.split('\\').join('/');

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────
/**
 * 디렉터리를 재귀 순회해 파일 상대 경로를 모은다.
 * `readdirSync(..., {recursive:true})`는 Node 20.1+이므로 직접 훑어
 * engines 하한(16.7 — `cpSync` 도입 버전)을 유지한다.
 */
function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, acc);
    else acc.push(relative(base, full));
  }
  return acc;
}

function fail(message) {
  console.error(`[harness] \u2717 ${message}`);
  process.exit(1);
}

const log = (message) => console.log(`[harness] ${message}`);

/** 패키지에 담긴 소스 트리를 검증하고 {name, src, files} 목록을 낸다. */
function readSources() {
  const sources = COPY_DIRS.map((name) => ({ name, src: join(PKG_ROOT, '.claude', name) }));
  const missing = sources.filter((s) => !existsSync(s.src));
  if (missing.length) {
    fail(`패키지가 손상됐다. 없는 경로: ${missing.map((s) => `.claude/${s.name}`).join(', ')}`);
  }
  return sources.map((s) => ({ ...s, files: walk(s.src) }));
}

/** 하네스가 이미 설치돼 있는지 — 코어 디렉터리가 하나라도 있으면 설치된 것으로 본다. */
const isInstalled = () => COPY_DIRS.some((d) => existsSync(join(TARGET_CLAUDE, d)));

/** 대상 `agents/`에 주입 블록이 남아 있는 파일 목록. update 후 재주입 안내에 쓴다. */
function injectedAgents() {
  const dir = join(TARGET_CLAUDE, 'agents');
  if (!existsSync(dir)) return [];
  return walk(dir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes(INJECT_BEGIN));
}

// ─────────────────────────────────────────────────────────────
// .gitignore 병합
// ─────────────────────────────────────────────────────────────
/**
 * 런타임 3경로를 대상 `.gitignore`에 중복 없이 append한다.
 * 기존 파일을 덮어쓰지 않는다 — 대상 프로젝트의 무시 규칙은 그 프로젝트 것이고,
 * 스택별 규칙(빌드 산출물·의존성 디렉터리)은 하네스가 관여할 영역이 아니다.
 */
function mergeGitignore() {
  const path = join(TARGET_ROOT, '.gitignore');
  const exists = existsSync(path);
  const original = exists ? readFileSync(path, 'utf8') : '';
  const present = new Set(original.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORE_ENTRIES.filter((e) => !present.has(e));

  if (!missing.length) return { action: 'unchanged', added: [] };
  if (DRY_RUN) return { action: exists ? 'would-append' : 'would-create', added: missing };

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const body = [IGNORE_HEADER, ...missing].join(eol) + eol;
  const gap = !original ? '' : original.endsWith('\n') ? eol : eol + eol;
  writeFileSync(path, original + gap + body, 'utf8');
  return { action: exists ? 'appended' : 'created', added: missing };
}

function reportGitignore(result) {
  const label = {
    unchanged: '이미 등록돼 있어 건드리지 않았다',
    appended: `${result.added.length}건 추가`,
    created: `새로 생성 (${result.added.length}건)`,
    'would-append': `${result.added.length}건 추가 예정`,
    'would-create': `새로 생성 예정 (${result.added.length}건)`,
  }[result.action];
  console.log(`  - .gitignore: ${label}`);
}

// ─────────────────────────────────────────────────────────────
// init : 신규 설치
// ─────────────────────────────────────────────────────────────
function init() {
  const sources = readSources();

  // 충돌 전수 조사를 쓰기 전에 끝낸다. 부분 설치를 만들지 않기 위함이다.
  const conflicts = [];
  let planned = 0;
  for (const { name, src, files } of sources) {
    for (const f of files) {
      planned += 1;
      if (existsSync(join(TARGET_CLAUDE, name, f))) conflicts.push(toPosix(join('.claude', name, f)));
    }
    void src;
  }

  if (conflicts.length && !FORCE) {
    console.error(`[harness] \u2717 대상에 이미 존재하는 파일 ${conflicts.length}건이 있어 중단했다. 아무것도 쓰지 않았다.`);
    for (const c of conflicts.slice(0, 20)) console.error(`    - ${c}`);
    if (conflicts.length > 20) console.error(`    \u2026 외 ${conflicts.length - 20}건`);
    console.error('');
    console.error('[harness]   하네스가 이미 설치돼 있다면 `update`를 써라 — 코어만 갈아끼우고 사용자 자산은 보존한다.');
    console.error('[harness]   그래도 전부 덮어쓰려면 `--force`. 대상의 자체 스킬·에이전트가 사라질 수 있다.');
    process.exit(1);
  }

  log(`대상: ${TARGET_ROOT}`);
  log(`init — 파일 ${planned}건${conflicts.length ? ` (덮어쓰기 ${conflicts.length}건)` : ''}${DRY_RUN ? ' \u2014 dry-run' : ''}`);

  if (!DRY_RUN) {
    for (const { name, src } of sources) {
      cpSync(src, join(TARGET_CLAUDE, name), { recursive: true, force: true });
    }
    for (const parts of ENSURE_DIRS) mkdirSync(join(TARGET_CLAUDE, ...parts), { recursive: true });
  }
  for (const { name, files } of sources) console.log(`  - .claude/${name}/ (${files.length}건)`);
  for (const parts of ENSURE_DIRS) console.log(`  - .claude/${parts.join('/')}/ (빈 디렉터리)`);
  reportGitignore(mergeGitignore());

  console.log('');
  log('\u2713 설치 완료.');
  log('  Claude Code를 열고 하고 싶은 작업을 요청하면 run_web_sdlc가 라우팅한다.');
  log('  예: "센서 관제 대시보드를 만들어줘", "로그인 API만 구현해줘"');
  log('  기술 스택은 Phase 1에서 system-architect가 확정한다 \u2014 design.md를 직접 쓸 필요는 없다.');
}

// ─────────────────────────────────────────────────────────────
// update : 코어만 최신화
// ─────────────────────────────────────────────────────────────
/**
 * 코어 트리(agents·skills·tools)를 최신 버전으로 교체한다.
 *
 * 보존 규칙:
 *   - `_workspace/`는 애초에 배포물에 없다. `design.md`와 계약은 손댈 위험 자체가 없다.
 *   - `.claude/settings*.json`도 복사 범위 밖이라 그대로 남는다.
 *   - 대상에만 있고 패키지에 없는 파일(사용자가 추가한 자체 스킬·에이전트)은
 *     지우지 않는다. 삭제는 복구가 안 되므로 보고만 하고 판단은 사람에게 남긴다.
 */
function update() {
  if (!isInstalled()) {
    fail(`대상에 하네스가 없다: ${TARGET_ROOT}\n           \u2192 먼저 \`npx github:nyj001012/web-sdlc-harness\` 로 설치하라.`);
  }

  const sources = readSources();
  const injected = injectedAgents();

  // 패키지에 없는데 대상에는 있는 파일 = 사용자 자산 또는 하네스에서 제거된 고아.
  const orphans = [];
  for (const { name, files } of sources) {
    const destDir = join(TARGET_CLAUDE, name);
    if (!existsSync(destDir)) continue;
    const known = new Set(files.map(toPosix));
    for (const f of walk(destDir)) {
      if (!known.has(toPosix(f))) orphans.push(toPosix(join('.claude', name, f)));
    }
  }

  const replaced = sources.reduce((n, s) => n + s.files.length, 0);
  log(`대상: ${TARGET_ROOT}`);
  log(`update \u2014 코어 ${replaced}건 교체${DRY_RUN ? ' \u2014 dry-run' : ''}`);

  if (!DRY_RUN) {
    for (const { name, src } of sources) {
      cpSync(src, join(TARGET_CLAUDE, name), { recursive: true, force: true });
    }
    for (const parts of ENSURE_DIRS) mkdirSync(join(TARGET_CLAUDE, ...parts), { recursive: true });
  }
  for (const { name, files } of sources) console.log(`  - .claude/${name}/ (${files.length}건 교체)`);
  console.log('  - .claude/_workspace/ : 손대지 않았다 (design.md·계약은 사용자 자산)');
  console.log('  - .claude/settings*.json : 손대지 않았다 (복사 범위 밖)');
  reportGitignore(mergeGitignore());

  if (orphans.length) {
    console.log('');
    log(`대상에만 있는 파일 ${orphans.length}건은 보존했다 (자체 스킬이거나, 하네스에서 제거된 항목):`);
    for (const o of orphans.slice(0, 15)) console.log(`    - ${o}`);
    if (orphans.length > 15) console.log(`    \u2026 외 ${orphans.length - 15}건`);
    log('  지울지 여부는 직접 판단하라. 이 도구는 삭제하지 않는다.');
  }

  console.log('');
  log('\u2713 최신화 완료.');
  if (injected.length) {
    log(`\u26a0 교체 전 agents/ ${injected.length}건에 주입 블록이 있었다. 교체로 사라졌으므로 재주입이 필요하다:`);
    log('    node .claude/tools/inject-design.mjs');
  }
  log('  Claude Code가 세션 시작 시점의 에이전트 정의를 잡고 있으면 갱신이 반영되지 않는다. 세션을 재시작하라.');
}

// ─────────────────────────────────────────────────────────────
// --preflight : 배포 전 오염 검사 (publish 게이트)
// ─────────────────────────────────────────────────────────────
/**
 * npm publish 직전에 패키지가 오염되지 않았음을 확인한다.
 *
 * 막으려는 사고: `inject-design.mjs`가 남긴 `<design_spec>` 블록이 그대로
 * publish되면 **이 저장소의 design.md 전문이 남의 프로젝트로 새어 나간다.**
 * 하네스 README가 "주입 결과를 의도적으로 커밋하는 곳은 Phase 1 한 곳"이라
 * 규정하고 있으므로, Phase 1을 수행한 사이클 뒤에는 실제로 발생할 수 있다.
 */
function preflight() {
  const problems = [];
  const agentsDir = join(PKG_ROOT, '.claude', 'agents');

  if (!existsSync(agentsDir)) {
    problems.push(`에이전트 정의 디렉터리가 없다: ${agentsDir}`);
  } else {
    const dirty = walk(agentsDir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => readFileSync(join(agentsDir, f), 'utf8').includes(INJECT_BEGIN));
    if (dirty.length) {
      problems.push(
        `주입 블록이 남아 있다 (${dirty.length}건): ${dirty.map(toPosix).join(', ')}\n` +
        '           \u2192 `node .claude/tools/inject-design.mjs --clear` 를 먼저 실행하라.',
      );
    }
  }

  // `files` 화이트리스트가 런타임 경로를 배제하고 의존성이 0인지 이중으로 확인한다.
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
  const leaks = (pkg.files ?? []).filter((p) => p.includes('_workspace'));
  if (leaks.length) problems.push(`files에 런타임 경로가 포함됐다: ${leaks.join(', ')}`);
  const deps = Object.keys(pkg.dependencies ?? {});
  if (deps.length) problems.push(`dependencies가 비어 있지 않다: ${deps.join(', ')}`);

  /*
   * 라이선스 선언과 실물이 어긋나지 않았는지 확인한다.
   *
   * 한동안 `license` 필드가 비어 있고 LICENSE 파일도 없었다. 그 상태로 publish하면
   * 저작권이 전부 유보되므로 이용자가 합법적으로 쓸 수 없다. 반대 방향의 어긋남
   * (파일을 지우고 필드만 남기거나 그 반대)도 같은 결과를 낳으므로, 사람 기억이
   * 아니라 게이트가 둘의 일치를 지킨다.
   */
  if (!pkg.license) problems.push('package.json에 license 필드가 없다.');
  if (!existsSync(join(PKG_ROOT, 'LICENSE'))) {
    problems.push('루트에 LICENSE 파일이 없다. license 필드만 선언해도 라이선스 고지가 되지 않는다.');
  }

  /*
   * 실행 스크립트의 shebang이 CRLF로 끝나지 않았는지 확인한다.
   *
   * `npm pack`은 index가 아니라 워킹트리에서 tarball을 만든다. 그래서 저장소를
   * LF로 정규화하는 것만으로는 부족하다. Windows에서 publish하면 워킹트리의 CRLF가
   * 그대로 배포되고, `#!/usr/bin/env node\r`가 된 shebang은 macOS·Linux에서
   * `bad interpreter`로 죽는다. 즉 배포 진입점이 Unix에서 실행되지 않는다.
   *
   * `.gitattributes`가 1차 방어선이지만, 에디터가 CRLF로 저장하거나 파일이 다른
   * 경로로 들어오면 다시 깨진다. publish를 막는 이 게이트가 최종 방어선이다.
   */
  const scripts = [join('bin', 'cli.mjs'), join('.claude', 'tools', 'inject-design.mjs')];
  for (const relPath of scripts) {
    const full = join(PKG_ROOT, relPath);
    if (!existsSync(full)) continue;
    const firstLine = readFileSync(full, 'utf8').split('\n')[0];
    if (!firstLine.startsWith('#!')) continue;
    if (firstLine.endsWith('\r')) {
      problems.push(
        `${toPosix(relPath)}의 shebang이 CRLF로 끝난다. Unix에서 실행되지 않는다.\n` +
        '           → `.gitattributes`의 `*.mjs text eol=lf`를 확인하고 `git add --renormalize .` 후 재체크아웃하라.',
      );
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`[harness] \u2717 ${p}`);
    process.exit(1);
  }
  log('\u2713 preflight 통과 \u2014 주입 블록 0건, 런타임 경로 0건, 의존성 0건, 라이선스 일치, shebang LF');
}

// ─────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────
const HELP = `
web-sdlc-harness \u2014 Claude Code 애자일 SDLC 하네스 스캐폴더

  npx github:nyj001012/web-sdlc-harness [명령] [옵션]

  npm 레지스트리에 미게시 상태다. 패키지명만 주면 404로 실패하므로 \`github:\` 스펙을 쓴다.

명령:
  init       신규 설치 (기본). 대상에 같은 파일이 있으면 아무것도 쓰지 않고 멈춘다
  update     코어(agents·skills·tools)만 최신화. _workspace와 settings는 손대지 않는다

옵션:
  --target <dir>   대상 디렉터리 (기본: 현재 디렉터리)
  --force          init에서 충돌 파일을 덮어쓴다
  --dry-run        아무것도 쓰지 않고 계획만 출력한다
  --preflight      배포 전 오염 검사 (주입 블록·런타임 경로·의존성)
  --help, -h       이 도움말
`.trim();

if (has('--help') || has('-h')) {
  console.log(HELP);
} else if (has('--preflight')) {
  preflight();
} else if (COMMAND === 'init') {
  init();
} else if (COMMAND === 'update') {
  update();
} else {
  console.error(`[harness] \u2717 알 수 없는 명령: ${COMMAND}`);
  console.error('');
  console.error(HELP);
  process.exit(1);
}
