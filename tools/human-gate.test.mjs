import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
