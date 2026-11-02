import json

import httpx
import pytest
from pydantic import SecretStr
from test_editing import mask
from test_generations import image

from app.api import editing, generation_provider
from app.core.settings import Settings


def test_real_edit_adapter_contract_without_network(monkeypatch):
    calls = []

    def handle(request):
        calls.append(1)
        data = json.loads(request.content)
        assert data["mask"] == {"image_url": mask()}
        assert data["images"] == [{"image_url": image()}]
        assert data["quality"] == "low" and data["n"] == 1
        assert data["model"] == generation_provider.MODEL
        return httpx.Response(200, json={"data": [{"b64_json": image().split(",")[1]}],
                                         "usage": {"total_tokens": 100}})

    original = httpx.Client
    monkeypatch.setattr(generation_provider, "get_settings", lambda: Settings(
        _env_file=None, openai_api_key=SecretStr("offline-test-key")))
    monkeypatch.setattr(generation_provider.httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handle), **kwargs))
    result, usage = generation_provider.edit_image(image(), mask(), "edit prompt", "hash")
    assert result.startswith("data:image/png;") and usage == {"total_tokens": 100}
    assert calls == [1]


@pytest.mark.parametrize("enabled,key,available", [(False, "test", False),
                                                  (True, None, False), (True, "test", True)])
def test_edit_provider_requires_explicit_enable_and_key(monkeypatch, enabled, key, available):
    monkeypatch.setattr(editing, "get_settings", lambda: Settings(
        _env_file=None, image_editing_enabled=enabled,
        openai_api_key=SecretStr(key) if key else None))
    assert (editing.get_edit_provider() is not None) == available
