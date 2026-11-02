# Phase 2 데이터·API 설계

상태: 2026-10-29 Phase 2 저장 API와 테이블 구현 및 로컬 검증 완료. 기존 `/health`, `/health/ready`, `/api/v1/me` 및 Supabase Auth 검증 경계를 유지한다. [화면 설계](./phase-2-ui.md), [검증 기록](./phase-2-verification.md)과 함께 사용한다.

## 데이터 구조

모든 ID는 UUID, 시각은 UTC로 저장하고 API에서 오프셋을 포함한 ISO 8601 문자열로 반환한다. 화면에서는 사용자 시간대로 표시한다. SQLAlchemy 공통 타입으로 SQLite와 PostgreSQL을 지원하되 실제 마이그레이션은 두 DB에서 검증한다.

| 테이블 | 필드와 제약 |
|---|---|
| `projects` | `id` PK, `owner_id` 필수, `name` 필수, `archived_at` nullable, `created_at`, `updated_at` |
| `deliverable_types` | `id` PK, `project_id` FK 필수, `name` 필수, `archived_at` nullable, `created_at`, `updated_at` |
| `references` | `id` PK, `deliverable_type_id` FK 필수, `source_url` 필수, `title`, `description`, `design_note`, `preview_url`, `preview_source` nullable, `created_at`, `updated_at` |
| `user_preferences` | `owner_id` PK, `last_deliverable_type_id` nullable FK, `updated_at` |

소유권은 `reference → deliverable_type → project.owner_id`로 판정한다. 중복된 소유자 필드를 하위 테이블에 저장하지 않는다. 프로젝트 ID도 레퍼런스에 중복 저장하지 않고 유형에서 구한다. Auth 사용자는 외부 시스템이므로 앱 DB에서 Auth 테이블을 직접 외래 키로 참조하지 않는다.

FK 삭제 정책은 RESTRICT로 두며 영구 삭제 API는 만들지 않는다. SQLite 테스트에서도 FK 검증을 활성화한다. `projects(owner_id, archived_at, updated_at, id)`, `deliverable_types(project_id, archived_at, updated_at, id)`, `references(deliverable_type_id, created_at, id)` 조회 인덱스를 둔다.

현재 스키마는 `0003_thumbnails`다. `0002_library`는 저장 MVP, `0003_thumbnails`는 선행 구현한 썸네일 컬럼을 추가한다. 공개 미리보기 조회는 저장 요청과 별도로 실행하며 실패해도 저장을 막지 않는다. Generation 테이블·AI 연동은 Phase 4 후속 범위다.

## 입력 계약

회원가입 추가: `POST /api/v1/auth/signup`은 이메일·8자 이상 비밀번호를 받아 Supabase Auth에 전달한다. 201 응답의 `session`이 있으면 로그인 상태로 전환하고, null이면 이메일 확인 안내를 표시한다. 비밀번호 확인은 클라이언트에서 검증하며 비밀번호를 공백 제거하지 않는다.

JSON 필드명은 snake_case로 통일한다. 기존 SPEC의 camelCase는 논리 예시이며 구현 API에는 이 문서의 이름을 적용한다. 알 수 없는 필드는 거부한다. 입력 길이와 중복 이름 정책은 아래 구현 기준안을 적용한다.

| 필드 | 유효성 |
|---|---|
| 프로젝트·유형 `name` | 앞뒤 공백 제거 후 1~100자. 중복 이름 허용, ID로 구분 |
| `source_url` | 앞뒤 공백 제거 후 최대 4096자. 절대 HTTP/HTTPS URL, 호스트 필수. 사용자명·비밀번호 포함 주소 거부 |
| `title` | 최대 200자, 공백만 있거나 빈 문자열이면 null |
| `description` | 이전 API 호환용, 최대 2000자. 현재 UI는 입력·표시하지 않음 |
| `design_note` | 최대 5000자, 공백만 있거나 빈 문자열이면 null, 내부 줄바꿈 유지 |
| `preview_url` | nullable. HTTPS 이미지 URL 또는 검증된 PNG·JPEG·WebP data URL. 입력 최대 400100자, 이미지 바이너리 최대 300KB |
| `preview_source` | nullable. `page_metadata` 또는 `user_upload` |

원본 URL은 앞뒤 공백만 제거한 입력값을 보존한다. 검증 과정에서 쿼리·프래그먼트·경로를 재작성하지 않는다. 동일 URL의 여러 저장은 허용한다. 메모 PATCH에서 필드 생략은 변경 없음, null 또는 빈 문자열은 비우기로 처리한다. 화면과 서버 모두 검증하되 서버 결과가 최종 기준이다.

## 엔드포인트

모든 경로의 접두사는 `/api/v1`이다. 아래 API는 bearer token을 요구한다. 요청에서 owner_id를 받지 않고 인증 사용자로 결정한다.

인증 진입 API는 별도로 `POST /auth/signup`(이메일·8자 이상 비밀번호), `POST /auth/login`(이메일·비밀번호), `POST /auth/refresh`(refresh_token), `POST /auth/logout`(bearer token)을 제공한다. FastAPI에서 Supabase Auth에 중계하며 서버가 인증을 우회하거나 자체 토큰을 발급하지 않는다. 가입·로그인·갱신 응답은 no-store이며 로그아웃은 현재 세션의 refresh token을 폐기한다. Phase 3부터 새 수집 창과 로그인을 공유하기 위해 같은 출처의 localStorage에 세션을 저장하고 창 간 계정 변경을 동기화한다. 초안은 계정별 메모리, 아직 로그인하지 않은 공유 정보는 탭별 임시 sessionStorage로 분리한다.

| 메서드·경로 | 요청 | 성공 |
|---|---|---|
| `GET /projects` | `archived=false`, `limit=24`, `offset=0` | 200 프로젝트 페이지 |
| `POST /projects` | `{name}` | 201 프로젝트 |
| `GET /projects/{id}` | — | 200 프로젝트 |
| `PATCH /projects/{id}` | `{name}` 또는 `{archived: true/false}` | 200 프로젝트 |
| `GET /projects/{id}/deliverable-types` | 동일한 페이지·보관 매개변수 | 200 유형 페이지 |
| `POST /projects/{id}/deliverable-types` | `{name}` | 201 유형 |
| `GET /deliverable-types/{id}` | — | 200 유형 및 프로젝트 경로 |
| `PATCH /deliverable-types/{id}` | `{name}` 또는 `{archived: true/false}` | 200 유형 |
| `GET /deliverable-types/{id}/references` | `limit=24`, `offset=0` | 200 레퍼런스 페이지 |
| `POST /references` | 아래 저장 요청 | 201 레퍼런스 및 경로 |
| `GET /references/{id}` | — | 200 레퍼런스 및 경로 |
| `PATCH /references/{id}` | `{design_note}` | 200 수정된 레퍼런스 |
| `GET /preferences` | — | 200 마지막 유효 저장 경로 또는 null |
| `POST /references/preview` | `{source_url, refresh?: boolean}` | 200 `{preview_url, title, status, reason?}`. 수집 실패도 저장 실패와 구분 |
| `PATCH /references/{id}/thumbnail` | `{preview_url, preview_source}` | 200 수정된 레퍼런스 |

프로젝트·유형 목록 응답은 파생 필드 `thumbnail_url`을 포함한다. 레퍼런스 응답은 저장된 `preview_url`, `preview_source`를 포함한다. 미리보기의 `status`는 `available` 또는 `unavailable`이며, 접근 정책 제한은 `reason=site_restricted`, 인증서 검증 실패는 `reason=tls_error`로 구분한다. 인증·입력 오류는 기존 HTTP 오류 계약을 따른다. 수집 정책과 크기 제한은 [썸네일 문서](./thumbnail-ui.md)를 참고한다.

프로젝트·유형 PATCH는 이름 변경 또는 보관 상태 변경 중 하나의 동작만 받는다. 보관된 항목에서는 보관 해제만 허용한다. 유형 복구도 상위 프로젝트가 활성 상태여야 한다. PATCH 입력이 비어 있거나 허용하지 않은 필드 조합이면 422를 반환한다.

프로젝트·유형 페이지는 `updated_at DESC, id DESC`, 레퍼런스는 `created_at DESC, id DESC`로 정렬한다. `limit`은 1~100, `offset`은 0 이상 정수로 검증한다. 페이지 응답은 `{items, total, limit, offset}`이다. 목록과 count는 동일 소유권·보관 필터를 적용한다. 동시 추가 시 offset 페이지가 달라질 수 있으므로 이 MVP는 특정 시점 목록 스냅샷을 보장하지 않는다.

### 저장 요청과 응답 예시

```json
{
  "project_id": "10c05a6f-b0cf-46bb-af74-947163f90498",
  "deliverable_type_id": "3e81c310-0faf-42de-908e-78c31a6b8651",
  "source_url": "https://example.com/design?view=full#hero",
  "title": "여백을 활용한 랜딩 페이지",
  "description": null,
  "design_note": "큰 제목과 여백을 참고"
}
```

```json
{
  "id": "1d81c310-0faf-42de-908e-78c31a6b8651",
  "project_id": "10c05a6f-b0cf-46bb-af74-947163f90498",
  "project_name": "브랜드 리뉴얼",
  "deliverable_type_id": "3e81c310-0faf-42de-908e-78c31a6b8651",
  "deliverable_type_name": "웹사이트",
  "source_url": "https://example.com/design?view=full#hero",
  "title": "여백을 활용한 랜딩 페이지",
  "description": null,
  "design_note": "큰 제목과 여백을 참고",
  "read_only": false,
  "created_at": "2026-10-29T00:00:00Z",
  "updated_at": "2026-10-29T00:00:00Z"
}
```

프로젝트·유형 응답은 테이블의 공개 필드를 반환하며 owner_id는 생략한다. 유형 응답은 project_id, project_name, read_only를 포함한다. 상세·목록 레퍼런스도 위와 같은 경로와 read_only를 포함한다. read_only는 해당 유형 또는 상위 프로젝트가 보관된 경우 true다.

## 트랜잭션·보관·마지막 경로

레퍼런스 생성과 마지막 저장 경로 갱신은 하나의 DB 트랜잭션으로 커밋한다. 실패 시 둘 다 롤백한다. 환경설정의 행이 없으면 생성하며 첫 저장 동시 요청에서도 owner_id 유일성 충돌로 사용자 저장이 실패하지 않도록 upsert를 처리한다.

`GET /preferences`는 `{last_path: {project_id, deliverable_type_id}}` 또는 `{last_path: null}`을 반환한다. 현재 계정의 경로가 아니거나 상위 프로젝트·유형이 보관된 경우 null이다. 새로 선택했다고 갱신하지 않고 저장 성공 시에만 갱신한다. 여러 기기에서 저장하면 마지막으로 커밋된 저장의 경로를 사용한다.

보관·저장·메모 수정은 같은 프로젝트 행을 먼저 잠그고 그다음 유형 행을 확인하는 순서를 사용한다. PostgreSQL에서 보관과 신규 저장이 경합해도 선행 트랜잭션 결과를 확인한 뒤 처리한다. SQLite의 쓰기 직렬화와 잠금 차이는 별도로 테스트한다. 프로젝트·유형 보관은 하위 데이터를 변경하거나 삭제하지 않는다.

Phase 2의 메모 동시 수정은 마지막 커밋이 적용되는 방식으로 시작한다. 충돌 비교·버전 복구는 제공하지 않으며, 수정 화면은 저장 성공 후 서버 값을 다시 표시한다.

## 권한과 오류

모든 조회·변경은 소유 프로젝트까지 join해 인증 사용자 조건을 적용한다. 다른 사용자의 식별자와 존재하지 않는 식별자는 같은 404를 반환한다. 저장 요청은 프로젝트와 유형 각각의 접근 권한을 먼저 확인한 뒤 둘의 관계를 검증한다. UUID 추측이나 목록 응답만으로 권한을 판단하지 않는다.

| HTTP | 코드 | 화면 처리 |
|---|---|---|
| 401 | `AUTH_REQUIRED` | 세션 갱신 후 복구되지 않으면 로그인 이동 |
| 404 | `NOT_FOUND` | 항목 없음 안내, 프로젝트 목록 복귀 |
| 409 | `ARCHIVED_PATH` | 입력 유지, 다른 활성 경로 선택 안내 |
| 422 | `VALIDATION_ERROR` | 필드 오류 표시 |
| 422 | `PATH_MISMATCH` | 선택한 프로젝트의 유형을 다시 선택 |
| 503 | `SERVICE_UNAVAILABLE` | 입력 유지, 잠시 후 재시도 안내 |
| 500 | `INTERNAL_ERROR` | 일반 실패 안내, 내부 상세 노출 금지 |

Phase 2 API의 오류 형식은 `{detail: {code, message, fields: [{field, message}]}}`로 통일한다. 기존 Auth 의존성의 문자열 detail과 FastAPI의 기본 검증 오류는 API 경계에서 변환한다. 기존 health 응답은 유지한다. 필드 오류에 입력 원문·토큰을 그대로 포함하지 않는다.

저장 요청은 네트워크 오류만으로 자동 재전송하지 않는다. 응답이 끊기면 “저장 여부를 확인하지 못했습니다. 목록에서 확인한 뒤 다시 시도해 주세요”를 표시한다. UI 중복 클릭 방지는 제공하지만 정확히 한 번 저장 보장은 하지 않는다. 같은 URL의 의도적 중복 저장을 허용하는 정책과 구분한다.

## 구현 묶음과 수용 기준

| 순서 | 구현 묶음 | 검증 기준 |
|---|---|---|
| 1 | 화면 시안·React 탐색 | 로그인과 5개 주요 화면, 빈 상태·오류·모바일 배치 확인 |
| 2 | 모델·Alembic·프로젝트·유형 | 생성·이름 변경·보관·복구와 계정 격리 |
| 3 | URL 저장·조회·메모·환경설정 | 선택 필드 없이 저장, URL 보존, 메모 비우기, 마지막 경로 동기화 |
| 4 | 인증·React API 연결 | 실제 토큰으로 전체 흐름, 새로고침·직접 진입·로그아웃 |
| 5 | PostgreSQL·브라우저 검증 | 같은 시나리오를 로컬 PostgreSQL과 Chrome·Edge에서 통과 |

SQLite와 PostgreSQL 모두에서 다음을 검증한다: 다른 계정의 프로젝트·유형·레퍼런스 조회 및 수정 거부, 프로젝트·유형 불일치 거부, 보관 중 읽기 허용·쓰기 거부, 저장 실패의 트랜잭션 롤백, 프로젝트 복구 시 개별 유형 보관 유지. PostgreSQL에서는 보관·저장 경합도 검증한다.

React 흐름 검증은 프로젝트 생성 → 유형 생성 → URL만 저장 → 재조회 → 메모 추가·수정·비우기 → 새 세션 조회를 포함한다. 저장 실패 후 성공 알림이 나타나지 않는지, 다른 계정 로그인 시 이전 초안과 데이터가 사라지는지도 확인한다.
