# reference_design_maker

## 문서

- [제품 기획](./기획.md)
- [제품 요구사항 문서 (PRD)](./PRD.md)
- [제품·기술 명세 (SPEC)](./SPEC.md)
- [단계별 개발 계획](./개발계획.md)
- [OpenAI API 키 설정](./API-KEY-SETUP.md)

## 기술 구성

- 프론트엔드: React
- 백엔드 API: FastAPI
- 운영 데이터베이스: Supabase (PostgreSQL)
- 빠른 테스트용 데이터베이스: SQLite
- 인증: Supabase Auth
- Python 데이터 계층 / 마이그레이션: SQLAlchemy 2 / Alembic
- PostgreSQL 통합 테스트: Docker 기반 로컬 Supabase (운영 DB 사용 금지)

## 로컬 Supabase

Docker Desktop을 실행한 뒤 `npx supabase start --exclude vector`로 로컬 Supabase를 시작하고, `npx supabase status`로 상태를 확인합니다. 이 개발 환경에서는 미사용 Vector 로그 수집기를 제외합니다. 로컬 프로젝트는 호스팅 Supabase 프로젝트에 연결하지 않았고, 운영 Supabase 프로젝트는 통합 테스트에 사용하지 않습니다. 자세한 마이그레이션 및 테스트 절차는 [SPEC.md](./SPEC.md)를 참고하세요.

실제 OpenAI 키는 프로젝트 루트의 로컬 `.env` 파일에 설정하세요. `.env.example`은 템플릿이며, 키를 커밋하거나 채팅에 공유하지 마세요.