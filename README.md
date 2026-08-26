# web-sdlc-harness

Claude Code와 Codex CLI 양쪽에서 쓸 수 있는 하네스 (풀스택 웹 개발)

12개의 에이전트 페르소나와 13개의 스킬로 구성된, **애자일 SDLC 전체를 자동으로 굴리는 하네스**다. 요구사항 분석 ➔ 아키텍처 설계 ➔ 티켓팅 ➔ TDD 병렬 개발 ➔ E2E 검증 ➔ PR 생성 ➔ 문서화까지를 페이즈별 에이전트 팀으로 나눠 수행한다.

패키지는 두 벌의 소스 트리를 담고 있다 — `.claude/`(Claude Code용, Phase 3 Track A에서 에이전트 팀 모드·P2P 통신 사용)와 `.codex/`(Codex CLI용, Codex의 서브에이전트가 오케스트레이터에게만 보고하는 허브-스포크 구조라 P2P 대신 순차 위임 사용). 라우팅·페이즈 골격은 같지만 실행 방식이 다르므로 설치 시 호스트를 고른다(「설치」 참고).

## 설치

대상 프로젝트 루트에서 실행한다. 배포 단위는 실행 파일이 아니라 파일 트리(`.claude/`·`.codex/`)이므로, 설치란 에이전트·스킬·툴 정의를 프로젝트에 놓는 일이다.

```bash
npx github:nyj001012/web-sdlc-harness              # 신규 설치 — 옵션 없으면 두 호스트(.claude/·.codex/) 모두
npx github:nyj001012/web-sdlc-harness --claude      # Claude Code 호스트만 설치
npx github:nyj001012/web-sdlc-harness --codex       # Codex 호스트만 설치
npx github:nyj001012/web-sdlc-harness update        # 코어만 최신화 (사용자 자산 보존, 옵션으로 호스트 지정 가능)
npx github:nyj001012/web-sdlc-harness --dry-run     # 쓰지 않고 계획만 확인
npx github:nyj001012/web-sdlc-harness --help        # 전체 옵션
```

> 아직 npm 레지스트리에 게시되지 않았다. `npx web-sdlc-harness`처럼 패키지명만 주면 레지스트리를 조회해 404로 실패하므로, `github:` 스펙을 붙여 저장소에서 직접 받는다. 이 방식은 로컬에 `git`이 필요하다.

**CLI 자체를 전역 설치할 수도 있다:**

```bash
npm install -g github:nyj001012/web-sdlc-harness
web-sdlc-harness --target ./my-project   # 이후 npx 없이 바로 실행
```

전역 설치되는 것은 이 실행 파일 하나뿐이다. 에이전트·스킬 정의(`design.md` 주입 대상)는 여전히 명령을 실행한 프로젝트에만 놓인다 — 정의 파일 자체를 홈 디렉터리 등 전역 한 벌로 두면 여러 프로젝트가 서로의 `<design_spec>` 주입 결과를 덮어쓰게 되기 때문이다 (`bin/cli.mjs` 상단 설명 참고).

- **기존 프로젝트에 얹는 것이 기본 사용 사례다.** 대상에 이미 있는 파일과 충돌하면 **아무것도 쓰지 않고** 목록을 보여주며 멈춘다. 전부 덮어쓰려면 `--force`.
- `.gitignore`에 런타임 3경로를 중복 없이 덧붙인다. 기존 내용은 덮어쓰지 않는다. 이 경로는 설치한 호스트 밑(`.claude/_workspace/` 또는 `.codex/_workspace/`)이며, 호스트마다 독립이다 (「산출물 구조」 참고).
- `update`는 선택한 호스트의 코어(`agents/`·`skills/`·`tools/`)만 교체한다. `_workspace/`의 `design.md`·계약과 `.claude/settings*.json`·`.codex/config.toml` 등은 손대지 않으며, 대상에만 있는 파일(자체 스킬 등)은 지우지 않고 보고만 한다.
- ⚠️ `update`는 `agents/`를 교체하므로 주입 블록이 사라진다. 최신화 후 해당 호스트의 `node <호스트>/tools/inject-design.mjs`로 재주입한다.

### Codex 지원 범위

Codex 커스텀 에이전트는 Claude Code처럼 Markdown+YAML 프론트매터가 아니라 **TOML**이다(`.codex/agents/<name>.toml`). `name`·`description`·`developer_instructions`(전체 지침을 담는 문자열)가 필수이고, `model_reasoning_effort`(`ultra`/`max`/`xhigh`/`high`/`medium`/`low`)와 `sandbox_mode`(`read-only`/`workspace-write`)를 선택으로 갖는다 — Claude의 `tools:` 같은 도구 화이트리스트 필드는 없다. 이 하네스는 Claude의 모델 등급을 그대로 대응시킨다: `opus`→`high`, `sonnet`→`medium`, `haiku`→`low`, 그리고 실제로 쓰지 않는 `code-reviewer`만 `read-only`이고 나머지는 `workspace-write`다. 스킬(SKILL.md)은 `.codex/` 밑이 아니라 저장소 루트 기준 **`.agents/skills/`**에서 Codex가 자동 탐색한다(공식 문서 확인) — `.codex/skills/`가 아니다.

라우팅·페이즈 골격은 `.claude/`와 같지만, Codex의 서브에이전트가 오케스트레이터에게만 결과를 보고하는 허브-스포크 구조라 P2P 팀 모드에 대응하는 기능이 없다. 그래서 Claude Code 호스트가 Phase 3 Track A에서 쓰는 QA↔Developer↔Reviewer↔DB 팀 핑퐁을, Codex 호스트는 **서브 에이전트 순차 위임**으로 대체한다 — 결과는 같지만 데이터 레인의 조기 언블록(스키마 확정 즉시 BE 착수) 같은 P2P 전용 최적화는 포기한다. 정확한 차이는 `.agents/skills/run_web_sdlc/SKILL.md`의 Rule 1·Phase 3에 문서화돼 있다. 두 호스트를 함께 설치해도 `design.md`는 호스트마다 독립이다(`.claude/_workspace/`·`.codex/_workspace/`) — 한 프로젝트 안에서 Claude로 설계하고 Codex로 이어받는 흐름은 지원하지 않는다.

### 전제: Node.js가 필요하다

**이 하네스는 Node.js를 요구한다.** 주입기(`inject-design.mjs`)가 Node 스크립트이고, `run_web_sdlc`는 Phase 0에서 이것을 실행해 설계 명세를 주입한다. 주입이 실패하면 하위 에이전트 전원이 스택 명세 없이 작업하게 되므로 선택 사항이 아니다.

Claude Code·Codex CLI를 **네이티브 인스톨러로 설치한 환경에는 Node가 없을 수 있다.** 그 경우 Node를 별도로 설치해야 한다 (`engines` 하한은 16.7 — `fs.cpSync` 도입 버전).

`run_web_sdlc`는 **Phase 0에서 런타임을 선행 검사하고, Node가 없으면 그 자리에서 멈춘다.** 라우트 판별 직후·주입 이전에 확인하므로, 주입 실패를 "`design.md`가 불완전하다"로 오진해 명세 없이 개발에 들어가는 경로가 차단된다. 하네스 자체를 손보는 하네스 메타 라우트도 예외가 아니다 — 주입은 생략하지만 회귀 테스트와 배포 오염 검사가 Node를 쓴다.

`npx`로 받을 수 없는 환경이라면 수동 복사가 폴백이다.

```bash
git clone --depth 1 https://github.com/nyj001012/web-sdlc-harness.git /tmp/harness
cp -r /tmp/harness/.claude/{agents,skills,tools} <대상>/.claude/   # Claude Code 호스트
cp -r /tmp/harness/.codex/{agents,tools} <대상>/.codex/            # Codex 호스트 (에이전트·주입기)
cp -r /tmp/harness/.agents/skills <대상>/.agents/                  # Codex 스킬 (자동 탐색 경로가 다르다)
```

이 경우 `.gitignore` 병합과 충돌 검사는 직접 해야 한다. 「산출물 구조」의 미추적 세 경로를 참고하라.

> 저장소 루트의 `package.json`은 **하네스 배포용**이며 대상 프로젝트의 기술 스택과 무관하다. 의존성은 0개이고, 대상 프로젝트로 복사되지도 않는다. 스택은 여전히 `design.md`만이 정의한다.

## 사용법

1. 위 설치를 마친다.
2. Claude Code 또는 Codex CLI에서 하고 싶은 작업을 요청한다. (예: "센서 관제 대시보드를 만들어줘", "로그인 API만 구현해줘")
3. `run_web_sdlc`가 요청 성격에 맞는 페이즈만 골라 실행하며, 에이전트 스폰 전에 `inject-design.mjs`를 돌려 설계 명세를 주입한다.

> ⚠️ 파이프라인 도중 `design.md`가 갱신되면 주입 스크립트가 에이전트 정의 파일을 다시 쓴다. 이때 Claude Code·Codex가 세션 시작 시점의 에이전트 정의를 잡고 있으면 갱신이 반영되지 않는다. 오케스트레이터는 에이전트가 반환한 `DESIGN_FINGERPRINT`로 이를 감지하며, 불일치 시 세션 재시작을 요청한다.

기존 코드베이스가 있는 프로젝트라면 Phase 0에서 현행 스택을 조사해 `design.md`에 기록한 뒤 개발에 들어간다. 신규 프로젝트라면 Phase 1에서 스택을 새로 확정한다. 어느 쪽도 불가능하면 파이프라인은 추측하지 않고 멈춰서 사용자에게 스택 결정을 묻는다.

## 핵심 원리: 기술 스택을 전제하지 않는다

이 하네스는 특정 프레임워크에 묶여 있지 않다. 스택은 **`system-architect`가 요구사항에서 역산해 확정**하고, 하위 에이전트 전원이 그 결정을 읽고 따른다.

```
사용자 요구사항
      │
      ▼
┌─────────────────────────────────────────────┐
│ system-architect                            │
│   → <호스트>/_workspace/01_architecture/       │
│         design.md  (SSOT, 호스트마다 독립)      │
│                                             │
│   ① 기술 스택 (선정 근거 + 탈락 대안)          │
│   ② 디렉터리 구조 및 역할별 쓰기 소유권         │
│   ③ 표준 명령어 (린트/타입검사/테스트/빌드)     │
│   ④ 계약 산출 형식                            │
│   ⑤ 아키텍처 규약                             │
│   ⑥ 도메인 모델 경계 + 배포 제약               │
└─────────────────────────────────────────────┘
      │
      ▼  node .claude/tools/inject-design.mjs
┌─────────────────────────────────────────────┐
│ 정적 주입기 (하네스 단, fs.readFileSync)      │
│   design.md 전문 ➔ 각 에이전트 정의 파일의    │
│   프론트매터 직후 = 시스템 프롬프트 최상단     │
└─────────────────────────────────────────────┘
      │  (스폰 시점에 이미 주입되어 있다)
      ▼
 FE 개발 · BE 개발 · QA · 리뷰어 · E2E · DevOps · 문서화
```

덕분에 같은 하네스로 Next.js 프로젝트도, Spring 프로젝트도, FastAPI 프로젝트도 진행할 수 있다. 에이전트는 자기가 아는 스택이 아니라 `design.md`가 정한 스택의 관용대로 구현하며, **스택 정보가 없으면 추측하지 않고 질의를 띄우고 멈춘다.**

## 설계 명세는 읽지 않고 주입한다

하위 에이전트는 `design.md`를 **도구로 읽지 않는다.** 오케스트레이터가 에이전트를 스폰하기 전에 주입 스크립트를 실행하면, 설계 전문이 각 에이전트 정의 파일(`.claude/agents/<name>.md`)의 프론트매터 직후에 `<design_spec>` 블록으로 보간된다. Claude Code에서 이 본문은 그대로 서브 에이전트의 시스템 프롬프트가 된다.

| | 런타임 `Read` 방식 | 정적 주입 방식 |
|---|---|---|
| 설계 전문의 위치 | 대화 중간 (도구 결과) | 시스템 프롬프트 = 불변 접두사 |
| 스폰당 추가 왕복 | 1회 이상 | 0회 |
| 스폰 간 캐시 재사용 | 안 됨 | 동일 접두사이므로 히트 |
| 조회 누락·부분 읽기 | 가능 (비결정적) | 불가능 (항상 전문) |

```bash
node .claude/tools/inject-design.mjs            # 주입/갱신 (멱등)
node .claude/tools/inject-design.mjs --sections # 필수 5개 섹션 완결성만 검사, 미충족 시 exit 1 (읽기 전용)
node .claude/tools/inject-design.mjs --check    # 최신성 검증, 드리프트 시 exit 1 (CI용)
node .claude/tools/inject-design.mjs --json     # fingerprint 및 에이전트별 상태
node .claude/tools/inject-design.mjs --dry-run  # 파일을 쓰지 않고 결과만 확인
node .claude/tools/inject-design.mjs --clear    # 주입 블록 제거, 하네스 원본 복원
```

- **재주입 시점:** Phase 0 진입 직후, `system-architect`가 `design.md`를 갱신한 직후, 사용자가 설계를 직접 수정한 직후.
- **드리프트 방지:** 주입 블록은 `design.md`의 SHA-256 앞 12자리를 `fingerprint`로 박아둔다. 각 에이전트는 최종 보고 첫 줄에 `DESIGN_FINGERPRINT`를 반환하고, 오케스트레이터가 현재 지문과 대조한다.
- **주입 제외:** `system-architect`(`design.md`의 생산자이므로 낡은 사본 주입 금지)와 `release-manager`(스택 의존성 없음).
- 주입 블록은 자동 생성 영역이다. `<!-- DESIGN_SPEC:BEGIN -->` ~ `<!-- DESIGN_SPEC:END -->` 구간을 손으로 편집하지 않는다.

## 파이프라인

`run_web_sdlc` 스킬이 마스터 오케스트레이터로서 페이즈를 동적 라우팅한다.

| Phase | 하는 일 | 투입 에이전트 |
|---|---|---|
| **0** | 컨텍스트 분석 · 라우팅 · **난이도 판별** · **설계 명세 주입** · 스택 확보 선행 검사 | (오케스트레이터) |
| **1** | 아키텍처 및 기술 스택 확정 | `system-architect` |
| **2** | 이슈 생성 · 작업 브랜치 파생 · 인터페이스 계약 설계 | `issue-pm`, `tech-leader` |
| **3** | Track A: TDD 병렬 개발 (테스트 선행 → 구현 → 리뷰 핑퐁)<br>Track B: 인프라 · CI/CD | `backend-qa`, `backend-developer`, `db-engineer`, `frontend-qa`, `frontend-developer`, `code-reviewer`, `devops-engineer` |
| **4** | 실행 환경에서 사용자 시나리오 통합 검증 · **에러 로그 트리아지** | `e2e-tester` |
| **5** | 원격 Push · PR/MR 생성 · 위키 문서화 | `release-manager`, `tech-writer` |

라우팅은 **두 축**으로 정해진다.

- **라우트** — 어느 페이즈를 도는가. (전체 구축 / FE 단독 / BE 단독 / 인프라 단독 / 문서 단독 / 하네스 메타)
- **난이도** — 그 페이즈를 얼마나 두껍게 도는가. (Fast / Heavy)

| | Fast | Heavy |
|---|---|---|
| 판정 | 타겟 파일이 확정된 소수(≈3개 이하)이고, 계약·스키마·공개 인터페이스·의존성을 바꾸지 않는다 | 그 밖의 전부 |
| 수행 | Phase 0 ➔ 2(티켓·브랜치) ➔ 3(구현 1건 + 리뷰 1패스) ➔ 5 | Phase 0 ➔ 1 ➔ 2 ➔ 3 ➔ 4 ➔ 5 |
| 생략 | Phase 1, 계약 설계, QA 핑퐁, E2E | 없음 |

- ⚖️ **애매하면 Heavy다.** 오분류 비용이 비대칭이다 — Fast를 Heavy로 잘못 보면 토큰이 낭비되는 것으로 끝나지만, 반대는 QA 없이·E2E 없이 구현물이 나간다.
- **Fast에서도 `code-reviewer`와 설계 명세 주입은 생략하지 않는다.** 읽기 전용 단일 패스는 파이프라인에서 가장 싼 게이트이고, 페이즈를 줄이는 것과 스택 명세 없이 구현하는 것은 다른 문제다.
- **Fast에서 반려가 2회 나오면 Heavy로 승격한다.** 반려가 반복된다는 것은 애초에 국소 변경이 아니었다는 신호다.
- 난이도 판별에 **전용 에이전트를 두지 않는다.** 오케스트레이터가 이미 요청을 컨텍스트에 갖고 있으므로, 판단을 서브 에이전트로 내보내는 것은 스폰 1회를 사서 이미 아는 결론을 되받는 것이다. 타겟 파일을 모를 때만 범용 탐색 서브 에이전트를 haiku로 1건 붙여 경로 탐색을 격리한다.

각 페이즈 종료 시 오케스트레이터가 마이크로 커밋을 남기고, `<호스트>/_workspace/log/orchestrator-log.jsonl`에 감사 로그를 append한다.

## 파이프라인의 구조 형태

오케스트레이터를 중심에 둔 **스타(hub-and-spoke) 위상**이며, 페이즈 골격은 선형이다. 서브 에이전트는 스폰 ➔ 작업 ➔ 최종 보고 ➔ 종료하고, 역할 간 전달은 오케스트레이터가 중계한다.

라우트 6개는 **상호 배타적 선택**이다. 동시에 갈라지는 분기가 아니라 필요한 페이즈의 부분집합을 고르는 스위치다. 난이도는 그 위에 겹치는 **두 번째 스위치**로, 고른 페이즈 집합을 다시 얇게 만든다. 반면 Heavy 전체 구축 라우트 안에서는 팬아웃과 팬인이 각각 두 겹으로 나타난다.

```
Phase 0  라우트 판별 ➔ 난이도 판별 ➔ 런타임 검사 ➔ 설계 주입 ➔ 스택 확보 검사
   │
   ├─ Fast ─➔ Phase 2 (issue-pm) ─➔ Phase 3 (구현 1건 ➔ code-reviewer 1패스) ─➔ Phase 5
   │             └─ 계약·스키마·공개 인터페이스 무변경이 전제. 반려 2회면 Heavy로 승격해 아래로 합류
   │
   ▼ Heavy
Phase 1  system-architect ──➔ design.md (SSOT)
   │
Phase 2  issue-pm (티켓·브랜치)  ·  tech-leader (계약)
   │        └─ 계약의 완결성이 아래 레인 폭을 결정한다
   ▼
Phase 3 ─┬─ Track A (팀 모드 · P2P)
         │     FE 레인:  frontend-qa ➔ frontend-developer ─┐
         │     BE 레인:  backend-qa  ➔ backend-developer  ─┤
         │     DB 레인:  db-engineer  (스키마 ➔ BE 선행)  ─┤
         │                                                 ▼
         │                         code-reviewer   ← 팬인 ① (수렴만 함 · 대기 없음)
         │                              ↑ 반려 순환 (최대 3회)
         │
         └─ Track B (서브 에이전트 · 고립):  devops-engineer
                     │
   ┌─────────────────┘  두 트랙은 간선 없이 오케스트레이터의 커밋에서만 합류
   ▼
Phase 4  e2e-tester    ← 팬인 ② (동기화 지점 · FE·BE·데이터 모두 완료돼야 진입)
   │        └─ 실패 시 area(fe|be|data|infra) 판정 ➔ 해당 역할만 재스폰 (핀포인트)
   │
Phase 5  release-manager  ·  tech-writer
```

- **팬아웃 ①** — Phase 3의 Track A ∥ Track B. Track B(`devops-engineer`)는 서브 에이전트라 Track A와 간선이 없다. 서로를 모른 채 달리고 오케스트레이터의 마이크로 커밋에서 합류한다.
- **팬아웃 ②** — Track A 내부의 FE 레인 ∥ BE 레인 ∥ 데이터 레인. **이 병렬을 가능하게 하는 것은 Phase 2의 계약이다.** 서로의 코드를 기다리지 않고 계약만 보고 착수하므로, 계약이 모호하면 레인은 갈라져도 서로를 기다리게 되어 이름만 병렬이 된다.
  - 단 **데이터 레인 ➔ BE 레인에는 선후가 있다.** 데이터 접근 계층은 스키마가 확정된 뒤에 맞춰야 하므로 `db-engineer`가 스키마 확정을 알린 뒤 BE가 그 부분을 붙인다. FE 레인은 계약만 보고 그대로 병렬로 달린다.
  - 레인을 더 쪼갤 때는 **화면·기능 단위로 같은 타입을 복제**한다(`frontend-developer-1/-2`). 관심사(마크업·스타일·이벤트) 축으로 쪼개면 같은 파일을 여럿이 써서 병합으로 되돌려야 하고, 그러면 결국 직렬화된다 — 병합이 필요한 분할은 경계가 아니다. 복제는 정의 파일이 같아 주입 접두사를 공유하므로 캐시도 유리하다.
- **팬인 ① — 모이기만 하고 기다리지 않는다.** 두 레인이 단일 `code-reviewer`에게 리뷰를 요청하므로 선은 한 점으로 모인다. 그러나 리뷰어는 도착한 레인을 각각 따로 처리한다. FE가 승인을 받는 동안 BE는 두 번째 반려를 받고 되돌아가는 중일 수 있다.
- **팬인 ② — 모여서 기다린다.** Phase 4는 Track A의 모든 레인이 끝나야 진입한다. 한 레인이라도 남아 있으면 시작하지 않는다. 완료를 실제로 요구하는 유일한 지점이다.
- **팬인 ②의 되돌아가는 간선** — E2E가 깨지면 `e2e-tester`가 `area`(`fe`/`be`/`data`/`infra`/`unknown`)와 압축된 근거로 판정을 반환하고, 오케스트레이터가 **해당 역할만** 재스폰한다. 리더 노드가 없어도 핀포인트 라우팅이 성립한다 — 판정 한 필드가 조직도의 역할을 대신한다. 로그 전문은 오케스트레이터 컨텍스트에 싣지 않는다(말미 50줄 상한).

### 왜 스타인가

서로 방해하기 쉬운 세 관심사가 "단발성 서브 에이전트 + 오케스트레이터 통합"이라는 하나의 선택으로 동시에 해결된다.

| 관심사 | 스타 구조가 주는 것 |
|---|---|
| 권한 경계 강제 | 오케스트레이터가 유일한 통합 지점이므로, 한 역할이 거절당한 일을 다른 역할에게 부탁해 우회하는 경로가 없다 |
| 컨텍스트 소실 내구성 | 모든 상태가 허브를 통과하므로 페이즈 인계 파일 하나로 재개된다. 피어 그래프에서는 상태가 오가는 메시지 안에 있어 파일로 고정할 수 없다 |
| 프롬프트 캐시 | 매번 새로 스폰되고 죽는 모델이라 설계 명세를 시스템 프롬프트(불변 접두사)에 주입해 스폰마다 히트시킬 수 있다 |

대가는 중계 비용이다 — 매 전달이 왕복 하나다. 그래서 오가는 빈도가 높은 리뷰 핑퐁 구간만 P2P 예외로 두고, 그 밖은 전부 허브를 통한다.

### 명세와 강제의 구분

위 팬인 구조는 에이전트 정의의 `연결:` 규약과 페이즈 진입 조건으로 **서술**돼 있으며, 이를 검사하는 기계적 게이트는 없다. Phase 4가 양쪽 완료를 기다리는 것도 오케스트레이터가 지키는 규칙이지 자동 차단 장치가 아니다. 자동 검증이 붙어 있는 것은 주입기 계약과 배포 오염 차단, 두 곳뿐이다.

```bash
node --test .claude/tools/inject-design.test.mjs   # 주입기 회귀 테스트 (모드 계약·멱등성·줄바꿈 보존)
node bin/cli.mjs --preflight                      # 배포 오염 검사 (주입 블록·런타임 경로·의존성)
```

배포 게이트가 막는 것은 셋이다.

| 검사 | 막는 사고 |
|---|---|
| 주입 블록 잔존 | **이 저장소의 `design.md` 전문이 남의 프로젝트로 실려 간다.** 주입 결과를 커밋하는 지점이 Phase 1에 있으므로 실제로 발생할 수 있다 |
| 라이선스 선언·실물 불일치 | 라이선스 고지 없이 배포되면 이용자가 합법적으로 쓸 수 없다 |
| shebang EOL | `npm pack`은 index가 아니라 **워킹트리**에서 tarball을 만든다. Windows에서 publish하면 CRLF가 배포되고 `#!/usr/bin/env node\r`가 되어 **Unix에서 `npx`가 실행되지 않는다** |

`prepublishOnly`가 `--clear` ➔ `--preflight` ➔ 회귀 테스트를 차례로 통과시킨 뒤에만 publish를 허용한다. EOL은 `.gitattributes`가 1차 방어선이고, 이 게이트가 최종 방어선이다.

## 에이전트

| 에이전트 | 역할 | 모델 |
|---|---|---|
| `system-architect` | 기술 스택·구조·규약·소유권 확정, 도메인 경계 설계 | opus |
| `issue-pm` | 마이크로 태스크 분할, GitHub/GitLab 이슈 생성, 작업 브랜치 파생 | haiku |
| `tech-leader` | FE/BE/QA가 병렬 개발할 수 있는 인터페이스 계약 설계 | sonnet |
| `frontend-qa` | UI 렌더링·이벤트·폴백에 대한 실패하는(Red) 테스트 선행 작성 | sonnet |
| `frontend-developer` | 계약과 테스트를 만족하는 UI·클라이언트 상태 구현 | sonnet |
| `backend-qa` | API·비즈니스 로직의 블랙박스 테스트 선행 작성 | sonnet |
| `backend-developer` | 계층 분리·트랜잭션·구조화 로깅을 지킨 서버 로직 구현 | sonnet |
| `db-engineer` | 스키마·마이그레이션·인덱스·시드 구현 (데이터 계층 소유자) | sonnet |
| `code-reviewer` | 계약·규약·보안·성능 검수, 승인/반려 게이트키퍼 | sonnet |
| `devops-engineer` | 실행 환경·설치 스크립트·CI/CD·관측성 구축 | sonnet |
| `e2e-tester` | 실제 실행 환경에서 사용자 시나리오 통합 검증 | sonnet |
| `release-manager` | 원격 Push 및 PR/MR 생성 | haiku |
| `tech-writer` | API 명세·아키텍처 개요(ADR)·운영 가이드 문서화 | haiku |

## 스킬

| 스킬 | 용도 |
|---|---|
| `run_web_sdlc` | 마스터 오케스트레이터 (페이즈 라우팅·팀 스폰·커밋) |
| `design_system_architecture` | 기술 스택 선정 및 시스템 설계 |
| `create_agile_issues` | 이슈 생성 및 작업 브랜치 파생 |
| `design_interface_contracts` | 풀스택 인터페이스·데이터 계약 설계 |
| `design_frontend_tdd_cases` | UI TDD 케이스 설계 |
| `design_backend_tdd_cases` | 서버 블랙박스 TDD 케이스 설계 |
| `implement_frontend_ui` | UI·클라이언트 상태 구현 |
| `implement_backend_api` | 서버 API·비즈니스 로직 구현 |
| `perform_code_review` | 코드 리뷰 및 보안·성능 감사 |
| `perform_e2e_testing` | E2E 시나리오 테스트 |
| `setup_infra_cicd` | 인프라·CI/CD·관측성 구축 |
| `create_pr_mr` | Push 및 PR/MR 생성 |
| `write_technical_wiki` | 위키·API 명세 문서화 |

## 산출물 구조

에이전트 간 인수인계는 모두 파일로 이뤄진다.

```
(배포 자산 — 대상 프로젝트로 복사되지 않는다)
├── .gitattributes                 # EOL 고정. *.mjs는 eol=lf (shebang이 CRLF면 Unix 실행 불가)
├── package.json                   # 하네스 배포용. 의존성 0, prepublishOnly 게이트
└── bin/cli.mjs                    # npx 스캐폴더 (init / update / --preflight / --claude / --codex)

(설치되는 두 호스트 — 설치 옵션에 따라 한쪽 또는 둘 다)
.claude/{agents,skills,tools}/     # Claude Code용(Markdown+YAML). Track A에 P2P 팀 모드 사용
.codex/{agents,tools}/             # Codex CLI용. agents는 TOML(`<name>.toml`), 항상 허브-스포크(순차 위임) 사용
.agents/skills/                    # Codex 스킬(SKILL.md). Codex가 이 경로를 자동 탐색한다 — `.codex/skills/`가 아니다

tools/ 안 내용은 두 호스트 모두 동일한 원본 하나에서 복사된다:
├── inject-design.mjs              # design.md ➔ 에이전트 시스템 프롬프트 정적 주입기
└── inject-design.test.mjs         # 주입기 회귀 테스트 (node --test)

<호스트>/_workspace/                 # 설치한 호스트(.claude 또는 .codex) 밑에 독립적으로 생긴다
│
├── (추적) 합의물 — 커밋 대상
│   ├── 01_architecture/design.md  # 기술 스택·규약·소유권 (그 호스트의 SSOT)
│   ├── 03_contracts/              # 인터페이스 계약 (형식은 design.md가 정함)
│   └── 04_infrastructure/         # 설치·배포 스크립트
│
└── (미추적) 런타임 산출물 — .gitignore 대상
    ├── 02_issues/issue_report.md  # 티켓 생성 리포트 (실제 SSOT는 GitHub/GitLab의 이슈)
    ├── handoff/phase-<N>.md       # 페이즈 인계 파일 (Rule 6)
    └── log/orchestrator-log.jsonl # 페이즈 감사 로그
```

`--claude` 단독 설치에서는 `.codex/` 디렉터리가, `--codex` 단독 설치에서는 `.claude/` 디렉터리가 아예 생기지 않는다. 두 호스트를 함께 설치하면 `.claude/_workspace/`와 `.codex/_workspace/`가 각각 따로 생긴다 — `design.md`도 호스트마다 독립이므로, 한 프로젝트에서 Claude로 설계하고 Codex로 이어받는 흐름은 지원하지 않는다. 호스트를 바꿔 같은 설계를 이어 쓰려면 그 호스트에서 Phase 1을 다시 돌리거나 `_workspace/`를 수동으로 복사해야 한다.

미추적 세 경로는 세션마다 새로 생기고 재현 가능한 휘발성 상태다. 스테이징하거나 커밋하지 않는다.

- **페이즈 인계 파일(`handoff/`)** — 오케스트레이터 컨텍스트가 요약되거나 세션이 끊겨도 인계가 끊기지 않게, 페이즈 경계에서 다음 페이즈가 필요한 사실만 40줄 이내로 남긴다. 설계서·계약·소스의 본문을 옮겨 담지 않고 경로만 적는다. 재개 시에는 **가장 높은 번호 하나만** 읽는다.

## 설계 원칙

- **클린 룸 TDD** — QA는 구현 코드를 열람하지 않고 계약만 보고 실패하는 테스트를 먼저 짠다. 개발자는 테스트를 **단 한 줄도 수정할 수 없고** 프로덕션 코드로만 통과시킨다.
- **부분 수정은 `Edit`, `Write`는 신규 생성 전용** — `Write`는 기존 파일에 대해 손실 연산이다(재현되지 않은 부분이 조용히 사라진다). 전체 재작성은 diff를 파일 전체로 부풀려 리뷰 게이트를 무력화하기도 한다. 에이전트 `tools`와 대응 스킬의 `allowed-tools`는 함께 갱신한다 — 한쪽에만 `Edit`가 있으면 스킬이 활성인 동안 도구가 좁혀진다.
- **역할별 쓰기 소유권** — 각 에이전트는 `design.md`의 소유권 표에서 자기에게 배정된 경로만 수정한다. 리뷰어는 경계 위반을 검수 항목으로 확인한다.
- **읽기 전용 게이트키퍼** — `code-reviewer`는 어떤 파일도 직접 고치지 않고, 구체적인 대안 스니펫을 담아 반려한다.
- **객관적 룰북** — 리뷰 기준은 리뷰어의 취향이 아니라 주입된 `<design_spec>`이다. 규약에 없는 지적은 반려가 아닌 "규약 공백" 제안으로 처리한다.
- **설계는 읽지 않고 주입한다** — 하위 에이전트에게 설계 조회를 시키지 않는다. 하네스가 스폰 전에 전문을 시스템 프롬프트에 보간하여 캐시 가능한 불변 접두사로 만든다.
- **3회 재시도 후 `[PASS WITH WARNING]`** — 무한 핑퐁을 막되 산출물은 보존하고, 인간 개입이 필요한 지점을 명시적으로 남긴다.
- **난이도는 라우트와 직교한다** — 라우트가 어느 페이즈를 도는지 정하고, 난이도가 얼마나 두껍게 도는지 정한다. 애매하면 Heavy로 편향한다. 오분류 비용이 비대칭이기 때문이다.
- **역할을 늘리기보다 인스턴스를 복제한다** — 주입 방식 때문에 새 agent type은 캐시 접두사를 하나 더 만들고, 파이프라인당 1회 스폰이면 그 미스를 회수할 기회가 없다. 병렬화가 필요하면 파일 트리가 겹치지 않는 축으로 같은 타입을 복제한다.
- **판정 한 필드가 조직도를 대체한다** — 실패를 어느 역할에 넘길지는 리더 계층이 있어야 정해지는 것이 아니다. `e2e-tester`의 `area` 한 필드로 재스폰 대상이 결정되므로, 계층을 늘리지 않고 핀포인트 라우팅이 성립한다.
- **P2P 통신은 Claude Code 호스트의 Track A 한정** — Claude Code에서는 팀 모드를 Phase 3 Track A(QA ↔ Developer ↔ Reviewer)에만 쓴다. 그 구간의 팀원은 리더를 거치지 않고 서로 직접 `SendMessage`로 피드백 루프를 돈다. 그 밖의 역할은 모두 서브 에이전트이며 **발신 대상이 없다** — 다른 역할에 전달할 내용은 최종 보고에 담고 오케스트레이터가 중계한다. 브로드캐스트(`to: "all"`)는 쓰지 않는다.
- **Codex 호스트는 항상 허브-스포크** — Codex 서브에이전트에는 팀원 간 상시 채널이 없으므로, `.agents/skills/run_web_sdlc/SKILL.md`는 Track A도 Track B와 같은 방식(순차 위임 + 오케스트레이터 중계)으로 진행한다. 두 호스트의 라우팅·페이즈 골격은 같지만 이 지점만 다르다.
- **메인 브랜치 보호** — `issue-pm`이 이슈 번호 기반 `<타입>/<이슈번호>-<슬러그>` 브랜치를 먼저 따고, 그 위에서만 개발이 진행된다.

## 라이선스

[MIT](LICENSE) © 2026 nyj001012
