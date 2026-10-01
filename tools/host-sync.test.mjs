/**
 * host-sync.test.mjs — 호스트별 도구 사본이 tools/ 원본과 같은지 고정한다.
 *
 * 실행: node --test tools/host-sync.test.mjs
 *
 * tools/가 원본이고 .claude/tools와 .codex/tools는 배포 사본이다. 원본만 고치면
 * 한쪽 호스트에서 승인 가드·주입 로직이 빠진 채 배포되므로, 사본이 하나라도 있는
 * 파일은 두 호스트 모두에 있고 바이트가 같아야 한다. 사본이 없는 파일(원본 전용
 * 테스트)과 호스트 전용 훅은 검사 대상이 아니다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOSTS = ['.claude', '.codex'];
const hostPath = (host, name) => join(ROOT, host, 'tools', name);

const mirrored = readdirSync(join(ROOT, 'tools')).filter((name) =>
  HOSTS.some((host) => existsSync(hostPath(host, name))),
);

test('호스트에 배포되는 도구가 하나 이상 있다', () => {
  assert.ok(mirrored.length > 0, 'tools/에서 호스트 사본을 가진 파일을 찾지 못했다');
});

for (const name of mirrored) {
  for (const host of HOSTS) {
    test(`${host}/tools/${name}은 tools/${name}과 같다`, () => {
      const copy = hostPath(host, name);
      assert.ok(existsSync(copy), `${host}/tools/${name}이 없다 (다른 호스트에는 있다)`);
      assert.equal(
        readFileSync(copy, 'utf8'),
        readFileSync(join(ROOT, 'tools', name), 'utf8'),
        `${host}/tools/${name}이 tools/${name}과 다르다 — 원본을 복사해 동기화한다`,
      );
    });
  }
}
