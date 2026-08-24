#!/usr/bin/env node
/**
 * web-sdlc-harness — 하네스 스캐폴더 (Harness Scaffolder)
 *
 * 목적:
 *   이 하네스의 배포 단위는 실행 파일이 아니라 파일 트리(`.claude/`·`.codex/`)다.
 *   오케스트레이터는 프로그램이 아니라 `run_web_sdlc/SKILL.md` 프롬프트이며,
 *   파이프라인을 구동하는 주체는 Claude Code 또는 Codex CLI 런타임이다.
 *   따라서 "설치"란 대상 프로젝트에 에이전트·스킬·툴 정의를 놓는 일이다.
 *
 * 두 표면(surface) — Claude Code와 Codex:
 *   두 런타임은 스캐폴딩 규격(에이전트 정의 형식·서브에이전트 위임 방식)이 달라
 *   같은 소스를 그대로 공유할 수 없다. 그래서 패키지는 `.claude/`와 `.codex/`
 *   두 벌의 소스 트리를 따로 담고 있으며, 설치 시 `--claude`/`--codex`로 대상
 *   표면을 고른다(기본값은 둘 다). `tools/`(design.md 정적 주입기)만은 규격
 *   차이가 없는 순수 Node 스크립트이므로 `.claude/tools/`를 유일한 원본으로 두고
 *   두 표면 모두에 같은 파일을 복사한다 — 두 벌을 따로 관리하면 한쪽만 고치는
 *   드리프트가 생기기 때문이다.
 *
 * 예외: Codex의 스킬 배치 경로.
 *   Codex CLI는 스킬(SKILL.md)을 `.codex/` 밑이 아니라 저장소 루트 기준
 *   `.agents/skills/`에서 탐색한다(공식 문서 확인). 그래서 `codex` 표면만
 *   `skills`의 목적지가 `.codex/skills`가 아니라 `.agents/skills`다 — 아래
 *   `surfacePath()`가 이 예외 하나만 처리한다. Codex 에이전트(`.codex/agents/*.toml`)와
 *   공유 `tools/`는 이 예외 밖이다.
 *
 * 설계 명세(design.md)와 워크스페이스는 표면과 무관하게 하나다:
 *   `.claude/_workspace/`는 표면을 고르지 않는다. Claude 전용 설치(`--codex` 없이)든
 *   Codex 전용 설치(`--codex`)든 항상 `.claude/_workspace/`에 고정한다. 두 런타임이
 *   같은 프로젝트에서 같은 design.md를 SSOT로 봐야 하므로, 실행 도구에 따라
 *   설계 명세가 갈라지면 안 된다. `--codex` 단독 설치에서도 `.claude/` 디렉터리
 *   자체는 생기지만, 그 안에는 `_workspace/`만 있고 `agents/`·`skills/`는 없다.
 *
 * 왜 전역 설치가 아니라 프로젝트별 복사인가:
 *   `inject-design.mjs`는 각 표면의 에이전트 정의 파일(`.claude/agents/*.md`, `.codex/agents/*.toml`)을 제자리에서 다시 쓴다.
 *   정의 파일 자체를 홈 디렉터리 등 전역 한 벌로 두면 여러 프로젝트가 같은
 *   정의 파일을 공유하며 서로의 `<design_spec>` 블록을 덮어쓴다. 프로젝트 A에
 *   Spring 명세를 주입한 뒤 프로젝트 B가 FastAPI 명세를 주입하면 A가 조용히
 *   오염된다. 프로젝트별 사본은 편의가 아니라 설계상 필수다.
 *   "전역 설치"가 뜻하는 것은 이 CLI 실행 파일 자체를 전역에 두는 것뿐이다
 *   (`npm install -g web-sdlc-harness`로 `npx` 없이 커맨드를 바로 쓸 수 있게 함).
 *   실제 스캐폴딩 산출물은 그 커맨드를 실행한 프로젝트에만 놓인다.
 *
 * 왜 쓰기 전에 전수 조사하는가:
 *   주 사용 사례는 빈 폴더 신규 설치가 아니라, 이미 `.claude/`나 `.codex/`와
 *   `.gitignore`가 있는 기존 프로젝트에 얹는 **병합**이다. 복사 도중 실패하면
 *   반쯤 덮어쓴 상태가 남으므로, 한 건이라도 충돌하면 아무것도 쓰지 않고 멈춘다.
 *
 * 사용법 (npm 미게시 상태이므로 `github:` 스펙으로 저장소에서 직접 받는다.
 * 패키지명만 주면 레지스트리를 조회해 404로 실패한다):
 *   npx github:nyj001012/web-sdlc-harness                    # init (기본) — Claude Code + Codex 둘 다 설치
 *   npx github:nyj001012/web-sdlc-harness --claude            # Claude Code 전용 설치
 *   npx github:nyj001012/web-sdlc-harness --codex             # Codex 전용 설치
 *   npx github:nyj001012/web-sdlc-harness update              # 코어만 최신화, 사용자 자산 보존
 *   npx github:nyj001012/web-sdlc-harness --dry-run           # 쓰지 않고 계획만 출력
 *   npm install -g github:nyj001012/web-sdlc-harness          # CLI 자체를 전역 설치 (이후 web-sdlc-harness 커맨드로 사용)
 *   node bin/cli.mjs --preflight                              # 배포 전 오염 검사 (publish 게이트)
 */

import {
  readdirSync, statSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');

/**
 * 표면(surface) 정의. `claude`는 Claude Code, `codex`는 Codex CLI를 가리키며,
 * 값은 프로젝트 루트 기준 디렉터리 이름이다.
 */
const SURFACE_DIRNAME = { claude: '.claude', codex: '.codex' };
const ALL_SURFACES = ['claude', 'codex'];

/**
 * 각 표면 아래로 복사할 하위 트리. `_workspace/`는 런타임 산출물이라 제외한다.
 *
 * `tools`는 예외적으로 항상 `.claude/tools`(원본 하나)에서 읽는다 — design.md
 * 주입기는 두 표면 모두 동일한 스크립트이므로, 원본을 두 벌 관리해 드리프트를
 * 만들 이유가 없다. 설치 결과물은 그래도 각 표면 하위에 자기완결적으로 놓인다
 * (`target/.codex/tools/inject-design.mjs`처럼 표면마다 사본이 생긴다).
 */
const COPY_DIRS = ['agents', 'skills', 'tools'];

/** 위 COPY_DIRS 중 원본을 다른 표면에서 가져오는 예외 매핑. 나머지는 자기 표면에서 읽는다. */
const SOURCE_SURFACE_OVERRIDE = { tools: 'claude' };

/**
 * 대상에 빈 디렉터리로 확보할 경로. 표면과 무관하게 항상 `.claude/` 밑에 둔다
 * (위 파일 상단 설명 참고 — 워크스페이스는 하나다).
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

const WANT_CLAUDE_ONLY = has('--claude');
const WANT_CODEX_ONLY = has('--codex');
if (WANT_CLAUDE_ONLY && WANT_CODEX_ONLY) {
  console.error('[harness] \u2717 --claude와 --codex는 동시에 줄 수 없다. 둘 다 설치하려면 옵션을 생략하라(기본값).');
  process.exit(1);
}
/** 이번 실행에서 다룰 표면 목록. 옵션이 없으면 둘 다 — "전역 설치"가 기본값으로 두 도구 모두를 지원한다는 요청에 대응한다. */
const SURFACES = WANT_CODEX_ONLY ? ['codex'] : WANT_CLAUDE_ONLY ? ['claude'] : ALL_SURFACES;

const positional = argv.filter((a) => !a.startsWith('-'));
const targetValue = valueOf('--target');
const COMMAND = positional.filter((a) => a !== targetValue)[0] ?? 'init';

const toPosix = (p) => p.split('\\').join('/');

/**
 * 표면·코어 디렉터리 이름을 프로젝트 루트 기준 상대 경로로 바꾼다.
 * 대부분은 `<표면 디렉터리>/<name>`이지만, Codex의 `skills`만 `.agents/skills`로
 * 나간다(파일 상단 "예외" 설명 참고). 이 함수 하나로 그 예외를 흡수해서,
 * 나머지 코드는 표면 디렉터리를 직접 조립하지 않고 전부 이 함수를 거친다.
 */
function surfacePath(surface, name) {
  if (surface === 'codex' && name === 'skills') return join('.agents', 'skills');
  return join(SURFACE_DIRNAME[surface], name);
}


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

/** 한 표면의 패키지 소스 트리를 검증하고 {name, surface, src, files} 목록을 낸다. */
function readSources(surface) {
  const sources = COPY_DIRS.map((name) => {
    const srcSurface = SOURCE_SURFACE_OVERRIDE[name] ?? surface;
    return { name, surface, src: join(PKG_ROOT, surfacePath(srcSurface, name)) };
  });
  const missing = sources.filter((s) => !existsSync(s.src));
  if (missing.length) {
    fail(`패키지가 손상됐다. 없는 경로: ${missing.map((s) => toPosix(relative(PKG_ROOT, s.src))).join(', ')}`);
  }
  return sources.map((s) => ({ ...s, files: walk(s.src) }));
}

/** 대상에 어떤 표면이든 하네스 코어가 있는지 — update 진입 가능 여부 판단용. */
const isInstalledAnywhere = () =>
  ALL_SURFACES.some((surface) => COPY_DIRS.some((d) => existsSync(join(TARGET_ROOT, surfacePath(surface, d)))));

/** 대상 `<surface>/agents/`에 주입 블록이 남아 있는 파일 목록. update 후 재주입 안내에 쓴다. */
function injectedAgents(surface) {
  const dir = join(TARGET_ROOT, surfacePath(surface, 'agents'));
  if (!existsSync(dir)) return [];
  return walk(dir).filter((f) => readFileSync(join(dir, f), 'utf8').includes(INJECT_BEGIN));
}

// ─────────────────────────────────────────────────────────────
// .gitignore 병합
// ─────────────────────────────────────────────────────────────
/**
 * 런타임 3경로를 대상 `.gitignore`에 중복 없이 append한다.
 * 기존 파일을 덮어쓰지 않는다 — 대상 프로젝트의 무시 규칙은 그 프로젝트 것이고,
 * 스택별 규칙(빌드 산출물·의존성 디렉터리)은 하네스가 관여할 영역이 아니다.
 * 워크스페이스가 표면과 무관하게 `.claude/_workspace/` 하나이므로, 이 목록도
 * 선택된 표면과 무관하게 항상 같다.
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
  const bySurface = SURFACES.map((surface) => ({ surface, sources: readSources(surface) }));

  // 충돌 전수 조사를 쓰기 전에 끝낸다. 부분 설치를 만들지 않기 위함이다.
  const conflicts = [];
  let planned = 0;
  for (const { surface, sources } of bySurface) {
    for (const { name, files } of sources) {
      for (const f of files) {
        planned += 1;
        if (existsSync(join(TARGET_ROOT, surfacePath(surface, name), f))) {
          conflicts.push(toPosix(join(surfacePath(surface, name), f)));
        }
      }
    }
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
  log(`표면: ${SURFACES.join(', ')}`);
  log(`init — 파일 ${planned}건${conflicts.length ? ` (덮어쓰기 ${conflicts.length}건)` : ''}${DRY_RUN ? ' \u2014 dry-run' : ''}`);

  if (!DRY_RUN) {
    for (const { surface, sources } of bySurface) {
      for (const { name, src } of sources) {
        cpSync(src, join(TARGET_ROOT, surfacePath(surface, name)), { recursive: true, force: true });
      }
    }
    for (const parts of ENSURE_DIRS) mkdirSync(join(TARGET_ROOT, '.claude', ...parts), { recursive: true });
  }
  for (const { surface, sources } of bySurface) {
    for (const { name, files } of sources) console.log(`  - ${toPosix(surfacePath(surface, name))}/ (${files.length}건)`);
  }
  for (const parts of ENSURE_DIRS) console.log(`  - .claude/${parts.join('/')}/ (빈 디렉터리)`);
  reportGitignore(mergeGitignore());

  console.log('');
  log('\u2713 설치 완료.');
  if (SURFACES.includes('claude')) {
    log('  Claude Code를 열고 하고 싶은 작업을 요청하면 run_web_sdlc가 라우팅한다.');
  }
  if (SURFACES.includes('codex')) {
    log('  Codex CLI에서 하고 싶은 작업을 요청하면 run_web_sdlc가 라우팅한다.');
  }
  log('  예: "센서 관제 대시보드를 만들어줘", "로그인 API만 구현해줘"');
  log('  기술 스택은 Phase 1에서 system-architect가 확정한다 \u2014 design.md를 직접 쓸 필요는 없다.');
}

// ─────────────────────────────────────────────────────────────
// update : 코어만 최신화
// ─────────────────────────────────────────────────────────────
/**
 * 선택된 표면들의 코어 트리(agents·skills·tools)를 최신 버전으로 교체한다.
 *
 * 보존 규칙:
 *   - `_workspace/`는 애초에 배포물에 없다. `design.md`와 계약은 손댈 위험 자체가 없다.
 *   - `.claude/settings*.json`·`.codex/config.toml` 등 배포 범위 밖 설정 파일도 그대로 남는다.
 *   - 대상에만 있고 패키지에 없는 파일(사용자가 추가한 자체 스킬·에이전트)은
 *     지우지 않는다. 삭제는 복구가 안 되므로 보고만 하고 판단은 사람에게 남긴다.
 */
function update() {
  if (!isInstalledAnywhere()) {
    fail(`대상에 하네스가 없다: ${TARGET_ROOT}\n           \u2192 먼저 \`npx github:nyj001012/web-sdlc-harness\` 로 설치하라.`);
  }

  const bySurface = SURFACES.map((surface) => ({ surface, sources: readSources(surface), injected: injectedAgents(surface) }));

  // 패키지에 없는데 대상에는 있는 파일 = 사용자 자산 또는 하네스에서 제거된 고아.
  const orphans = [];
  for (const { surface, sources } of bySurface) {
    for (const { name, files } of sources) {
      const destDir = join(TARGET_ROOT, surfacePath(surface, name));
      if (!existsSync(destDir)) continue;
      const known = new Set(files.map(toPosix));
      for (const f of walk(destDir)) {
        if (!known.has(toPosix(f))) orphans.push(toPosix(join(surfacePath(surface, name), f)));
      }
    }
  }

  const replaced = bySurface.reduce((n, s) => n + s.sources.reduce((m, src) => m + src.files.length, 0), 0);
  log(`대상: ${TARGET_ROOT}`);
  log(`표면: ${SURFACES.join(', ')}`);
  log(`update \u2014 코어 ${replaced}건 교체${DRY_RUN ? ' \u2014 dry-run' : ''}`);

  if (!DRY_RUN) {
    for (const { surface, sources } of bySurface) {
      for (const { name, src } of sources) {
        cpSync(src, join(TARGET_ROOT, surfacePath(surface, name)), { recursive: true, force: true });
      }
    }
    for (const parts of ENSURE_DIRS) mkdirSync(join(TARGET_ROOT, '.claude', ...parts), { recursive: true });
  }
  for (const { surface, sources } of bySurface) {
    for (const { name, files } of sources) console.log(`  - ${toPosix(surfacePath(surface, name))}/ (${files.length}건 교체)`);
  }
  console.log('  - .claude/_workspace/ : 손대지 않았다 (design.md·계약은 사용자 자산)');
  console.log('  - .claude/settings*.json, .codex/config.toml 등 : 손대지 않았다 (복사 범위 밖)');
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
  const injectedTotal = bySurface.reduce((n, s) => n + s.injected.length, 0);
  if (injectedTotal) {
    log(`\u26a0 교체 전 agents/ ${injectedTotal}건에 주입 블록이 있었다. 교체로 사라졌으므로 재주입이 필요하다:`);
    for (const { surface } of bySurface) {
      log(`    node ${SURFACE_DIRNAME[surface]}/tools/inject-design.mjs`);
    }
  }
  log('  Claude Code·Codex가 세션 시작 시점의 에이전트 정의를 잡고 있으면 갱신이 반영되지 않는다. 세션을 재시작하라.');
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
 * 두 표면(`.claude/agents`·`.codex/agents`) 모두를 검사한다.
 */
function preflight() {
  const problems = [];

  for (const surface of ALL_SURFACES) {
    const agentsDir = join(PKG_ROOT, SURFACE_DIRNAME[surface], 'agents');
    if (!existsSync(agentsDir)) {
      problems.push(`에이전트 정의 디렉터리가 없다: ${toPosix(relative(PKG_ROOT, agentsDir))}`);
      continue;
    }
    const dirty = walk(agentsDir).filter((f) => readFileSync(join(agentsDir, f), 'utf8').includes(INJECT_BEGIN));
    if (dirty.length) {
      problems.push(
        `${SURFACE_DIRNAME[surface]}/agents에 주입 블록이 남아 있다 (${dirty.length}건): ${dirty.map(toPosix).join(', ')}\n` +
        `           \u2192 \`node ${SURFACE_DIRNAME[surface]}/tools/inject-design.mjs --clear\` 를 먼저 실행하라.`,
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
  log('\u2713 preflight 통과 \u2014 두 표면 모두 주입 블록 0건, 런타임 경로 0건, 의존성 0건, 라이선스 일치, shebang LF');
}

// ─────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────
const HELP = `
web-sdlc-harness \u2014 Claude Code · Codex 겸용 애자일 SDLC 하네스 스캐폴더

  npx github:nyj001012/web-sdlc-harness [명령] [옵션]

  npm 레지스트리에 미게시 상태다. 패키지명만 주면 404로 실패하므로 \`github:\` 스펙을 쓴다.
  npm install -g github:nyj001012/web-sdlc-harness 로 CLI 자체를 전역 설치하면 npx 없이 \`web-sdlc-harness\` 커맨드를 바로 쓸 수 있다.
  (전역 설치되는 것은 이 실행 파일뿐이다. 에이전트·스킬 정의는 명령을 실행한 프로젝트에만 놓인다 — 「왜 전역 설치가 아니라 프로젝트별 복사인가」 참고.)

명령:
  init       신규 설치 (기본). 대상에 같은 파일이 있으면 아무것도 쓰지 않고 멈춘다
  update     코어(agents·skills·tools)만 최신화. _workspace와 설정 파일은 손대지 않는다

옵션:
  --claude         Claude Code 표면(.claude/)만 설치/최신화한다
  --codex          Codex 표면(.codex/)만 설치/최신화한다
  (옵션 없음)      기본값. 두 표면 모두 설치/최신화한다
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
