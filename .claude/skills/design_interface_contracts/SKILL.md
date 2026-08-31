---
name: design_interface_contracts
description: "기획서와 이슈를 바탕으로 프론트엔드(UI/State), 백엔드(API/비즈니스 로직/데이터 접근), QA 팀이 병렬로 개발할 수 있도록 풀스택 인터페이스 및 데이터 계약을 설계합니다. 계약의 언어와 포맷은 아키텍처 산출물이 정한 기술 스택을 따릅니다. 실제 비즈니스 로직 작성이나 UI 컴포넌트 구현 실무에는 절대 이 스킬을 트리거하지 마십시오."
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - SendMessage
---

# Skill: Full-stack Interface Contracts Design

## Workflow (작업 순서)

1. **스택 및 계약 형식 확인 (Stack Binding)**
   - 시스템 프롬프트 최상단에 **이미 주입된** `<design_spec>` 블록의 「기술 스택」·「계약 산출 형식」·「아키텍처 규약」 섹션을 확인한다.
   - 계약을 작성할 **언어/포맷**(정적 타입 언어의 타입 선언, OpenAPI, JSON Schema, protobuf 등), **파일 확장자**, **검증 명령**을 여기서 확정한다.
   - 🚨 **주의:** `design.md`를 `Read` 등 어떤 도구로도 읽지 않는다. 전문이 이미 주입되어 있으며 중복 조회는 규약 위반이다.
   - 🚨 **주의:** 스택을 스스로 가정하지 않는다. 해당 섹션이 없거나 모순되면 작성을 멈추고 `[SPEC GAP]`을 붙여 호출자에게 질의한다.

2. **사전 컨텍스트 분석 (Context Analysis)**
   - `<design_spec>`의 데이터 모델·데이터 흐름과 이슈 리포트를 교차 검토하여 계약 대상 범위를 확정한다.

3. **프론트엔드 계약 설계 (FE Contracts)**
   - UI 컴포넌트의 입력 규격(Props 등), 전역/지역 상태 구조, 실시간 수신 데이터 구조, API 요청/응답 스키마를 명확히 정의한다.
   - 실시간 통신 방식(WebSocket, SSE, 폴링 등)은 `<design_spec>`의 규약을 따르고, 그 방식에 맞는 메시지 스키마를 정의한다.

4. **백엔드 계약 설계 (BE Contracts, DDD 오브젝트 디자인)**
   - `<design_spec>`이 정한 계층 구조(예: Controller / Service / Repository)에 맞춰 각 계층의 함수·메서드 시그니처와 데이터 엔티티 스키마를 정의한다.
   - **데이터 엔티티는 도메인 주도 설계(DDD) 패턴을 따른다.** 식별자로 구분되는 객체는 Entity, 속성 값만으로 동등성이 결정되는 불변 객체는 Value Object로 구분한다. 함께 변경되어야 하는 Entity·Value Object 묶음은 하나의 Aggregate로 묶어 Aggregate Root만 외부에 노출하고, Repository 인터페이스는 Aggregate Root 단위로만 정의한다(내부 Entity용 Repository는 만들지 않는다). 필드·타입 이름은 기획서·시나리오의 도메인 용어(Ubiquitous Language)를 그대로 쓰고 DB 컬럼명·기술 축약어로 대체하지 않는다.
   - 🚨 **주의:** `any`나 자유 형식 딕셔너리처럼 검증을 무력화하는 모호한 타입 사용을 엄격히 금지한다. 에러 응답 형태도 계약에 포함한다.

5. **정합성 검증 (Contract Validation)**
   - `Bash` 도구로 `<design_spec>`의 계약 검증 명령(정적 타입 검사 또는 스키마 린트)을 실행해 오류가 없는지 확인한다. 3회까지 자체 수정한다.

6. **계약 산출물 적재 (Save Contracts)**
   - 검증이 완료된 계약 파일들을 오직 `.claude/_workspace/03_contracts/` 경로 하위에만 저장하고 종료한다.

## Why (왜 이렇게 하는가?)

- **클린 룸 병렬 개발 보장:** FE, BE, QA 팀이 서로의 코드를 기다리지 않고 이 계약서 하나만 바라보고 즉시 병렬 개발(Scale-out)을 시작할 수 있도록 병목을 차단하기 위함이다.
- **스택 독립성:** 계약의 표현 수단(타입 선언 / 스키마 문서)은 프로젝트마다 다르다. 형식을 아키텍처 산출물에 위임함으로써 동일한 계약 설계 절차를 어떤 스택에서도 재사용하기 위함이다.
