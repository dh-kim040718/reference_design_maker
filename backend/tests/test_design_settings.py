import base64
import io

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr, ValidationError
from test_generations import generation, image  # noqa: F401
from test_library import library_client, owner, postgres_engine  # noqa: F401
from test_project_concepts import request_data
from test_project_concepts import synthesis as synthesis  # noqa: F401

from app.api import generation_provider
from app.api.design_settings import DesignSettings, native_dimensions
from app.core.settings import Settings


@pytest.mark.parametrize(
    "unit,width,height,ppi,expected",
    [
        ("px", 393, 852, 300, (393, 852)),
        ("mm", 210, 297, 300, (2480, 3508)),
        ("cm", 21, 29.7, 300, (2480, 3508)),
        ("in", 2, 3, 300, (600, 900)),
        ("pt", 144, 216, 300, (600, 900)),
    ],
)
def test_dimensions_convert_to_pixels(unit, width, height, ppi, expected):
    settings = DesignSettings(unit=unit, width=width, height=height, ppi=ppi)
    assert settings.pixels() == expected
    gw, gh = native_dimensions(*expected)
    assert gw % 16 == gh % 16 == 0 and max(gw, gh) <= 3840
    assert 655360 <= gw * gh <= 8294400 and 1 / 3 <= gw / gh <= 3


@pytest.mark.parametrize(
    "values",
    [
        {"width": 0},
        {"width": 393.5},
        {"width": 10000},
        {"width": 4000, "height": 500},
        {"ppi": 0},
        {"purpose": "unknown"},
        {"purpose": "other"},
        {"unit": "mm", "width": 1000, "height": 1000, "ppi": 600},
    ],
)
def test_invalid_dimensions_are_rejected(values):
    with pytest.raises(ValidationError):
        DesignSettings(**values)


def test_settings_reach_provider_and_exact_export_and_cannot_change_on_retry(synthesis):
    client, project_id, _, _, calls, _ = synthesis
    payload = request_data(client, project_id)
    payload["design_settings"] = {
        "purpose": "mobile_ui",
        "width": 393,
        "height": 852,
        "unit": "px",
        "ppi": 300,
    }
    endpoint = f"/api/v1/projects/{project_id}/generations"
    response = client.post(endpoint, json=payload)
    assert response.status_code == 202, response.text
    job = client.get(f"/api/v1/generations/{response.json()['id']}").json()
    assert job["status"] == "succeeded"
    settings = job["project_snapshot"]["design_settings"]
    assert settings["pixel_width"] == 393 and settings["pixel_height"] == 852
    assert "mobile_ui" in calls[0][1] and "393" in calls[0][1]
    with Image.open(io.BytesIO(base64.b64decode(job["result_image"].split(",")[1]))) as result:
        assert result.size == (393, 852)
        assert result.info["dpi"][0] == pytest.approx(300, abs=0.1)
    payload["design_settings"]["width"] = 400
    assert client.post(endpoint, json=payload).status_code == 409
    assert len(calls) == 1


def test_custom_size_reaches_http_provider_and_resets_for_next_call(monkeypatch):
    seen = []

    def handle(request):
        import json

        seen.append(json.loads(request.content)["size"])
        return httpx.Response(200, json={"data": [{"b64_json": image().split(",")[1]}]})

    original = httpx.Client
    monkeypatch.setattr(
        generation_provider,
        "get_settings",
        lambda: Settings(_env_file=None, openai_api_key=SecretStr("offline-fake-key")),
    )
    monkeypatch.setattr(
        generation_provider.httpx,
        "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    with generation_provider.generation_size("560x1216"):
        generation_provider.generate_project([image()], "test", "test")
    generation_provider.generate_project([image()], "test", "test")
    assert seen == ["560x1216", "1024x1024"]


def test_large_output_does_not_raise_the_reference_upload_limit():
    import random

    from app.api.generation_provider import MAX_RESULT, ProviderFailure, decode_image

    buffer = io.BytesIO()
    Image.frombytes("RGB", (1800, 1800), random.Random(42).randbytes(1800 * 1800 * 3)).save(
        buffer, format="PNG"
    )
    data = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
    assert len(buffer.getvalue()) > 8 * 1024 * 1024
    with pytest.raises(ProviderFailure):
        decode_image(data)
    assert decode_image(data, max_bytes=MAX_RESULT) == buffer.getvalue()
