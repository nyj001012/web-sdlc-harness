/**
 * inject-design.test.mjs — 주입기 회귀 테스트
 *
 * 실행: node --test .claude/tools/
 *
 * 왜 이 방식인가:
 *   inject-design.mjs는 경로를 `import.meta.url` 기준으로 해석한다
 *   (HERE → CLAUDE_DIR → REPO_ROOT). 그래서 스크립트를 임시 디렉터리의
 *   `.claude/tools/`로 복사해 실행하면 그 임시 저장소 안에서만 동작한다.
 *   덕분에 실제 `.claude/agents/*.md`를 한 바이트도 건드리지 않는다.
 *   스크립트는 import 시점에 main()을 실행하는 CLI이므로 함수 단위로
 *   불러오지 않고 자식 프로세스로 돌려 종료 코드와 파일 바이트만 관찰한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'inject-design.mjs');

const BEGIN = '<!-- DESIGN_SPEC:BEGIN -->';
const END = '<!-- DESIGN_SPEC:END -->';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRLF = CR + LF;

/** 주입 대상 계약. 이 집합 자체가 고정 대상이다 (run_web_sdlc Rule 5). */
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

const GOOD_DESIGN = [
  '# 시스템 설계',
  '',
  '## 기술 스택',
  '- 런타임: 픽스처 전용 가상 스택',
  '',
  '## 디렉터리 구조 및 소유권',
  '- src/: 픽스처 소유',
  '',
  '## 표준 명령어',
  '- build: echo build',
  '',
  '## 계약 산출 형식',
  '- 형식: 픽스처 계약',
  '',
  '## 아키텍처 규약',
  '- 규약: 픽스처 규약',
  '',
].join(LF);

/** 헤딩 레벨·번호·「」·동의 표현·영문이 뒤섞인 변형. 5개 섹션을 모두 담고 있다. */
const WOBBLY_DESIGN = [
  '# 설계',
  '',
  '### 1. 「테크 스택」',
  '- 내용 있음',
  '',
  '#### 폴더 구조',
  '- 내용 있음',
  '',
  '## 2) 표준 커맨드',
  '- 내용 있음',
  '',
  '## Contract Output Format',
  '- content here',
  '',
  '## architecture principles',
  '- content here',
  '',
].join(LF);

const BAD_DESIGN = ['# 설계', '', '## 무관한 섹션', '- 내용 있음', ''].join(LF);

const agentSource = (name) =>
  ['---', `name: ${name}`, 'description: 픽스처', 'tools: Read', '---', '', `# ${name}`, '', '본문 한 줄.', ''].join(LF);

const withEol = (text, eol) => (eol === CRLF ? text.split(LF).join(CRLF) : text);

/**
 * 임시 픽스처 저장소를 만든다.
 * @param design null이면 design.md를 만들지 않는다 (NOT READY 경로 검증용)
 * @param eol    LF 또는 CRLF
 * @param omit   생성하지 않을 대상 에이전트 이름 (missing 처리 검증용)
 */
function fixture(t, { design = GOOD_DESIGN, eol = LF, omit = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'inject-design-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const claude = join(root, '.claude');
  mkdirSync(join(claude, 'tools'), { recursive: true });
  mkdirSync(join(claude, 'agents'), { recursive: true });
  copyFileSync(SCRIPT, join(claude, 'tools', 'inject-design.mjs'));

  for (const name of TARGETS) {
    if (omit.includes(name)) continue;
    writeFileSync(join(claude, 'agents', `${name}.md`), withEol(agentSource(name), eol));
  }
  const designPath = join(claude, '_workspace', '01_architecture', 'design.md');
  if (design !== null) {
    mkdirSync(dirname(designPath), { recursive: true });
    writeFileSync(designPath, withEol(design, eol));
  }

  const fx = {
    root,
    script: join(claude, 'tools', 'inject-design.mjs'),
    agentPath: (name) => join(claude, 'agents', `${name}.md`),
    read: (name) => readFileSync(fx.agentPath(name), 'utf8'),
    setDesign: (text) => writeFileSync(designPath, withEol(text, eol)),
    snapshot: () =>
      TARGETS.filter((n) => !omit.includes(n))
        .map((n) => `${n}:${readFileSync(fx.agentPath(n), 'utf8')}`)
        .join(' '),
  };
  return fx;
}

const run = (fx, args = []) => spawnSync(process.execPath, [fx.script, ...args], { encoding: 'utf8' });
const runJson = (fx, args = []) => {
  const r = run(fx, [...args, '--json']);
  return { ...r, data: JSON.parse(r.stdout) };
};

// ── 줄바꿈 보존 (#22) ──────────────────────────────────────────

test('CRLF 파일에 주입해도 원본 줄바꿈이 유지되고 본문이 보존된다', (t) => {
  const fx = fixture(t, { eol: CRLF });
  const before = fx.read('code-reviewer');
  assert.equal(run(fx).status, 0);

  const after = fx.read('code-reviewer');
  assert.ok(after.includes(BEGIN) && after.includes(END), '주입 블록이 있어야 한다');
  assert.equal(after.split(LF).length - 1, after.split(CRLF).length - 1, 'CR 없는 LF가 하나도 없어야 한다');
  for (const line of before.split(CRLF).filter((l) => l !== '')) {
    assert.ok(after.includes(line), `원본 행이 보존되어야 한다: ${line}`);
  }
});

test('주입 후 --clear 하면 원본과 바이트 단위로 동일하다 (CRLF)', (t) => {
  const fx = fixture(t, { eol: CRLF });
  const before = fx.snapshot();
  assert.equal(run(fx).status, 0);
  assert.notEqual(fx.snapshot(), before, '주입으로 내용이 바뀌어야 한다');
  assert.equal(run(fx, ['--clear']).status, 0);
  assert.equal(fx.snapshot(), before, '--clear가 원본을 바이트 단위로 복원해야 한다');
});

test('LF 파일은 LF로 유지된다', (t) => {
  const fx = fixture(t, { eol: LF });
  assert.equal(run(fx).status, 0);
  assert.equal(fx.read('code-reviewer').includes(CR), false, 'CR이 섞이면 안 된다');
});

test('지문은 줄바꿈 방식에 흔들리지 않는다', (t) => {
  const lf = runJson(fixture(t, { eol: LF }), ['--dry-run']).data.fingerprint;
  const crlf = runJson(fixture(t, { eol: CRLF }), ['--dry-run']).data.fingerprint;
  assert.equal(lf, crlf);
  assert.notEqual(lf, 'none');
});

// ── 주입 동작 ─────────────────────────────────────────────────

test('같은 설계로 두 번 주입하면 두 번째는 unchanged이며 파일을 쓰지 않는다', (t) => {
  const fx = fixture(t);
  assert.equal(run(fx).status, 0);
  const afterFirst = fx.snapshot();

  const second = runJson(fx);
  assert.equal(second.status, 0);
  assert.deepEqual(
    [...new Set(second.data.results.map((r) => r.status))],
    ['unchanged'],
    '두 번째 실행은 전부 unchanged여야 한다',
  );
  assert.equal(fx.snapshot(), afterFirst, '멱등 실행은 바이트를 바꾸지 않는다');
});

test('주입 블록은 프론트매터 직후에 들어가고 프론트매터는 훼손되지 않는다', (t) => {
  const fx = fixture(t);
  assert.equal(run(fx).status, 0);

  const after = fx.read('code-reviewer');
  const closer = LF + '---' + LF;
  const fmEnd = after.indexOf(closer, 4) + closer.length;
  assert.ok(fmEnd > closer.length, '프론트매터 종료 지점을 찾아야 한다');
  assert.equal(after.startsWith('---' + LF), true, '프론트매터 시작이 유지되어야 한다');
  assert.ok(after.includes('name: code-reviewer'), '프론트매터 필드가 유지되어야 한다');
  assert.equal(after.slice(fmEnd).trimStart().startsWith(BEGIN), true, '블록이 프론트매터 직후여야 한다');
});

test('설계가 바뀌면 블록이 같은 자리에서 교체되고 중복 생성되지 않는다', (t) => {
  const fx = fixture(t);
  assert.equal(run(fx).status, 0);
  const first = runJson(fx, ['--dry-run']).data.fingerprint;

  fx.setDesign(GOOD_DESIGN.replace('픽스처 전용 가상 스택', '변경된 스택'));
  const second = runJson(fx);
  assert.equal(second.status, 0);
  assert.notEqual(second.data.fingerprint, first, '설계가 바뀌면 지문도 바뀌어야 한다');

  const after = fx.read('code-reviewer');
  assert.equal(after.split(BEGIN).length - 1, 1, 'BEGIN 마커가 정확히 1개여야 한다');
  assert.equal(after.split(END).length - 1, 1, 'END 마커가 정확히 1개여야 한다');
  assert.ok(after.includes('변경된 스택'), '갱신된 설계가 반영되어야 한다');
});

test('design.md가 없으면 [NOT READY] 블록을 주입한다', (t) => {
  const fx = fixture(t, { design: null });
  const r = runJson(fx);
  assert.equal(r.status, 0);
  assert.equal(r.data.designReady, false);
  assert.equal(r.data.fingerprint, 'none');
  assert.equal(r.data.results.length, TARGETS.length);
  assert.ok(fx.read('code-reviewer').includes('NOT READY'), 'NOT READY 표시가 있어야 한다');
});

// ── 모드별 계약 ───────────────────────────────────────────────

test('--dry-run은 exit 0이며 파일을 쓰지 않는다', (t) => {
  const fx = fixture(t);
  const before = fx.snapshot();
  assert.equal(run(fx, ['--dry-run']).status, 0);
  assert.equal(fx.snapshot(), before, 'dry-run은 파일을 바꾸지 않는다');
});

test('--sections는 필수 5개 섹션이 충족되면 exit 0, 미충족이면 exit 1이다', (t) => {
  assert.equal(run(fixture(t), ['--sections']).status, 0);
  assert.equal(run(fixture(t, { design: BAD_DESIGN }), ['--sections']).status, 1);
  assert.equal(run(fixture(t, { design: null }), ['--sections']).status, 1);
});

test('--sections는 헤딩 레벨·번호·「」·동의 표현·영문 표기를 흡수한다', (t) => {
  const fx = fixture(t, { design: WOBBLY_DESIGN });
  const r = runJson(fx, ['--sections']);
  assert.equal(r.status, 0, `표기 변형을 인식해야 한다: ${JSON.stringify(r.data.sections)}`);
  assert.deepEqual(
    r.data.sections.filter((s) => !s.ok),
    [],
  );
});

test('--sections는 파일을 쓰지 않는다', (t) => {
  const fx = fixture(t);
  const before = fx.snapshot();
  run(fx, ['--sections']);
  assert.equal(fx.snapshot(), before);
});

test('--check는 주입 직후 exit 0, 설계가 바뀌어 드리프트가 생기면 exit 1이다', (t) => {
  const fx = fixture(t);
  assert.equal(run(fx).status, 0);
  assert.equal(run(fx, ['--check']).status, 0, '주입 직후에는 최신이어야 한다');

  fx.setDesign(GOOD_DESIGN.replace('픽스처 전용 가상 스택', '드리프트 유발'));
  assert.equal(run(fx, ['--check']).status, 1, '드리프트는 exit 1이어야 한다');
});

test('--check는 파일을 쓰지 않는다', (t) => {
  const fx = fixture(t);
  const before = fx.snapshot();
  run(fx, ['--check']);
  assert.equal(fx.snapshot(), before);
});

test('--json은 fingerprint·designReady·대상 11개 상태를 반환한다', (t) => {
  const r = runJson(fixture(t), ['--dry-run']);
  assert.equal(r.status, 0);
  assert.equal(r.data.designReady, true);
  assert.match(r.data.fingerprint, /^[0-9a-f]{6,}$/);
  assert.deepEqual(
    r.data.results.map((x) => x.agent).sort(),
    [...TARGETS].sort(),
    '주입 대상 집합이 계약과 같아야 한다',
  );
});

test('대상 에이전트 정의가 없으면 missing으로 보고하고 exit 1이며 예외로 죽지 않는다', (t) => {
  const fx = fixture(t, { omit: ['tech-writer'] });
  const r = runJson(fx);
  assert.equal(r.status, 1);
  assert.equal(r.data.results.find((x) => x.agent === 'tech-writer').status, 'missing');
  assert.equal(r.stderr.includes('Error'), false, `예외 스택이 없어야 한다: ${r.stderr}`);
  assert.ok(fx.read('code-reviewer').includes(BEGIN), '나머지 대상은 정상 주입되어야 한다');
});
