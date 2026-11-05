import base64
import io
import json
from uuid import uuid4

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr
from test_generations import generation as generation  # noqa: F401
from test_generations import image
from test_library import library_client as library_client  # noqa: F401
from test_library import owner as owner  # noqa: F401
from test_library import postgres_engine as postgres_engine  # noqa: F401
from test_library import save

from app.api import generation_provider, project_concepts
from app.api.generation_provider import get_project_provider, marked_result
from app.auth.dependencies import AuthenticatedUser, get_current_user
from app.core.settings import Settings


@pytest.fixture
def synthesis(generation):
    client, ref, _, settings = generation
    project_id = ref["project_id"]
    client.patch(f"/api/v1/projects/{project_id}/brief", json={"brief": "Logistics dashboard"})
    client.patch(f"/api/v1/references/{ref['id']}", json={"design_note": "Use this layout"})
    kind = client.post(
        f"/api/v1/projects/{project_id}/deliverable-types", json={"name": "Charts"}
    ).json()
    second = save(
        client,
        {"id": project_id},
        kind,
        design_note="Use this chart style",
        title="Chart reference",
    ).json()
    client.patch(f"/api/v1/deliverable-types/{kind['id']}", json={"archived": True})
    calls = []

    def provider(images, prompt, safety):
        calls.append((images, prompt, safety))
        return marked_result(image().split(",")[1]), {"total_tokens": 200}

    client.app.dependency_overrides[get_project_provider] = lambda: provider
    return client, project_id, ref, second, calls, settings


def test_remote_thumbnail_is_visible_without_becoming_generation_input(synthesis):
    client, project_id, ref, _, _, _ = synthesis
    url = "https://i.pinimg.com/736x/example.jpg"
    client.patch(
        f"/api/v1/references/{ref['id']}/thumbnail",
        json={"preview_url": url, "preview_source": "page_metadata"},
    )
    context = client.get(f"/api/v1/projects/{project_id}/generation-context").json()
    row = next(row for row in context["references"] if row["id"] == ref["id"])
    assert row["thumbnail_url"] == url
    assert row["preview_url"] is None


def test_classification_generation_includes_all_and_only_its_references(synthesis):
    client, project_id, ref, second, calls, _ = synthesis
    type_id = ref["deliverable_type_id"]
    current = client.get(
        f"/api/v1/projects/{project_id}/generation-context?type_id={type_id}"
    ).json()
    assert [row["id"] for row in current["references"]] == [ref["id"]]
    data = {
        "request_id": str(uuid4()),
        "type_id": type_id,
        "context_digest": current["context_digest"],
        "rights_confirmed": True,
        "sources": [{"reference_id": ref["id"], "image": image()}],
    }
    result = client.post(f"/api/v1/projects/{project_id}/generations", json=data)
    assert result.status_code == 202, result.text
    assert len(calls) == 1 and len(calls[0][0]) == 1
    assert "Use this layout" in calls[0][1] and "Use this chart style" not in calls[0][1]
    assert (
        client.get(
            f"/api/v1/projects/{project_id}/generation-context?type_id={uuid4()}"
        ).status_code
        == 404
    )


def test_current_brief_is_used_and_snapshotted_without_saving_first(synthesis):
    client, project_id, _, _, calls, _ = synthesis
    data = request_data(client, project_id)
    data.update(brief="Current ERP draft", instruction="Prioritize a calm mobile layout")
    created = client.post(f"/api/v1/projects/{project_id}/generations", json=data)
    assert created.status_code == 202, created.text
    detail = client.get(f"/api/v1/generations/{created.json()['id']}").json()
    assert detail["project_snapshot"]["brief"] == "Current ERP draft"
    assert "Current ERP draft" in calls[0][1]
    assert "prioritize the additional request, then project requirements" in calls[0][1]
    data["brief"] = "Changed draft"
    assert client.post(f"/api/v1/projects/{project_id}/generations", json=data).status_code == 409


def test_explicit_reference_selection_excludes_unchecked_notes_and_images(synthesis):
    client, project_id, ref, second, calls, _ = synthesis
    data = request_data(client, project_id)
    data["selected_reference_ids"] = [ref["id"]]
    data["sources"] = [source for source in data["sources"] if source["reference_id"] == ref["id"]]
    result = client.post(f"/api/v1/projects/{project_id}/generations", json=data)
    assert result.status_code == 202, result.text
    assert len(calls[0][0]) == 1 and "Use this chart style" not in calls[0][1]
    snapshot = client.get(f"/api/v1/generations/{result.json()['id']}").json()["project_snapshot"]
    assert snapshot["selected_reference_ids"] == [ref["id"]]
    assert [row["id"] for row in snapshot["references"]] == [ref["id"]]
    data["selected_reference_ids"] = [second["id"]]
    assert client.post(f"/api/v1/projects/{project_id}/generations", json=data).status_code == 409


@pytest.mark.parametrize("selection", [[], ["unknown"], ["duplicate"]])
def test_invalid_or_incomplete_selection_never_calls_provider(synthesis, selection):
    client, project_id, ref, _, calls, _ = synthesis
    data = request_data(client, project_id)
    data["selected_reference_ids"] = (
        []
        if not selection
        else [str(uuid4())]
        if selection == ["unknown"]
        else [ref["id"], ref["id"]]
    )
    assert client.post(f"/api/v1/projects/{project_id}/generations", json=data).status_code == 422
    assert not calls


def request_data(client, project_id):
    context = client.get(f"/api/v1/projects/{project_id}/generation-context").json()
    return {
        "request_id": str(uuid4()),
        "context_digest": context["context_digest"],
        "sources": [{"reference_id": row["id"], "image": image()} for row in context["references"]],
        "rights_confirmed": True,
    }


def test_all_classifications_images_and_notes_are_synthesized_and_snapshotted(synthesis):
    client, project_id, ref, second, calls, _ = synthesis
    path = f"/api/v1/projects/{project_id}/generations"
    data = request_data(client, project_id)
    created = client.post(path, json=data)
    assert created.status_code == 202, created.text
    job_id = created.json()["id"]
    detail = client.get(f"/api/v1/generations/{job_id}").json()
    assert detail["scope"] == "project" and detail["reference_id"] is None
    assert detail["project_id"] == project_id and detail["status"] == "succeeded"
    assert len(calls) == 1 and len(calls[0][0]) == 2
    assert "Logistics dashboard" in calls[0][1]
    assert "Use this layout" in calls[0][1] and "Use this chart style" in calls[0][1]
    snapshot = detail["project_snapshot"]
    assert {row["id"] for row in snapshot["references"]} == {ref["id"], second["id"]}
    assert all("preview_url" not in row and "image" not in row for row in snapshot["references"])
    assert any(row["archived_type"] for row in snapshot["references"])
    client.patch(f"/api/v1/references/{ref['id']}", json={"design_note": "Changed later"})
    assert client.post(path, json=data).json()["id"] == job_id
    assert len(calls) == 1
    assert client.get(f"/api/v1/generations/{job_id}").json()["project_snapshot"] == snapshot
    assert client.post(path, json={**data, "instruction": "changed"}).status_code == 409
    history = client.get(path)
    assert history.headers["cache-control"] == "no-store"
    assert "project_snapshot" not in history.json()["items"][0]
    assert client.delete(f"/api/v1/generations/{job_id}").status_code == 204
    assert client.get(f"/api/v1/generations/{job_id}").status_code == 404
    assert client.post(path, json=data).json()["id"] == job_id
    assert len(calls) == 1


def test_missing_duplicate_foreign_and_stale_inputs_never_call_provider(synthesis):
    client, project_id, ref, _, calls, _ = synthesis
    path = f"/api/v1/projects/{project_id}/generations"
    data = request_data(client, project_id)
    assert client.post(path, json={**data, "sources": data["sources"][:1]}).status_code == 422
    assert client.post(path, json={**data, "sources": [data["sources"][0]] * 2}).status_code == 422
    foreign = {"reference_id": str(uuid4()), "image": image()}
    incomplete = {**data, "sources": [data["sources"][0], foreign]}
    assert client.post(path, json=incomplete).status_code == 422
    client.patch(f"/api/v1/references/{ref['id']}", json={"design_note": "new note"})
    assert client.post(path, json=data).status_code == 409
    assert not calls
    assert client.get("/api/v1/generation-policy").json()["remaining"] == 3


def test_owner_archive_brief_and_rights_boundaries(synthesis, owner):
    client, project_id, _, _, calls, _ = synthesis
    path = f"/api/v1/projects/{project_id}/generations"
    data = request_data(client, project_id)
    assert client.post(path, json={**data, "rights_confirmed": False}).status_code == 422
    client.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=uuid4())
    assert client.get(path).status_code == 404
    assert client.get(f"/api/v1/projects/{project_id}/generation-context").status_code == 404
    assert client.post(path, json=data).status_code == 404
    client.app.dependency_overrides[get_current_user] = lambda: owner
    client.patch(f"/api/v1/projects/{project_id}/brief", json={"brief": ""})
    assert client.post(path, json=request_data(client, project_id)).status_code == 422
    client.patch(f"/api/v1/projects/{project_id}", json={"archived": True})
    assert client.post(path, json=data).status_code == 409
    edited = client.patch(f"/api/v1/projects/{project_id}/brief", json={"brief": "changed"})
    assert edited.status_code == 409
    assert not calls


def test_project_requests_share_budget_and_disabled_gate(synthesis):
    client, project_id, _, _, calls, settings = synthesis
    path = f"/api/v1/projects/{project_id}/generations"
    settings.image_generation_enabled = False
    assert client.post(path, json=request_data(client, project_id)).status_code == 503
    settings.image_generation_enabled = True
    settings.generation_budget_usd = 1
    data = request_data(client, project_id)
    assert client.post(path, json=data).status_code == 202
    assert client.post(path, json=data).status_code == 202
    assert client.post(path, json=request_data(client, project_id)).status_code == 429
    assert len(calls) == 1


def test_reference_and_prompt_limits_do_not_silently_sample(synthesis, monkeypatch):
    client, project_id, _, _, calls, _ = synthesis
    monkeypatch.setattr(project_concepts, "MAX_REFERENCES", 1)
    context = client.get(f"/api/v1/projects/{project_id}/generation-context").json()
    assert context["total"] == 2 and not context["blocked_reason"]
    assert len(context["references"]) == 2
    data = request_data(client, project_id)
    path = f"/api/v1/projects/{project_id}/generations"
    assert client.post(path, json=data).status_code == 422
    chosen = context["references"][0]["id"]
    data.update(
        selected_reference_ids=[chosen], sources=[{"reference_id": chosen, "image": image()}]
    )
    assert client.post(path, json=data).status_code == 202
    assert len(calls) == 1 and len(calls[0][0]) == 1
    calls.clear()
    monkeypatch.setattr(project_concepts, "MAX_REFERENCES", 16)
    data = request_data(client, project_id)
    monkeypatch.setattr(project_concepts, "MAX_PROMPT_CHARS", 10)
    assert client.post(f"/api/v1/projects/{project_id}/generations", json=data).status_code == 422
    assert not calls


def test_aggregate_image_limit(synthesis, monkeypatch):
    client, project_id, _, _, calls, _ = synthesis
    data = request_data(client, project_id)
    monkeypatch.setattr(project_concepts, "MAX_TOTAL_BYTES", 1)
    assert client.post(f"/api/v1/projects/{project_id}/generations", json=data).status_code == 422
    assert not calls


def test_project_provider_sends_every_image_in_matching_order(monkeypatch):
    buffer = io.BytesIO()
    Image.new("RGB", (50, 50), "orange").save(buffer, format="PNG")
    second = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
    sources = [image(), second]
    calls = []

    def handle(request):
        calls.append(1)
        body = json.loads(request.content)
        assert body["images"] == [{"image_url": value} for value in sources]
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
    generation_provider.generate_project(sources, "Numbered image notes", "hash")
    assert calls == [1]
