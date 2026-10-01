import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, check, record } from './human-gate.mjs';

for (const name of ['.claude', '.codex']) test(`${name}: record, check and stale detection`, () => {
  const root = mkdtempSync(join(tmpdir(), 'human-gate-'));
  const host = join(root, name);
  const artifact = join(host, '_workspace/04_test_cases/test-cases.md');
  mkdirSync(join(host, '_workspace/04_test_cases'), { recursive: true });
  mkdirSync(join(host, '_workspace/03_contracts'), { recursive: true });
  mkdirSync(join(host, '_workspace/00_scenario'), { recursive: true });
  writeFileSync(artifact, '# TC-1\nGiven x\nWhen y\nThen z\n');
  writeFileSync(join(host, '_workspace/03_contracts/api.contract.ts'), 'export interface A {}');
  const run = (mode) => spawnSync(process.execPath,
    [fileURLToPath(new URL('./human-gate.mjs', import.meta.url)), 'tests', '--host', host, mode], { encoding: 'utf8' });
  try {
    assert.throws(() => check(host), /missing/);
    assert.equal(run('--check').status, 1);
    assert.equal(run('--record').status, 0);
    assert.equal(run('--check').status, 0);
    assert.equal(check(host).fingerprint, snapshot(host).fingerprint);
    // 명세·계약·요구사항이 바뀌면 stale
    writeFileSync(artifact, '# TC-1 revised');
    assert.throws(() => check(host), /stale/);
    record(host);
    writeFileSync(join(host, '_workspace/03_contracts/api.contract.ts'), 'export interface B {}');
    assert.throws(() => check(host), /stale/);
    record(host);
    writeFileSync(join(root, 'requirements.md'), 'Changed requirement');
    assert.throws(() => check(host), /stale/);
    record(host);
    writeFileSync(join(host, '_workspace/00_scenario/scenario.feature'), 'Feature: X');
    assert.throws(() => check(host), /stale/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects unknown gate and ambiguous mode', () => {
  const run = (...args) => spawnSync(process.execPath,
    [fileURLToPath(new URL('./human-gate.mjs', import.meta.url)), ...args, '--host', '.claude'], { encoding: 'utf8' });
  assert.equal(run('requirements', '--check').status, 1);
  assert.equal(run('tests').status, 1);
  assert.equal(run('tests', '--check', '--record').status, 1);
});

for (const tool of ['./human-gate.mjs', '../.codex/tools/human-gate.mjs']) {
  for (const name of ['.claude', '.codex']) test(`${tool} ${name}: pending draft blocks check and record`, () => {
    const root = mkdtempSync(join(tmpdir(), 'human-gate-draft-'));
    const host = join(root, name);
    const directory = join(host, '_workspace/04_test_cases');
    const artifact = join(directory, 'test-cases.md');
    const draft = join(directory, 'test-cases.draft.md');
    const receipt = join(host, '_workspace/human-gates/tests.json');
    mkdirSync(directory, { recursive: true });
    const run = (mode) => spawnSync(process.execPath,
      [fileURLToPath(new URL(tool, import.meta.url)), 'tests', '--host', host, mode], { encoding: 'utf8' });
    try {
      const approved = '# TC-1\nApproved\n';
      writeFileSync(artifact, approved);
      // Legacy approvals without a draft remain valid.
      assert.equal(run('--record').status, 0);
      assert.equal(run('--check').status, 0);
      const originalReceipt = readFileSync(receipt, 'utf8');
      writeFileSync(draft, approved);
      utimesSync(draft, new Date('2030-01-01'), new Date('2030-01-01'));
      assert.equal(run('--check').status, 0, 'identical newer draft must pass');
      writeFileSync(draft, '# TC-2\nPending user approval\n');
      utimesSync(draft, new Date('2000-01-01'), new Date('2000-01-01'));
      for (const mode of ['--check', '--record']) {
        const result = run(mode);
        assert.equal(result.status, 1, `${mode} must reject an older but different draft`);
        assert.match(result.stderr, /WAITING_USER:.*draft/);
        assert.equal(readFileSync(receipt, 'utf8'), originalReceipt, 'rejection must not alter approval');
      }
      writeFileSync(draft, '');
      assert.equal(run('--check').status, 1, 'empty draft must block');
      writeFileSync(draft, approved.replaceAll('\n', '\r\n'));
      assert.equal(run('--check').status, 1, 'comparison must be byte exact');
      const revised = '# TC-2\nApproved after review\n';
      writeFileSync(draft, revised);
      writeFileSync(artifact, revised);
      assert.equal(run('--check').status, 1, 'matching revised files still need a new approval receipt');
      assert.equal(run('--record').status, 0);
      assert.equal(run('--check').status, 0);
    } finally {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      assert.ok(root.includes('human-gate-draft-'));
      rmSync(root, { recursive: true, force: true });
    }
  });
}
