#!/usr/bin/env node
// User approval receipts contain hashes and paths only, never conversation history.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const hash = (body) => createHash('sha256').update(body).digest('hex');
export function snapshot(host, gate) {
  if (!['requirements', 'tests'].includes(gate)) throw new Error('Unknown gate');
  const artifact = gate === 'requirements'
    ? '_workspace/00_scenario/scenario.feature' : '_workspace/04_test_cases/test-cases.md';
  const body = readFileSync(join(host, artifact), 'utf8');
  if (!body.trim()) throw new Error('Empty artifact');
  const sources = {};
  for (const name of ['spec.md', 'requirements.md']) {
    const path = resolve(host, '..', name);
    sources[name] = existsSync(path) ? hash(readFileSync(path)) : null;
  }
  if (gate === 'tests') {
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
  }
  return { gate, artifact, fingerprint: hash(body), sources };
}
export function check(host, gate) {
  const current = snapshot(host, gate);
  const receipt = JSON.parse(readFileSync(join(host, '_workspace', 'human-gates', `${gate}.json`), 'utf8'));
  if (receipt.status !== 'APPROVED' || JSON.stringify(receipt.snapshot) !== JSON.stringify(current)) {
    throw new Error('WAITING_USER: approval missing or stale');
  }
  return current;
}
async function main() {
  const args = process.argv.slice(2);
  const gate = args[0];
  const index = args.indexOf('--host');
  const inferred = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const host = index >= 0 ? resolve(args[index + 1] ?? '') : inferred;
  if (!['.claude', '.codex'].includes(basename(host))) throw new Error('Supply --host .claude or --host .codex');
  if (args.includes('--check') === args.includes('--approve')) throw new Error('Choose --check or --approve');
  if (args.includes('--check')) {
    const current = check(host, gate);
    console.log(`APPROVED ${gate} ${current.fingerprint}`);
    return;
  }
  const current = snapshot(host, gate);
  const receipt = join(host, '_workspace', 'human-gates', `${gate}.json`);
  mkdirSync(dirname(receipt), { recursive: true });
  writeFileSync(receipt, JSON.stringify({ status: 'WAITING_USER', snapshot: current }) + '\n');
  console.log(readFileSync(join(host, current.artifact), 'utf8'));
  console.log(`\n${gate}: ${current.fingerprint}\n완성본을 확인하고 승인하려면 APPROVE를 입력하세요. 다른 입력/EOF는 진행을 차단합니다.`);
  const input = createInterface({ input: process.stdin });
  let answer;
  for await (const line of input) { answer = line.trim(); break; }
  input.close();
  if (answer !== 'APPROVE') throw new Error('WAITING_USER: explicit approval required');
  if (JSON.stringify(snapshot(host, gate)) !== JSON.stringify(current)) throw new Error('Artifact or sources changed during review');
  writeFileSync(receipt, JSON.stringify({ status: 'APPROVED', snapshot: current, approvedAt: new Date().toISOString() }) + '\n');
  console.log(`APPROVED ${gate} ${current.fingerprint}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
