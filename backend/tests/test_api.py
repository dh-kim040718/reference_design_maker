from collections.abc import AsyncIterator, Callable
from uuid import UUID

import httpx

from app.auth.dependencies import get_auth_http_client
from app.core.settings import Settings, get_settings


def configure_auth(
    client,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    async def provide_auth_client() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as auth_client:
            yield auth_client

    client.app.dependency_overrides[get_auth_http_client] = provide_auth_client
    client.app.dependency_overrides[get_settings] = lambda: Settings(
        supabase_url="http://127.0.0.1:54321",
        supabase_anon_key="local-anon-key",
    )


def test_health_returns_ok(client) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_uses_database_session(client) -> None:
    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_me_requires_authentication(client) -> None:
    response = client.get("/api/v1/me")

    assert response.status_code == 401


def test_me_returns_supabase_verified_user(client) -> None:
    user_id = UUID("a4472434-19bf-4ded-a6fc-e5df59aaed87")

    def auth_response(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/auth/v1/user"
        assert request.headers["apikey"] == "local-anon-key"
        assert request.headers["authorization"] == "Bearer test-access-token"
        return httpx.Response(
            200,
            json={"id": str(user_id), "email": "user@example.com"},
        )

    configure_auth(client, auth_response)

    response = client.get(
        "/api/v1/me",
        headers={"Authorization": "Bearer test-access-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": str(user_id),
        "email": "user@example.com",
    }


def test_me_rejects_token_supabase_does_not_accept(client) -> None:
    configure_auth(client, lambda _: httpx.Response(401))

    response = client.get(
        "/api/v1/me",
        headers={"Authorization": "Bearer expired-token"},
    )

    assert response.status_code == 401
