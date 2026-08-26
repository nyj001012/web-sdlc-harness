---
name: create_pr_mr
description: 로컬의 feature 브랜치를 원격 저장소에 Push하고, GitHub PR 또는 GitLab MR을 자동 생성합니다.
---

# Skill: Automated Remote Push & PR/MR Creation

## Workflow (작업 순서)

1. **로컬 커밋 원격 Push (Push to Origin)**
   - 🚨 **가장 먼저 수행:** `Bash` 도구를 사용하여 **`git push -u origin HEAD`** 명령어를 실행한다.
   - 오케스트레이터가 작성해둔 로컬의 마이크로 커밋들이 원격 작업 브랜치(`<타입>/<이슈번호>-<슬러그>`)에 안전하게 업로드되었는지 확인한다.

2. **플랫폼 판별 및 Diff 분석 (Context Analysis)**
   - `git remote -v`로 GitHub/GitLab 여부를 판별한다.
   - `git diff main`을 통해 변경된 코드 범위를 요약한다.

3. **범용 템플릿 작성 (Template Generation)**
   - `Resolves #이슈번호`와 두괄식 핵심 요약이 포함된 MR/PR 본문을 작성한다.

4. **CLI 기반 병합 요청 발행 (Execute CLI)**
   - **GitHub:** `gh pr create --title "[Feature] 작업명" --body "템플릿"`
   - **GitLab:** `glab mr create --title "[Feature] 작업명" --description "템플릿" --yes`
   - 만약 타겟 브랜치를 명시해야 한다면 `--base main` 옵션을 추가한다.

5. **Fallback 처리 (Fallback)**
   - Push나 PR/MR 생성에 3회 실패할 경우 `.codex/_workspace/02_issues/pr_mr_fallback.md`에 백업하고 우아하게 종료한다.

## Why (왜 이렇게 하는가?)
- **Git Flow의 완벽한 준수:** 로컬에서 작업한 `feature` 브랜치를 원격으로 밀어 올리고(Push), `main`에 병합(Merge)하기 위한 심사를 요청하는 표준 애자일 프로세스를 기계적으로 자동화하기 위함이다.
