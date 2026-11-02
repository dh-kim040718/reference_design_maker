# reference_design_maker

디자인 레퍼런스를 프로젝트·산출물 유형별로 저장하고 썸네일과 디자인 메모로 다시 찾는 앱입니다.

2026-10-29 기준 **Phase 2 완료, Phase 3 PC 기능 구현·검증 및 사용자 확장 설치·동작 확인 완료**입니다. 모바일 OS 공유 메뉴 실기기 검증은 남아 있어 모바일을 포함한 Phase 3 전체 완료 판정은 보류합니다. AI 생성·배포는 아직 진행하지 않았습니다.

## 문서

- [개발 계획과 단계별 상태](./개발계획.md)
- [Phase 3 사용법·공유 수신·기기 검증 범위](./docs/phase-3.md)
- [Phase 2 완료 기준·검증·실행 방법](./docs/phase-2-verification.md)
- [현재 화면·사용자 흐름](./docs/phase-2-ui.md)
- [데이터·API 계약](./docs/phase-2-api.md)
- [썸네일 구현과 Pinterest 제한](./docs/thumbnail-ui.md)
- [제품 기획](./기획.md), [PRD](./PRD.md), [기술 명세](./SPEC.md)
- [OpenAI 키 설정](./API-KEY-SETUP.md)

## 현재 사용 방법

외부 페이지에서 바로 저장하려면 로그인 후 **외부에서 저장**(`http://127.0.0.1:5174/collect`)을 엽니다. 북마크바 버튼을 추가하거나 확장 프로그램 ZIP을 다운로드할 수 있습니다. 지원 환경의 설치형 앱 공유 대상 설정도 포함합니다. 같은 브라우저·같은 앱 출처의 새 수집 창은 로그인 상태를 공유하며, 저장은 확인 화면에서 직접 실행합니다.

`http://127.0.0.1:5174/`에서 회원가입·로그인합니다. 프로젝트 카드의 **레퍼런스 추가** → URL·산출물 유형 선택 → 선택 제목·메모 → 저장 순서로 이용합니다. 유형이 없으면 폼 안에서 만들 수 있습니다.

상세에서 원본 링크 열기, 메모 수정, 썸네일 변경이 가능합니다. 이미지는 파일 선택 또는 이미지 복사 후 **Ctrl+V**로 넣습니다. 프로젝트·유형 카드는 저장한 레퍼런스의 썸네일을 표지로 사용합니다. 설명 입력은 제거했습니다.

자동 미리보기는 외부 사이트의 접근 정책에 따라 실패할 수 있습니다. 확인한 Pinterest 링크는 자동 수집이 제한되어 이미지 선택·붙여넣기를 사용합니다. 링크 저장과 메모 사용에는 영향이 없습니다.

## 기술 구성

React + TypeScript + Vite / FastAPI / SQLAlchemy 2 + Alembic / Supabase Auth + PostgreSQL을 사용합니다. SQLite는 빠른 테스트용입니다. OpenAI API는 아직 호출하지 않습니다.

## 로컬 실행

Docker Desktop을 실행하고 저장소 루트에서 로컬 Supabase를 시작합니다. 운영 Supabase를 테스트에 사용하지 않습니다.

```powershell
npm.cmd ci
npx.cmd supabase start --exclude vector
```

루트 `.env`에 로컬 설정을 준비합니다. 공개 anon key는 실행 중인 로컬 Supabase에서 확인하며 실제 값을 커밋하지 않습니다.

```dotenv
DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<로컬 Supabase anon key>
```

백엔드는 저장소 루트에서 설치한 뒤 별도 터미널에서 실행합니다.

```powershell
py -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
Set-Location backend
.venv\Scripts\python.exe -m alembic upgrade head
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8011 --reload --reload-dir app
```

프런트엔드는 `frontend/.env.local`에 아래 프록시 설정을 둡니다. 개발 모드의 API 요청은 같은 출처의 `/api`를 통해 전달되므로 이전 8000번 서버와 혼동하지 않습니다.

```dotenv
VITE_API_PROXY_TARGET=http://127.0.0.1:8011
```

다른 터미널에서 실행합니다.

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

API 문서: `http://127.0.0.1:8011/docs`. 현재 스키마는 `0003_thumbnails`입니다. 브라우저용 Supabase 키·DB 비밀 키·OpenAI 키를 프런트엔드 코드에 넣지 않습니다. `.env`, `.env.local`, `.phase2-checks/`는 Git에서 제외합니다.

## 검사·테스트

```powershell
Push-Location frontend
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
Pop-Location

Push-Location backend
.venv\Scripts\python.exe -m ruff check app tests alembic
.venv\Scripts\python.exe -m pytest -m "not integration"
Pop-Location
```

로컬 PostgreSQL 전체 통합 테스트:

```powershell
Push-Location backend
$env:RUN_POSTGRES_INTEGRATION_TESTS = '1'
$env:TEST_DATABASE_URL = 'postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres'
.venv\Scripts\python.exe -m pytest -m integration
Remove-Item Env:RUN_POSTGRES_INTEGRATION_TESTS
Remove-Item Env:TEST_DATABASE_URL
Pop-Location
```

최신 검증: 프런트엔드 36개, 백엔드 66개 통과. 확장·설치 설정·오프라인 계약 9개는 Phase 3 검증 기록을 따릅니다. 확장 검사는 `npm.cmd test --prefix browser-extension`, 패키지 일치는 `backend\.venv\Scripts\python.exe scripts/package_collector.py --check`로 확인합니다. 원격 CI 실행과 배포 완료를 의미하지 않습니다.

Phase 4 AI 화면은 레퍼런스 상세 → **AI 시안 만들기**에서 확인합니다. 유료 호출은 기본 비활성화(`IMAGE_GENERATION_ENABLED=false`)이며 별도 예산·호출 승인 후 활성화합니다. 구현·모델 단가·API·검증·제한은 [Phase 4 기록](./docs/phase-4-ai-generation.md)에 정리했습니다. 실제 비용·품질 평가는 아직 진행하지 않았습니다.

API 키 없이 사용할 수 있는 [Phase 5 로컬 실험](./docs/phase-5-local-editing.md)도 추가했습니다. 생성 화면에서 이미지를 선택한 뒤 **영역 편집 준비 · 로컬 실험**을 펼치면 편집 영역 선택과 마스크 PNG 다운로드를 사용할 수 있습니다. 실제 AI 편집은 아직 연결하지 않았습니다. [Phase 6 출시 준비](./docs/phase-6-release-readiness.md)에는 공개 산출물 비밀 검사와 장애 대응·남은 운영 게이트를 기록했습니다.

**실제 API 작업 재개 시:** [보류 작업 체크리스트](./docs/deferred-api-work.md)를 먼저 확인하세요. Phase 4~6의 실제 연동·품질·비용·운영 확인을 API-01~20으로 관리하며, 기존 실패 시도와 추가 호출 승인 조건도 함께 기록했습니다.

**실제 API 평가 갱신:** [Phase 4·5 실측 보고서](./docs/phase-45-live-evaluation.md)에 생성·재생성·지시 편집·무지시 변형과 실제 결과의 브라우저 검증을 기록했습니다. 편집 API 연결은 구현됐지만 보호 영역/카드 정보 보존에 실패해 편집을 출시에서 제외하고 비활성화 상태로 유지합니다. 실제 청구 확인과 사용자 수용 전 전체 완료로 표시하지 않습니다.

**Phase 6 백업·복원:** backend에서 `.venv/Scripts/python.exe -m app.backup drill`로 앱 데이터의 로컬 스냅샷 생성→별도 신규 DB 복원→내용 비교를 실행할 수 있습니다. 원본 DB를 덮어쓰거나 AI 작업을 재실행하지 않습니다. 파일은 Git 제외된 `.phase6-backups/`에 저장하며 개인정보를 포함할 수 있습니다. [실행 방법·삭제 반영·운영 미완료 범위](./docs/phase-6-backup-recovery.md)를 먼저 확인하세요.

**Phase 6 운영 준비:** 금액 예약 한도(기본 0, 새 유료 요청 차단)와 운영 점검 `.venv/Scripts/python.exe -m app.operations`, 출시 검사 `-m app.release_check`를 추가했습니다. 자동 재개는 원본 비보관 정책에 따라 제외합니다. 별도 배포 환경 파일을 요구하는 Docker/Nginx 구성의 빌드와 키 없는 로컬 실행 검증을 통과했지만, 실제 운영 배포·원격 백업·알림 설치는 하지 않았습니다. [정책·실행 방법·남은 게이트](./docs/phase-6-operations.md)를 확인하세요.

최신 로컬 검증: 백엔드 160개 통과·6개 제외, 프런트엔드 48개·빌드/lint 통과. PostgreSQL 금액 예약 경합·격리 복원과 Docker 빌드/로컬 실행도 검증했습니다. 제외 범위와 운영 미완료 항목은 운영 준비 기록에 구분했습니다.

생성 입력/결과 화면의 **내 AI 사용 현황 보기**에서는 본인 계정의 최근 7/30일 성공·실패·결과 불명·처리 시간·확인된 토큰 사용량을 조회할 수 있습니다. 조회 자체는 유료 API를 호출하지 않으며 실제 청구액은 제공자 사용 내역에서 별도로 확인해야 합니다. 최신 검증은 백엔드 129개·프런트엔드 47개 테스트와 빌드/lint 통과이며, 운영 배포 완료를 뜻하지 않습니다.
