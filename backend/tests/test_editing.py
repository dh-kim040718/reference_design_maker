import base64
import io
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from PIL import Image, ImageDraw
from pydantic import SecretStr
from sqlalchemy.orm import Session
from test_generations import generation as generation  # noqa: F401
from test_generations import image, payload
from test_library import library_client as library_client  # noqa: F401
from test_library import owner as owner  # noqa: F401
from test_library import postgres_engine as postgres_engine  # noqa: F401

from app.api.editing import get_edit_provider
from app.api.generation_provider import ProviderFailure, marked_result
from app.auth.dependencies import AuthenticatedUser, get_current_user
from app.db.models import Generation, now
from app.db.session import get_db


def mask(size=(100, 100), alpha=True, selected=True, offset=10):
    canvas = Image.new("RGBA" if alpha else "RGB", size, "white")
    if alpha and selected:
        ImageDraw.Draw(canvas).rectangle((offset, offset, 39, 39), fill=(255, 255, 255, 0))
    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


@pytest.fixture
def editing(generation):
    client, ref, _, settings = generation
    settings.image_editing_enabled = True
    settings.openai_api_key = None  # Offline provider does not require a real or fake API key.
    calls = []

    def provider(*args):
        calls.append(args)
        return marked_result(image().split(",")[1]), {"total_tokens": 12}

    client.app.dependency_overrides[get_edit_provider] = lambda: provider
    return client, ref, calls, settings


def edit_payload(**extra):
    return {**payload(mask_image=mask(), direction="Keep the sidebar and orange accents"), **extra}


def test_edit_lifecycle_and_private_history_without_api_key(editing, owner):
    client, ref, calls, _ = editing
    url = f"/api/v1/references/{ref['id']}/edits"
    data = edit_payload(instruction="Increase spacing")
    assert client.get("/api/v1/generation-policy").json()["editing_enabled"]
    created = client.post(url, json=data)
    assert created.status_code == 202, created.text
    job_id = created.json()["id"]
    path = f"/api/v1/generations/{job_id}"
    detail = client.get(path)
    assert detail.headers["cache-control"] == "no-store"
    result = detail.json()
    assert result["status"] == "succeeded" and result["operation"] == "edit"
    assert result["direction"] == data["direction"] and result["usage"]["total_tokens"] == 12
    assert "source_image" not in result and "mask_image" not in result
    assert len(calls) == 1 and calls[0][:2] == (data["source_image"], data["mask_image"])
    assert "Existing design direction: Keep the sidebar" in calls[0][2]
    assert "Local edit instruction: Increase spacing" in calls[0][2]
    history = client.get(f"/api/v1/references/{ref['id']}/generations").json()["items"]
    assert history[0]["operation"] == "edit" and "result_image" not in history[0]
    assert client.post(url, json=data).json()["id"] == job_id
    assert len(calls) == 1
    client.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=uuid4())
    assert client.get(path).status_code == 404
    assert client.delete(path).status_code == 404
    assert client.post(url, json=edit_payload()).status_code == 404
    client.app.dependency_overrides[get_current_user] = lambda: owner
    assert client.delete(path).status_code == 204
    assert client.get(path).status_code == 404
    assert client.post(url, json=data).json()["id"] == job_id
    assert len(calls) == 1


@pytest.mark.parametrize("invalid", [mask((50, 50)), mask(alpha=False), mask(selected=False),
                                     "data:image/png;base64,aW52YWxpZA=="])
def test_invalid_masks_never_reserve_or_call(editing, invalid):
    client, ref, calls, _ = editing
    assert client.post(f"/api/v1/references/{ref['id']}/edits",
                       json=edit_payload(mask_image=invalid)).status_code == 422
    assert not calls
    assert client.get("/api/v1/generation-policy").json()["remaining"] == 3


def test_changed_mask_direction_and_operation_conflict(editing):
    client, ref, calls, _ = editing
    url = f"/api/v1/references/{ref['id']}/edits"
    data = edit_payload()
    assert client.post(url, json=data).status_code == 202
    for changed in ({"direction": "changed"}, {"mask_image": mask(offset=20)},
                    {"instruction": "changed"}):
        response = client.post(url, json={**data, **changed})
        assert response.status_code == 409
    normal = {key: value for key, value in data.items() if key not in {"mask_image", "direction"}}
    normal_url = f"/api/v1/references/{ref['id']}/generations"
    assert client.post(normal_url, json=normal).status_code == 409
    assert len(calls) == 1


@pytest.mark.parametrize("code,status", [("OUTCOME_UNKNOWN", "unknown"),
                                         ("PROVIDER_REJECTED", "failed")])
def test_edit_error_is_not_retried_and_counts_against_shared_limit(editing, code, status):
    client, ref, calls, _ = editing

    def reject(*args):
        calls.append(args)
        raise ProviderFailure(code)

    client.app.dependency_overrides[get_edit_provider] = lambda: reject
    url = f"/api/v1/references/{ref['id']}/edits"
    data = edit_payload()
    job = client.post(url, json=data).json()
    result = client.get(f"/api/v1/generations/{job['id']}").json()
    assert result["status"] == status and result["result_image"] is None
    assert client.post(url, json=data).json()["id"] == job["id"]
    assert len(calls) == 1
    for _ in range(2):
        assert client.post(url, json=edit_payload()).status_code == 202
    assert client.post(url, json=edit_payload()).status_code == 429
    assert len(calls) == 3


def test_generation_and_edit_share_daily_reservations(editing):
    client, ref, _, settings = editing
    settings.openai_api_key = SecretStr("offline-test-only")
    normal_url = f"/api/v1/references/{ref['id']}/generations"
    edit_url = f"/api/v1/references/{ref['id']}/edits"
    assert client.post(normal_url, json=payload()).status_code == 202
    assert client.post(edit_url, json=edit_payload()).status_code == 202
    assert client.post(normal_url, json=payload()).status_code == 202
    assert client.post(edit_url, json=edit_payload()).status_code == 429


def test_edit_gate_rights_archive_and_missing_provider(editing):
    client, ref, calls, settings = editing
    url = f"/api/v1/references/{ref['id']}/edits"
    settings.image_editing_enabled = False
    assert client.post(url, json=edit_payload()).status_code == 503
    settings.image_editing_enabled = True
    client.app.dependency_overrides[get_edit_provider] = lambda: None
    assert not client.get("/api/v1/generation-policy").json()["editing_enabled"]
    assert client.post(url, json=edit_payload()).status_code == 503
    assert client.post(url, json=edit_payload(rights_confirmed=False)).status_code == 422
    client.patch(f"/api/v1/projects/{ref['project_id']}", json={"archived": True})
    assert client.post(url, json=edit_payload()).status_code == 409
    assert not calls


def test_edit_active_and_stale_state(editing):
    client, ref, _, _ = editing
    override = client.app.dependency_overrides.get(get_db)
    if override:
        session = next(override())
        bind = session.get_bind()
    else:
        # SQLite client fixture captures its engine in the get_db override.
        raise AssertionError("Expected isolated database override")
    url = f"/api/v1/references/{ref['id']}/edits"
    job = client.post(url, json=edit_payload()).json()
    with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
        row = db.get(Generation, UUID(job["id"]))
        row.status = "processing"
        row.updated_at = now()
        db.commit()
    assert client.post(url, json=edit_payload()).status_code == 409
    with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
        row = db.get(Generation, UUID(job["id"]))
        row.updated_at = now() - timedelta(minutes=6)
        db.commit()
    assert client.get(f"/api/v1/generations/{job['id']}").json()["status"] == "unknown"
