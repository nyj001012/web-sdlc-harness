import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, check, isApprovalUtterance } from './human-gate.mjs';

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

test('by-user approval: utterance, fingerprint binding, show', () => {
  const root = mkdtempSync(join(tmpdir(), 'human-gate-'));
  const host = join(root, '.claude');
  const artifact = join(host, '_workspace/00_scenario/scenario.feature');
  mkdirSync(join(host, '_workspace/00_scenario'), { recursive: true });
  writeFileSync(artifact, 'Feature: Example\nScenario: Success\nGiven x\nWhen y\nThen z\n');
  const run = (...extra) => spawnSync(process.execPath,
    [fileURLToPath(new URL('./human-gate.mjs', import.meta.url)), 'requirements', '--host', host, ...extra], { input: '', encoding: 'utf8' });
  try {
    for (const ok of ['승인', '승인합니다.', 'approve', 'LGTM', '네']) assert.ok(isApprovalUtterance(ok), ok);
    for (const no of ['', '음...', '수정해줘', '승인 근데 이거 바꿔줘', '좋아 보이는데 이건 어때?']) assert.ok(!isApprovalUtterance(no), no);
    const shown = run('--show');
    assert.equal(shown.status, 0);
    const fp = snapshot(host, 'requirements').fingerprint;
    assert.ok(shown.stdout.includes(fp));
    assert.throws(() => check(host, 'requirements'));
    assert.equal(run('--approve', '--by-user', '수정해줘', '--fingerprint', fp).status, 1);
    assert.equal(run('--approve', '--by-user', '승인', '--fingerprint', 'stale').status, 1);
    assert.equal(run('--approve', '--by-user', '승인').status, 1);
    assert.throws(() => check(host, 'requirements'));
    assert.equal(run('--approve', '--by-user', '승인', '--fingerprint', fp).status, 0);
    assert.equal(check(host, 'requirements').fingerprint, fp);
    writeFileSync(artifact, 'Feature: Revised');
    assert.throws(() => check(host, 'requirements'), /stale/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
