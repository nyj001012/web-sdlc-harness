import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, check } from './human-gate.mjs';

for (const name of ['.claude', '.codex']) test(`${name}: explicit approval, EOF and changed inputs`, () => {
  const root = mkdtempSync(join(tmpdir(), 'human-gate-'));
  const host = join(root, name);
  const artifact = join(host, '_workspace/00_scenario/scenario.feature');
  mkdirSync(join(host, '_workspace/00_scenario'), { recursive: true });
  writeFileSync(artifact, 'Feature: Example\nScenario: Success\nGiven x\nWhen y\nThen z\n');
  const run = (input, mode = '--approve') => spawnSync(process.execPath,
    [fileURLToPath(new URL('./human-gate.mjs', import.meta.url)), 'requirements', '--host', host, mode], { input, encoding: 'utf8' });
  try {
    assert.throws(() => check(host, 'requirements'));
    assert.equal(run('').status, 1);
    assert.equal(run('yes\n').status, 1);
    assert.equal(run('APPROVE\n').status, 0);
    assert.equal(run('', '--check').status, 0);
    assert.equal(check(host, 'requirements').fingerprint, snapshot(host, 'requirements').fingerprint);
    writeFileSync(artifact, 'Feature: Revised');
    assert.throws(() => check(host, 'requirements'), /stale/);
    assert.equal(run('APPROVE\n').status, 0);
    writeFileSync(join(root, 'spec.md'), 'Changed requirement');
    assert.throws(() => check(host, 'requirements'), /stale/);
    assert.equal(run('APPROVE\n').status, 0);
    assert.equal(run('NO\n').status, 1);
    assert.throws(() => check(host, 'requirements'), /approval/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
