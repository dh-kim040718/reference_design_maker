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

실제 OpenAI 키는 프로젝트 루트의 로컬 `.env` 파일에 설정하세요. `.env.example`은 템플릿이며, 키를 커밋하거나 채팅에 공유하지 마세요.