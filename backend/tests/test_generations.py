import base64
import io
from uuid import uuid4

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr
from test_library import library_client as library_client  # noqa: F401
from test_library import owner as owner  # noqa: F401
from test_library import postgres_engine as postgres_engine  # noqa: F401
from test_library import save, setup_path

from app.api import generation_provider, generations
from app.api.generation_provider import ProviderFailure, get_image_provider, marked_result
from app.auth.dependencies import AuthenticatedUser, get_current_user
from app.core.settings import Settings


def image():
    output = io.BytesIO()
    Image.new("RGB", (100, 100), "green").save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


@pytest.fixture
def generation(library_client, owner, monkeypatch):
    settings = Settings(_env_file=None, image_generation_enabled=True,
                        generation_budget_usd="10",
                        openai_api_key=SecretStr("test-key-never-real"))
    monkeypatch.setattr(generations, "get_settings", lambda: settings)
    calls = []

    def provider(source, prompt, safety):
        calls.append((source, prompt, safety))
        return marked_result(image().split(",")[1]), {"total_tokens": 100}

    library_client.app.dependency_overrides[get_image_provider] = lambda: provider
    project, kind = setup_path(library_client)
    ref = save(library_client, project, kind).json()
    return library_client, ref, calls, settings


def payload(**extra):
    return {"request_id": str(uuid4()), "source_image": image(), "rights_confirmed": True,
            **extra}


def test_private_generation_empty_memo_idempotency_and_delete(generation, owner):
    client, ref, calls, _ = generation
    url = f"/api/v1/references/{ref['id']}/generations"
    data = payload()
    created = client.post(url, json=data)
    assert created.status_code == 202, created.text
    job = created.json()
    assert "source_image" not in job and "result_image" not in job
    assert client.post(url, json=data).json()["id"] == job["id"]
    assert len(calls) == 1 and calls[0][0] == image()
    assert "full reference image" in calls[0][1]
    changed = client.post(url, json={**data, "instruction": "changed"})
    assert changed.status_code == 409
    result_url = f"/api/v1/generations/{job['id']}"
    result = client.get(result_url)
    assert result.headers["cache-control"] == "no-store"
    assert result.json()["status"] == "succeeded"
    assert result.json()["usage"] == {"total_tokens": 100}
    assert result.json()["elapsed_ms"] >= 0
    assert result.json()["result_image"].startswith("data:image/png;")
    client.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=uuid4())
    assert client.get(result_url).status_code == 404
    assert client.get(url).status_code == 404
    assert client.delete(result_url).status_code == 404
    client.app.dependency_overrides[get_current_user] = lambda: owner
    assert client.delete(result_url).status_code == 204
    assert client.get(result_url).status_code == 404
    assert client.get(url).json()["items"] == []
    assert client.post(url, json=data).json()["id"] == job["id"]
    assert len(calls) == 1
    assert client.get("/api/v1/generation-policy").json()["remaining"] == 2


def test_disabled_invalid_rights_archived_and_quota(generation):
    client, ref, calls, settings = generation
    url = f"/api/v1/references/{ref['id']}/generations"
    settings.image_generation_enabled = False
    assert client.post(url, json=payload()).status_code == 503
    assert not client.get("/api/v1/generation-policy").json()["enabled"]
    settings.image_generation_enabled = True
    settings.openai_api_key = None
    assert client.post(url, json=payload()).status_code == 503
    settings.openai_api_key = SecretStr("fake")
    assert client.post(url, json=payload(rights_confirmed=False)).status_code == 422
    invalid = payload(source_image="data:image/png;base64,ZmFrZQ==")
    assert client.post(url, json=invalid).status_code == 422
    assert not calls
    for _ in range(3):
        assert client.post(url, json=payload()).status_code == 202
    assert client.post(url, json=payload()).status_code == 429
    assert len(calls) == 3
    assert "test-key" not in client.get("/api/v1/generation-policy").text
    client.patch(f"/api/v1/projects/{ref['project_id']}", json={"archived": True})
    assert client.post(url, json=payload()).status_code == 409


@pytest.mark.parametrize("code,status", [("OUTCOME_UNKNOWN", "unknown"),
                                         ("PROVIDER_REJECTED", "failed")])
def test_provider_failures_are_not_retried(generation, code, status):
    client, ref, _, _ = generation
    calls = []

    def provider(*args):
        calls.append(1)
        raise ProviderFailure(code)

    client.app.dependency_overrides[get_image_provider] = lambda: provider
    url = f"/api/v1/references/{ref['id']}/generations"
    data = payload()
    job = client.post(url, json=data).json()
    result = client.get(f"/api/v1/generations/{job['id']}").json()
    assert result["status"] == status and result["result_image"] is None
    client.post(url, json=data)
    assert calls == [1]


def test_provider_contract_without_network(monkeypatch):
    import json

    calls = []

    def handle(request):
        calls.append(request)
        assert request.url == "https://api.openai.com/v1/images/edits"
        data = json.loads(request.content)
        assert data["images"] == [{"image_url": image()}]
        assert data["n"] == 1 and data["quality"] == "low"
        assert request.headers["authorization"] == "Bearer fake"
        return httpx.Response(200, json={"data": [{"b64_json": image().split(",")[1]}]})

    original_client = httpx.Client
    monkeypatch.setattr(generation_provider, "get_settings", lambda: Settings(
        _env_file=None, openai_api_key=SecretStr("fake")))
    monkeypatch.setattr(generation_provider.httpx, "Client", lambda **kwargs: original_client(
        transport=httpx.MockTransport(handle), **kwargs))
    result, usage = generation_provider.generate_image(image(), "prompt", "hash")
    assert result.startswith("data:image/png;") and len(calls) == 1
    assert usage == {}
