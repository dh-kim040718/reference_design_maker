# 레퍼런스 디자인 메이커

레퍼런스를 프로젝트·분류별로 모으고 이미지·메모·참고 요소를 종합해 AI 탐색 시안을 만드는 앱입니다.

현재 첫 출시 범위와 검증 기준은 [현재 상태](./docs/current-status.md)를 확인하세요. 저장·확장 수집·선택 생성·목적/규격 설정은 구현돼 있습니다. 운영 배포는 미완료이며 실제 품질·청구 수용은 별도 검증입니다. 영역 편집과 서버 재시작 후 자동 재개는 출시 제외입니다.

## 주요 문서

- [PRD](./PRD.md) · [SPEC](./SPEC.md) · [단계별 계획](./개발계획.md) · [작업 규칙](./AGENTS.md)
- [확장 자동 썸네일](./docs/extension-auto-preview.md) · [참고 역할/영역 메모](./docs/reference-guidance.md)
- [사용 목적/규격](./docs/design-settings.md) · [생성 안정성](./docs/generation-reliability.md)
- [실제 API 보류 항목](./docs/deferred-api-work.md) · [운영 준비](./docs/phase-6-operations.md) · [백업/복원](./docs/phase-6-backup-recovery.md)

## 환경과 설치

React·TypeScript·Vite / FastAPI / SQLAlchemy·Alembic / Supabase Auth·PostgreSQL 구성입니다. SQLite는 격리된 빠른 테스트에 사용합니다. 실제 설정은 Git에서 제외한 **루트 `.env`**에서 읽고 `.env.example`을 안내로 사용합니다. 키·비밀번호는 코드·채팅·Git에 넣지 않습니다.

Docker Desktop을 실행하고 루트에서 로컬 Supabase를 준비합니다. 운영 DB로 테스트하지 않습니다.

```powershell
npm.cmd ci
npx.cmd supabase start --exclude vector
py -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -e "backend[dev]"
npm.cmd ci --prefix frontend
```

위 설치는 새 환경에서 필요할 때만 실행합니다. 루트 `.env`에 로컬 `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`와 프런트엔드 주소에 맞는 `CORS_ORIGINS`를 준비합니다. 로컬 Supabase DB 기본 포트는 54322, Auth 기본 주소는 `http://127.0.0.1:54321`입니다. 실제 실행 구성을 확인하세요.

**현재 코드에는 DB 주소 누락 시 SQLite 개발 기본값이 있습니다. Supabase 사용 시 DATABASE_URL을 명시하고 대상을 확인하세요.** 운영 공개 전에는 기본값 허용 범위를 별도 검증합니다.

## 실행

백엔드 터미널:

```powershell
Set-Location backend
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app
```

별도 프런트엔드 터미널:

```powershell
Set-Location frontend
$env:VITE_API_PROXY_TARGET='http://127.0.0.1:8000'
npm.cmd run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

화면: `http://127.0.0.1:5174/projects` · 확장 다운로드: `/collect` · API 문서: `http://127.0.0.1:8000/docs` · 상태: `/health/ready`.

위는 8000/5174 실행 예시입니다. 기존 서버가 다른 포트에 있으면 중복 실행하지 말고 API와 프록시 대상을 맞춥니다. 종료는 해당 터미널의 Ctrl+C입니다. 프런트엔드만 켜져 있으면 화면은 보여도 조회·저장은 실패할 수 있습니다.

## 사용 흐름

로그인 → 프로젝트/분류 → URL 또는 확장으로 저장 → 메모·참고 요소 지정 → 시안 만들기 → 참고 이미지 선택 → 목적·크기·요구사항 입력 → 사용 권한 확인 → 생성.

별도 저장 버튼 없이 생성 시 현재 요구사항을 반영합니다. 선택한 1~16개 자료가 대상이며 일부를 임의로 생략하지 않습니다. 확장 0.3.0은 썸네일 자동 추출을 시도하고 출처 제한 시 이미지 선택·붙여넣기로 대체할 수 있습니다.

유료 생성에는 서버 활성화·키·예약 예산·일일 횟수 조건이 필요합니다. 앱 예약 예산은 실제 청구액이 아닙니다. 화면·회귀 검증은 mock과 기존 결과를 사용하며 실제 호출은 별도 승인 범위에서만 수행합니다.

## 검사와 오류 확인

```powershell
npm.cmd run lint --prefix frontend
npm.cmd run typecheck --prefix frontend
npm.cmd test --prefix frontend
npm.cmd run build --prefix frontend
npm.cmd test --prefix browser-extension
backend/.venv/Scripts/python.exe scripts/package_collector.py --check
node scripts/check_public_artifacts.mjs
```

backend에서 `.venv/Scripts/python.exe -m pytest -m "not integration"`을 실행합니다. PostgreSQL 통합 검증은 별도 로컬 테스트 DB에 `TEST_DATABASE_URL`과 `RUN_POSTGRES_INTEGRATION_TESTS=1`을 지정한 뒤 `-m pytest -m integration`으로 실행합니다. 제외된 검사를 통과로 계산하지 않습니다.

오류는 화면 → Console → Network 요청/응답 → 백엔드 터미널 순서로 확인합니다. 보고할 때 동작·경로·상태 코드·안전한 오류 코드만 남기고 비밀번호·토큰·이미지·메모는 제거합니다. 404는 경로, 401/403은 인증/권한, 429는 횟수·요청 속도·예산 등 구체 응답 원인을 확인합니다. 유료 요청 결과가 불명확하면 새 생성 대신 기존 이력을 먼저 확인합니다.
