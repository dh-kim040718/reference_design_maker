# OpenAI API 키 설정

## 키 입력 위치

프로젝트 루트에 있는 `.env` 파일의 `OPENAI_API_KEY` 값에 키를 입력합니다.

1. 프로젝트 루트에서 PowerShell을 엽니다.
2. 예시 환경 파일을 복사합니다:

   ```powershell
   Copy-Item .env.example .env
   ```

3. `.env`를 열고 다음처럼 키를 입력합니다:

   ```dotenv
   OPENAI_API_KEY=여기에_발급한_API_키
   ```

실제 키를 채팅, 코드, 커밋된 파일, 스크린샷에 붙여넣지 마세요. `.env`는 Git에서 제외되도록 설정되어 있습니다. 공유한 적이 있는 키는 OpenAI 대시보드에서 폐기하고 새 키를 발급하세요.

## 키 발급

OpenAI Platform에서 API 키를 만들고, API 결제 및 사용 한도를 확인하세요. ChatGPT 구독과 API 요금은 별도입니다.

- [API 키 관리](https://platform.openai.com/api-keys)
- [API 요금](https://developers.openai.com/api/docs/pricing)

키 값은 다시 확인할 수 없을 수 있으므로 발급 직후 비밀 관리 도구에 안전하게 저장하세요.

## 현재 구현 상태

기술 구성은 React 프론트엔드와 FastAPI 백엔드로 정했습니다. 이 저장소에는 아직 애플리케이션 서버나 환경 변수 로더가 없으므로, `.env` 파일에 키가 있어도 현재는 API 요청이 실행되지 않습니다. 구현 시 `OPENAI_API_KEY`는 FastAPI 서버 환경에서만 읽고, React 브라우저 코드나 클라이언트 환경 변수에 넣지 않아야 합니다.

개발 환경에서 `.env`를 읽는 방식은 FastAPI 기반 구조를 만들 때 설정 문서와 함께 구현합니다. 운영 환경에서는 호스팅 플랫폼의 서버 측 비밀 환경 변수를 사용합니다.

## 커밋 전 확인

다음 명령으로 실제 키 파일이 Git 추적 대상이 아닌지 확인할 수 있습니다.

```powershell
git check-ignore .env
```

`.env`가 출력되면 무시 규칙이 적용된 것입니다. 반면 `.env.example`은 비밀 값을 포함하지 않으며 저장소에 공유하는 설정 안내용 템플릿입니다.
