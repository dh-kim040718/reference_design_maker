from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import Field

from app.api.schemas import Input
from app.auth.dependencies import bearer_scheme, get_auth_http_client
from app.core.settings import Settings, get_settings

router = APIRouter(prefix="/api/v1/auth")


class Login(Input):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=1024)

    # Password whitespace is significant.
    model_config = {"extra": "forbid", "str_strip_whitespace": False}


class Refresh(Input):
    refresh_token: str = Field(min_length=1, max_length=8192)


class Signup(Login):
    email: str = Field(max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=1024)


@router.post("/signup", status_code=201)
async def signup(
    body: Signup,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[httpx.AsyncClient, Depends(get_auth_http_client)],
):
    response.headers["Cache-Control"] = "no-store"
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(503, "인증 서비스 설정을 확인해 주세요.")
    try:
        result = await client.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/signup",
            headers={"apikey": settings.supabase_anon_key},
            json=body.model_dump(),
        )
    except httpx.RequestError as error:
        raise HTTPException(503, "인증 서비스에 연결할 수 없습니다.") from error
    if result.status_code == 429:
        raise HTTPException(429, "요청이 많습니다. 잠시 후 다시 시도해 주세요.")
    if result.status_code in (400, 401, 403, 422):
        raise HTTPException(
            422, "가입할 수 없습니다. 이메일과 비밀번호를 확인하거나 로그인해 주세요."
        )
    if result.status_code not in (200, 201):
        raise HTTPException(503, "회원가입을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.")
    try:
        payload = result.json()
    except ValueError as error:
        raise HTTPException(502, "인증 응답을 확인할 수 없습니다.") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("user", payload), dict):
        raise HTTPException(502, "인증 응답을 확인할 수 없습니다.")
    keys = ("access_token", "refresh_token", "expires_in", "user")
    session = {key: payload[key] for key in keys} if all(payload.get(key) for key in keys) else None
    return {
        "session": session,
        "message": "가입 이메일로 확인 링크가 전송되었다면 링크를 연 뒤 로그인해 주세요.",
    }


async def exchange(grant: str, body: dict, settings: Settings, client: httpx.AsyncClient):
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(503, "인증 서비스 설정을 확인해 주세요.")
    try:
        result = await client.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/token",
            params={"grant_type": grant},
            headers={"apikey": settings.supabase_anon_key},
            json=body,
        )
    except httpx.RequestError as error:
        raise HTTPException(503, "인증 서비스에 연결할 수 없습니다.") from error
    if result.status_code in (400, 401, 403, 422):
        raise HTTPException(401, "로그인 정보가 올바르지 않거나 세션이 만료되었습니다.")
    if result.status_code != 200:
        raise HTTPException(503, "잠시 후 다시 로그인해 주세요.")
    try:
        payload = result.json()
    except ValueError as error:
        raise HTTPException(502, "인증 응답을 확인할 수 없습니다.") from error
    if not isinstance(payload, dict) or not all(
        key in payload for key in ("access_token", "refresh_token", "expires_in", "user")
    ):
        raise HTTPException(502, "인증 응답을 확인할 수 없습니다.")
    return {key: payload[key] for key in ("access_token", "refresh_token", "expires_in", "user")}


@router.post("/login")
async def login(
    body: Login,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[httpx.AsyncClient, Depends(get_auth_http_client)],
):
    response.headers["Cache-Control"] = "no-store"
    return await exchange("password", body.model_dump(), settings, client)


@router.post("/refresh")
async def refresh(
    body: Refresh,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[httpx.AsyncClient, Depends(get_auth_http_client)],
):
    response.headers["Cache-Control"] = "no-store"
    return await exchange("refresh_token", body.model_dump(), settings, client)


@router.post("/logout", status_code=204)
async def logout(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[httpx.AsyncClient, Depends(get_auth_http_client)],
):
    if credentials is None:
        raise HTTPException(401, "다시 로그인해 주세요.")
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(503, "인증 서비스 설정을 확인해 주세요.")
    try:
        result = await client.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/logout",
            params={"scope": "local"},
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": f"Bearer {credentials.credentials}",
            },
        )
    except httpx.RequestError as error:
        raise HTTPException(503, "인증 서비스에 연결할 수 없습니다.") from error
    if result.status_code not in (200, 204, 401, 403):
        raise HTTPException(503, "서버에서 로그아웃하지 못했습니다. 다시 시도해 주세요.")
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
