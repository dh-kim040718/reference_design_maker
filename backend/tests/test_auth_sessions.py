import httpx

from tests.test_api import configure_auth


def test_signup_returns_session_when_confirmation_is_not_required(client):
    def provider(request):
        assert request.url.path == "/auth/v1/signup"
        return httpx.Response(
            200,
            json={
                "access_token": "access",
                "refresh_token": "refresh",
                "expires_in": 3600,
                "user": {"id": "a4472434-19bf-4ded-a6fc-e5df59aaed87"},
            },
        )

    configure_auth(client, provider)
    response = client.post(
        "/api/v1/auth/signup", json={"email": "new@example.com", "password": "password123"}
    )
    assert response.status_code == 201
    assert response.json()["session"]["access_token"] == "access"
    assert response.headers["cache-control"] == "no-store"


def test_signup_supports_confirmation_and_handles_invalid_input(client):
    configure_auth(client, lambda _: httpx.Response(200, json={"id": "new-user"}))
    response = client.post(
        "/api/v1/auth/signup", json={"email": "new@example.com", "password": "password123"}
    )
    assert response.status_code == 201
    assert response.json()["session"] is None
    assert "이메일" in response.json()["message"]
    assert (
        client.post(
            "/api/v1/auth/signup", json={"email": "invalid", "password": "short"}
        ).status_code
        == 422
    )


def test_signup_failure_does_not_expose_provider_response(client):
    configure_auth(client, lambda _: httpx.Response(422, json={"message": "private details"}))
    response = client.post(
        "/api/v1/auth/signup", json={"email": "new@example.com", "password": "password123"}
    )
    assert response.status_code == 422
    assert "private details" not in response.text


def test_login_and_refresh_do_not_return_provider_secrets(client):
    def provider(request):
        assert request.url.path == "/auth/v1/token"
        assert request.url.params["grant_type"] in {"password", "refresh_token"}
        return httpx.Response(
            200,
            json={
                "access_token": "access",
                "refresh_token": "refresh",
                "expires_in": 3600,
                "user": {"id": "a4472434-19bf-4ded-a6fc-e5df59aaed87"},
                "provider_token": "private",
            },
        )

    configure_auth(client, provider)
    result = client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "pw"})
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    assert "provider_token" not in result.json()
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": "refresh"}).status_code == 200


def test_login_failure_and_validation_do_not_echo_password(client):
    configure_auth(client, lambda _: httpx.Response(400, json={"message": "provider detail"}))
    result = client.post(
        "/api/v1/auth/login", json={"email": "a@example.com", "password": "secret-password"}
    )
    assert result.status_code == 401
    assert "provider detail" not in result.text
    invalid = client.post(
        "/api/v1/auth/login", json={"email": "a", "password": "secret-password", "extra": "secret"}
    )
    assert invalid.status_code == 422
    assert "secret-password" not in invalid.text


def test_logout_revokes_only_current_supabase_session(client):
    def provider(request):
        assert request.url.path == "/auth/v1/logout"
        assert request.url.params["scope"] == "local"
        assert request.headers["authorization"] == "Bearer access"
        return httpx.Response(204)

    configure_auth(client, provider)
    assert client.post("/api/v1/auth/logout").status_code == 401
    assert (
        client.post("/api/v1/auth/logout", headers={"Authorization": "Bearer access"}).status_code
        == 204
    )


def test_provider_failure_is_safe_and_retryable(client):
    configure_auth(client, lambda _: httpx.Response(500, text="private service details"))
    result = client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "pw"})
    assert result.status_code == 503
    assert "private service details" not in result.text
