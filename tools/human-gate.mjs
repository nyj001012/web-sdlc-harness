#!/usr/bin/env node
// Gate 2(QA 테스트 명세) 승인 영수증. 지문과 경로만 저장하고 대화 내용은 저장하지 않는다.
//   --record : 사용자의 명시적 승인 뒤에 QA 세션이 실행한다. 현재 지문으로 영수증을 기록한다.
//   --check  : 오케스트레이터가 실행한다. 영수증이 없거나 명세·요구사항·설계·계약이 바뀌었으면 exit 1.
// 승인 의사 자체는 사용자와 직접 대화한 QA 세션이 판단한다. 이 도구는 기록과 stale 감지만 맡는다.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = 'tests';
const ARTIFACT = '_workspace/04_test_cases/test-cases.md';
const hash = (body) => createHash('sha256').update(body).digest('hex');

export function snapshot(host) {
  const body = readFileSync(join(host, ARTIFACT), 'utf8');
  if (!body.trim()) throw new Error('Empty artifact');
  const sources = {};
  for (const name of ['spec.md', 'requirements.md']) {
    const path = resolve(host, '..', name);
    sources[name] = existsSync(path) ? hash(readFileSync(path)) : null;
  }
  for (const name of ['_workspace/00_scenario/scenario.feature', '_workspace/01_architecture/design.md']) {
    const path = join(host, name);
    sources[name] = existsSync(path) ? hash(readFileSync(path)) : null;
  }
  const contracts = '_workspace/03_contracts';
  sources[contracts] = existsSync(join(host, contracts));
  const walk = (dir) => {
    for (const name of readdirSync(join(host, dir)).sort()) {
      const relative = `${dir}/${name}`;
      if (statSync(join(host, relative)).isDirectory()) walk(relative);
      else sources[relative] = hash(readFileSync(join(host, relative)));
    }
  };
  if (sources[contracts]) walk(contracts);
  return { gate: GATE, artifact: ARTIFACT, fingerprint: hash(body), sources };
}

const receiptPath = (host) => join(host, '_workspace', 'human-gates', `${GATE}.json`);

export function record(host) {
  const current = snapshot(host);
  mkdirSync(dirname(receiptPath(host)), { recursive: true });
  writeFileSync(receiptPath(host), JSON.stringify({ status: 'APPROVED', snapshot: current, approvedAt: new Date().toISOString() }) + '\n');
  return current;
}

export function check(host) {
  const current = snapshot(host);
  if (!existsSync(receiptPath(host))) throw new Error('WAITING_USER: approval missing');
  const receipt = JSON.parse(readFileSync(receiptPath(host), 'utf8'));
  if (receipt.status !== 'APPROVED' || JSON.stringify(receipt.snapshot) !== JSON.stringify(current)) {
    throw new Error('WAITING_USER: approval stale (test cases, requirements, design or contracts changed)');
  }
  return current;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] !== GATE) throw new Error(`Unknown gate (only "${GATE}" is supported)`);
  const index = args.indexOf('--host');
  const inferred = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const host = index >= 0 ? resolve(args[index + 1] ?? '') : inferred;
  if (!['.claude', '.codex'].includes(basename(host))) throw new Error('Supply --host .claude or --host .codex');
  if (args.includes('--check') === args.includes('--record')) throw new Error('Choose --check or --record');
  const current = args.includes('--record') ? record(host) : check(host);
  console.log(`APPROVED ${GATE} ${current.fingerprint}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
