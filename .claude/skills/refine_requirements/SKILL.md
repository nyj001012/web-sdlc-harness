---
name: refine_requirements
description: 사용자와 질의응답을 거쳐 요구사항을 Gherkin(Feature/Scenario/Given-When-Then) 시나리오로 압축·확정합니다. '요구사항 정리', '시나리오 작성', '기획 착수 전 요구사항 확정' 요청 시 반드시 이 스킬을 호출하십시오. 아키텍처·기술 스택 결정이나 이슈 분할, 실제 코드·계약 작성에는 절대 이 스킬을 트리거하지 마십시오.
allowed-tools:
  - Read
  - Write
  - Edit
---

# Skill: Requirement Refinement into Gherkin Scenarios

## Workflow (작업 순서)

1. **요구사항 컨텍스트 분석 (Context Analysis)**
   - 사용자의 프롬프트와 프로젝트 루트의 기존 `requirements.md`(있으면)를 확인한다.
   - `.claude/_workspace/00_scenario/scenario.feature` 초안이 이미 있으면 `Read`로 확인하고 갱신 대상으로 삼는다.

2. **질의응답 (Clarification)**
   - 이 스킬은 오케스트레이터를 거치지 않고 **지금 이 대화에서 사용자와 직접** 질의응답한다 (`run_web_sdlc` 파이프라인 안에서 `business-analyst` 서브 에이전트로 실행될 때는 오케스트레이터가 질문을 중계하는 라운드 루프를 대신 쓴다 — 이 스킬은 그 서브 에이전트 실행 방식이 아니라 **독립 호출** 경로다).
   - 시나리오를 Gherkin으로 확정하기에 모호하거나 상충하는 지점이 있으면 **구체적 질문(최대 5개, 우선순위 순)**을 던진다. 가능하면 양자택일·객관식 형태로 물어 답변 부담을 줄인다.
   - UI 문구·색상 등 지엽적 디테일까지 전부 묻지 않는다. 합리적 기본값으로 채우고, 확정이 아니라 가정임을 시나리오 안에 `# 가정: ...` 주석으로 남긴다.
   - 파괴적 동작의 트리거 조건, 데이터 소유권처럼 되돌리기 어려운 결정은 반드시 확인 후 진행한다. 그럴싸하게 지어내지 않는다.

3. **Gherkin 시나리오 작성 (Scenario Authoring)**
   - 확정된 내용을 `Feature`/`Scenario`/`Given`/`When`/`Then`/`And`/`But`만으로 작성한다. 그 밖의 서론·요약·설명은 산출물에 섞지 않는다.
   - 서로 다른 기능이 섞여 있으면 `Feature` 블록 단위로 분리한다 (한 파일에 여러 `Feature` 허용).
   - 기존 초안을 고칠 때는 `Edit`를 쓴다. `Write`는 신규 파일 생성 전용이다.

4. **산출물 적재 (Save Scenario)**
   - `.claude/_workspace/00_scenario/scenario.feature`에 저장한다.
   - 최종 응답 첫 줄에 산출 경로를 명시한다.

## Why (왜 이렇게 하는가?)

- **파이프라인 캐시 방어의 입력 다듬기:** `run_web_sdlc`의 Phase 1은 이 산출물을 `inject-scenario.mjs`로 `system-architect`·`issue-pm`의 시스템 프롬프트에 정적 주입한다. 수만 토큰짜리 질의응답 대화 기록을 그대로 넘기는 대신, 여기서 미리 Gherkin으로 압축해 두면 그 주입 접두사가 안정적으로 캐시 히트한다.
- **독립 호출과 파이프라인 호출의 분리:** 전체 SDLC를 돌리기 전에 "이 기능 시나리오로 정리해줘"처럼 요구사항만 다듬고 싶은 요청이 자주 있다. 이 스킬은 그 요청을 `business-analyst` 서브 에이전트를 거치지 않고 직접 처리해, 매번 전체 파이프라인을 가동할 필요를 없앤다.
- **추측보다 질문:** 핵심 동작이 불명확한 채로 시나리오를 확정하면, 그 오류가 아키텍처·계약·구현까지 그대로 흘러간다. 지엽적 디테일과 핵심 동작을 구분해 질문 비용과 정확성을 함께 지킨다.
