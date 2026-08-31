/**
 * inject-scenario.test.mjs — 시나리오 주입기 회귀 테스트
 *
 * 실행: node --test tools/
 *
 * `inject-design.test.mjs`와 같은 전략: 스크립트를 임시 디렉터리의
 * `.claude/tools/`(또는 `.codex/tools/`)로 복사해 자식 프로세스로 실행하고
 * 종료 코드와 파일 바이트만 관찰한다. 실제 `.claude/agents/*.md`는 건드리지 않는다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'inject-scenario.mjs');

const BEGIN = '<!-- SCENARIO_SPEC:BEGIN -->';
const END = '<!-- SCENARIO_SPEC:END -->';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRLF = CR + LF;

/** 주입 대상 계약. 이 집합 자체가 고정 대상이다. */
const TARGETS = ['system-architect', 'issue-pm', 'e2e-tester'];

const GOOD_SCENARIO = [
  'Feature: 비눗방울 시뮬레이터 물리 엔진 상호작용',
  '',
  '  Scenario: 사용자가 비눗방울을 클릭하여 터뜨림',
  '    Given 사용자가 비눗방울 시뮬레이터 화면에 접속해 있다',
  '    When 화면에 떠다니는 "빨간색 비눗방울"을 클릭한다',
  '    Then 비눗방울이 터지는 파티클 애니메이션이 0.5초간 재생된다',
  '    And "pop.mp3" 사운드가 출력된다',
  '',
].join(LF);

/** Scenario·Given/When/Then이 없는, Feature 선언만 있는 파일. */
const BAD_SCENARIO = ['Feature: 미완성 시나리오', ''].join(LF);

const agentSource = (name) =>
  ['---', `name: ${name}`, 'description: 픽스처', 'tools: Read', '---', '', `# ${name}`, '', '본문 한 줄.', ''].join(LF);

const withEol = (text, eol) => (eol === CRLF ? text.split(LF).join(CRLF) : text);

/**
 * 임시 픽스처 저장소를 만든다.
 * @param scenario null이면 scenario.feature를 만들지 않는다 (NOT READY 경로 검증용)
 * @param eol      LF 또는 CRLF
 * @param omit     생성하지 않을 대상 에이전트 이름 (missing 처리 검증용)
 */
function fixture(t, { scenario = GOOD_SCENARIO, eol = LF, omit = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'inject-scenario-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const claude = join(root, '.claude');
  mkdirSync(join(claude, 'tools'), { recursive: true });
  mkdirSync(join(claude, 'agents'), { recursive: true });
  copyFileSync(SCRIPT, join(claude, 'tools', 'inject-scenario.mjs'));

  for (const name of TARGETS) {
    if (omit.includes(name)) continue;
    writeFileSync(join(claude, 'agents', `${name}.md`), withEol(agentSource(name), eol));
  }
  const scenarioPath = join(claude, '_workspace', '00_scenario', 'scenario.feature');
  if (scenario !== null) {
    mkdirSync(dirname(scenarioPath), { recursive: true });
    writeFileSync(scenarioPath, withEol(scenario, eol));
  }

  const fx = {
    root,
    script: join(claude, 'tools', 'inject-scenario.mjs'),
    agentPath: (name) => join(claude, 'agents', `${name}.md`),
    read: (name) => readFileSync(fx.agentPath(name), 'utf8'),
    setScenario: (text) => writeFileSync(scenarioPath, withEol(text, eol)),
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

// ── 줄바꿈 보존 ──────────────────────────────────────────

test('CRLF 파일에 주입해도 원본 줄바꿈이 유지되고 본문이 보존된다', (t) => {
  const fx = fixture(t, { eol: CRLF });
  const before = fx.read('issue-pm');
  assert.equal(run(fx).status, 0);

  const after = fx.read('issue-pm');
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

// ── 주입 동작 ─────────────────────────────────────────────────

test('같은 시나리오로 두 번 주입하면 두 번째는 unchanged이며 파일을 쓰지 않는다', (t) => {
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

test('business-analyst는 주입 대상이 아니다 (자기 산출물을 스스로 주입받지 않는다)', (t) => {
  const fx = fixture(t);
  const r = runJson(fx, ['--dry-run']);
  assert.equal(
    r.data.results.some((x) => x.agent === 'business-analyst'),
    false,
  );
});

test('시나리오가 바뀌면 블록이 같은 자리에서 교체되고 중복 생성되지 않는다', (t) => {
  const fx = fixture(t);
  assert.equal(run(fx).status, 0);
  const first = runJson(fx, ['--dry-run']).data.fingerprint;

  fx.setScenario(GOOD_SCENARIO.replace('빨간색 비눗방울', '파란색 비눗방울'));
  const second = runJson(fx);
  assert.equal(second.status, 0);
  assert.notEqual(second.data.fingerprint, first, '시나리오가 바뀌면 지문도 바뀌어야 한다');

  const after = fx.read('issue-pm');
  assert.equal(after.split(BEGIN).length - 1, 1, 'BEGIN 마커가 정확히 1개여야 한다');
  assert.equal(after.split(END).length - 1, 1, 'END 마커가 정확히 1개여야 한다');
  assert.ok(after.includes('파란색 비눗방울'), '갱신된 시나리오가 반영되어야 한다');
});

test('scenario.feature가 없으면 [NOT READY] 블록을 주입하지만 exit 0이다 (차단 사유가 아니다)', (t) => {
  const fx = fixture(t, { scenario: null });
  const r = runJson(fx);
  assert.equal(r.status, 0, 'design.md와 달리 시나리오 부재는 실패가 아니다');
  assert.equal(r.data.scenarioReady, false);
  assert.equal(r.data.fingerprint, 'none');
  assert.ok(fx.read('issue-pm').includes('NOT READY'), 'NOT READY 표시가 있어야 한다');
  assert.ok(fx.read('issue-pm').includes('차단 사유가 아니다'), '차단 사유가 아님을 명시해야 한다');
});

// ── 모드별 계약 ───────────────────────────────────────────────

test('--dry-run은 exit 0이며 파일을 쓰지 않는다', (t) => {
  const fx = fixture(t);
  const before = fx.snapshot();
  assert.equal(run(fx, ['--dry-run']).status, 0);
  assert.equal(fx.snapshot(), before, 'dry-run은 파일을 바꾸지 않는다');
});

test('--sections는 Feature·Scenario·Given/When/Then이 모두 있으면 exit 0, 미충족이면 exit 1이다', (t) => {
  assert.equal(run(fixture(t), ['--sections']).status, 0);
  assert.equal(run(fixture(t, { scenario: BAD_SCENARIO }), ['--sections']).status, 1);
  assert.equal(run(fixture(t, { scenario: null }), ['--sections']).status, 1);
});

test('--sections는 파일을 쓰지 않는다', (t) => {
  const fx = fixture(t);
  const before = fx.snapshot();
  run(fx, ['--sections']);
  assert.equal(fx.snapshot(), before);
});

test('--check는 주입 직후 exit 0, 시나리오가 바뀌어 드리프트가 생기면 exit 1이다', (t) => {
  const fx = fixture(t);
  assert.equal(run(fx).status, 0);
  assert.equal(run(fx, ['--check']).status, 0, '주입 직후에는 최신이어야 한다');

  fx.setScenario(GOOD_SCENARIO.replace('빨간색 비눗방울', '드리프트 유발'));
  assert.equal(run(fx, ['--check']).status, 1, '드리프트는 exit 1이어야 한다');
});

test('--check는 파일을 쓰지 않는다', (t) => {
  const fx = fixture(t);
  const before = fx.snapshot();
  run(fx, ['--check']);
  assert.equal(fx.snapshot(), before);
});

test('--json은 fingerprint·scenarioReady·대상 3개 상태를 반환한다', (t) => {
  const r = runJson(fixture(t), ['--dry-run']);
  assert.equal(r.status, 0);
  assert.equal(r.data.scenarioReady, true);
  assert.match(r.data.fingerprint, /^[0-9a-f]{6,}$/);
  assert.deepEqual(
    r.data.results.map((x) => x.agent).sort(),
    [...TARGETS].sort(),
    '주입 대상 집합이 계약과 같아야 한다',
  );
});

test('대상 에이전트 정의가 없으면 missing으로 보고하고 exit 1이며 예외로 죽지 않는다', (t) => {
  const fx = fixture(t, { omit: ['issue-pm'] });
  const r = runJson(fx);
  assert.equal(r.status, 1);
  assert.equal(r.data.results.find((x) => x.agent === 'issue-pm').status, 'missing');
  assert.equal(r.stderr.includes('Error'), false, `예외 스택이 없어야 한다: ${r.stderr}`);
  assert.ok(fx.read('system-architect').includes(BEGIN), '나머지 대상은 정상 주입되어야 한다');
});

// ── 두 호스트(.claude/.codex) 공존 (Codex 지원) ────────────────────

const agentSourceToml = (name) =>
  [`name = "${name}"`, 'description = "픽스처"', '', "developer_instructions = '''", `# ${name}`, '', '본문 한 줄.', "'''", ''].join(
    LF,
  );

const EXT_BY_HOST = { claude: '.md', codex: '.toml' };
const SOURCE_BY_HOST = { claude: agentSource, codex: agentSourceToml };

function twoHostFixture(t, { claudeScenario = GOOD_SCENARIO, codexScenario = GOOD_SCENARIO } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'inject-scenario-test-codex-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const hostDirs = { claude: join(root, '.claude'), codex: join(root, '.codex') };
  const scenarioOf = { claude: claudeScenario, codex: codexScenario };
  const scenarioPathOf = {};
  for (const [host, dir] of Object.entries(hostDirs)) {
    mkdirSync(join(dir, 'tools'), { recursive: true });
    mkdirSync(join(dir, 'agents'), { recursive: true });
    copyFileSync(SCRIPT, join(dir, 'tools', 'inject-scenario.mjs'));
    for (const name of TARGETS) {
      writeFileSync(join(dir, 'agents', `${name}${EXT_BY_HOST[host]}`), SOURCE_BY_HOST[host](name));
    }
    const scenarioPath = join(dir, '_workspace', '00_scenario', 'scenario.feature');
    scenarioPathOf[host] = scenarioPath;
    if (scenarioOf[host] !== null) {
      mkdirSync(dirname(scenarioPath), { recursive: true });
      writeFileSync(scenarioPath, scenarioOf[host]);
    }
  }

  return {
    scriptOf: (host) => join(hostDirs[host], 'tools', 'inject-scenario.mjs'),
    read: (host, name) => readFileSync(join(hostDirs[host], 'agents', `${name}${EXT_BY_HOST[host]}`), 'utf8'),
    setScenario: (host, text) => writeFileSync(scenarioPathOf[host], text),
  };
}

test('.codex 호스트는 자기 agents/에 주입하며 scenario.feature도 자기 호스트(.codex/_workspace)에서 읽는다', (t) => {
  const fx = twoHostFixture(t);

  const codexResult = spawnSync(process.execPath, [fx.scriptOf('codex'), '--json'], { encoding: 'utf8' });
  assert.equal(codexResult.status, 0);
  const codexData = JSON.parse(codexResult.stdout);
  assert.equal(codexData.scenarioReady, true, '.codex도 .codex/_workspace의 scenario.feature를 찾아야 한다');
  const codexAfter = fx.read('codex', 'issue-pm');
  assert.ok(codexAfter.includes(BEGIN), '.codex/agents에 주입되어야 한다');
  assert.equal(
    codexAfter.split("'''").length - 1,
    2,
    "TOML 리터럴 문자열 구분자(''')가 정확히 2개(열기/닫기)여야 한다 — 주입 블록이 문자열을 조기 종료시키면 안 된다",
  );

  const claudeResult = spawnSync(process.execPath, [fx.scriptOf('claude'), '--json'], { encoding: 'utf8' });
  const claudeData = JSON.parse(claudeResult.stdout);
  assert.equal(claudeData.fingerprint, codexData.fingerprint, '같은 내용의 scenario.feature를 각자 넣었으므로 지문은 같다');
});

test('한쪽 호스트의 scenario.feature만 바뀌면 그 호스트만 드리프트를 감지하고 다른 호스트는 영향받지 않는다', (t) => {
  const fx = twoHostFixture(t);
  assert.equal(spawnSync(process.execPath, [fx.scriptOf('claude')]).status, 0);
  assert.equal(spawnSync(process.execPath, [fx.scriptOf('codex')]).status, 0);

  fx.setScenario('claude', GOOD_SCENARIO.replace('빨간색 비눗방울', '.claude만 변경'));

  assert.equal(spawnSync(process.execPath, [fx.scriptOf('claude'), '--check']).status, 1, '.claude는 드리프트를 감지해야 한다');
  assert.equal(spawnSync(process.execPath, [fx.scriptOf('codex'), '--check']).status, 0, '.codex는 자기 워크스페이스가 안 바뀌었으므로 영향 없어야 한다');
});
