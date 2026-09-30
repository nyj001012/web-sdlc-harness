import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, check } from './human-gate.mjs';

for (const name of ['.claude', '.codex']) for (const gate of ['requirements', 'tests']) test(`${name}/${gate}: explicit approval, EOF and changed inputs`, () => {
  const root = mkdtempSync(join(tmpdir(), 'human-gate-'));
  const host = join(root, name);
  const artifact = join(host, gate === 'requirements' ? '_workspace/00_scenario/scenario.feature' : '_workspace/04_test_cases/test-cases.md');
  mkdirSync(join(host, gate === 'requirements' ? '_workspace/00_scenario' : '_workspace/04_test_cases'), { recursive: true });
  writeFileSync(artifact, 'Feature: Example\nScenario: Success\nGiven x\nWhen y\nThen z\n');
  const run = (input, mode = '--approve') => spawnSync(process.execPath,
    [fileURLToPath(new URL('./human-gate.mjs', import.meta.url)), gate, '--host', host, mode], { input, encoding: 'utf8' });
  try {
    assert.throws(() => check(host, gate));
    assert.equal(run('').status, 1);
    assert.equal(run('yes\n').status, 1);
    assert.equal(run('APPROVE\n').status, 0);
    assert.equal(run('', '--check').status, 0);
    assert.equal(check(host, gate).fingerprint, snapshot(host, gate).fingerprint);
    writeFileSync(artifact, 'Feature: Revised');
    assert.throws(() => check(host, gate), /stale/);
    assert.equal(run('APPROVE\n').status, 0);
    writeFileSync(join(root, 'spec.md'), 'Changed requirement');
    assert.throws(() => check(host, gate), /stale/);
    assert.equal(run('APPROVE\n').status, 0);
    assert.equal(run('NO\n').status, 1);
    assert.throws(() => check(host, gate), /approval/);
    if (gate === 'tests') {
      const contract = join(host, '_workspace/03_contracts/api.md');
      const design = join(host, '_workspace/01_architecture/design.md');
      const scenario = join(host, '_workspace/00_scenario/scenario.feature');
      mkdirSync(join(host, '_workspace/03_contracts'), { recursive: true });
      mkdirSync(join(host, '_workspace/01_architecture'), { recursive: true });
      mkdirSync(join(host, '_workspace/00_scenario'), { recursive: true });
      for (const file of [contract, design, scenario]) {
        assert.equal(run('APPROVE\n').status, 0);
        writeFileSync(file, 'Updated source');
        assert.throws(() => check(host, gate), /stale/);
      }
      assert.equal(run('APPROVE\n').status, 0);
      rmSync(contract);
      assert.throws(() => check(host, gate), /stale/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('review changes invalidate approval before receipt is granted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'human-gate-race-'));
  const host = join(root, '.codex');
  const artifact = join(host, '_workspace/04_test_cases/test-cases.md');
  mkdirSync(join(host, '_workspace/04_test_cases'), { recursive: true });
  writeFileSync(artifact, 'TC-01: initial case');
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./human-gate.mjs', import.meta.url)),
      'tests', '--host', host, '--approve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '', changed = false;
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (!changed && output.includes('APPROVE')) {
        changed = true;
        writeFileSync(artifact, 'TC-01: changed during review');
        child.stdin.end('APPROVE\n');
      }
    });
    child.stderr.on('data', (chunk) => { error += chunk; });
    const code = await new Promise((accept, reject) => {
      child.on('error', reject);
      child.on('close', accept);
    });
    assert.equal(code, 1);
    assert.match(error, /changed during review/);
    assert.throws(() => check(host, 'tests'), /approval/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
