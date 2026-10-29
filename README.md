# reference_design_maker

## 문서

- [제품 기획](./기획.md)
- [제품 요구사항 문서 (PRD)](./PRD.md)
- [제품·기술 명세 (SPEC)](./SPEC.md)
- [단계별 개발 계획](./개발계획.md)
- [OpenAI API 키 설정](./API-KEY-SETUP.md)

## 기술 구성

- 프론트엔드: React + TypeScript + Vite
- 백엔드 API: FastAPI (Python 3.12+)
- 운영 데이터베이스: Supabase (PostgreSQL)
- 빠른 테스트용 데이터베이스: SQLite
- 인증: Supabase Auth
- Python 데이터 계층 / 마이그레이션: SQLAlchemy 2 / Alembic
- PostgreSQL 통합 테스트: Docker 기반 로컬 Supabase (운영 DB 사용 금지)
- 초기 브라우저 지원: Chrome 우선, Edge 호환성 확인

## 로컬 Supabase

Docker Desktop을 실행한 뒤 `npx supabase start --exclude vector`로 로컬 Supabase를 시작하고, `npx supabase status`로 상태를 확인합니다. 이 개발 환경에서는 미사용 Vector 로그 수집기를 제외합니다. 로컬 프로젝트는 호스팅 Supabase 프로젝트에 연결하지 않았고, 운영 Supabase 프로젝트는 통합 테스트에 사용하지 않습니다. 자세한 마이그레이션 및 테스트 절차는 [SPEC.md](./SPEC.md)를 참고하세요.

실제 OpenAI 키는 프로젝트 루트의 로컬 `.env` 파일에 설정하세요. `.env.example`은 템플릿이며, 키를 커밋하거나 채팅에 공유하지 마세요.

## 앱 실행

프론트엔드는 별도 터미널에서 실행합니다.

```powershell
Set-Location frontend
npm ci
npm run dev
```

백엔드 가상 환경과 의존성은 저장소 루트에서 준비합니다.

```powershell
py -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
Set-Location backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

환경 변수는 저장소 루트의 `.env`에서 읽습니다. 로컬 SQLite를 기본으로 사용하며, Supabase Auth 검증을 실행하려면 로컬 Supabase의 URL과 anon key를 `.env`에 설정하세요. 프론트엔드 API URL을 변경하려면 `frontend/.env.example`을 `frontend/.env.local`로 복사해 수정합니다. OpenAI API 호출은 비용 한도와 별도 승인을 정할 때까지 수행하지 않습니다.

## 검증

```powershell
Push-Location frontend
npm run lint
npm run typecheck
npm test
npm run build
Pop-Location

Push-Location backend
.venv\Scripts\python.exe -m ruff check app tests alembic
.venv\Scripts\python.exe -m pytest -m "not integration"
Pop-Location
```

로컬 Supabase PostgreSQL 통합 테스트는 별도로 실행합니다. 테스트 URL은 로컬 개발 DB 포트만 허용하며 운영 DB 연결은 거부됩니다.

```powershell
Push-Location backend
$env:RUN_POSTGRES_INTEGRATION_TESTS = "1"
$env:TEST_DATABASE_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres"
.venv\Scripts\python.exe -m pytest tests\test_postgres_integration.py -m integration
Remove-Item Env:RUN_POSTGRES_INTEGRATION_TESTS
Remove-Item Env:TEST_DATABASE_URL
Pop-Location
```