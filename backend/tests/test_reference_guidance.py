import pytest
from pydantic import ValidationError
from test_library import library_client, owner, postgres_engine, save, setup_path  # noqa: F401
from test_project_concepts import synthesis, request_data  # noqa: F401
from test_generations import generation, image  # noqa: F401

from app.api.schemas import DesignGuidance
from app.api.reference_guidance import ROLE_MEANINGS


def test_all_practical_roles_are_valid_and_have_prompt_definitions():
    value = DesignGuidance.model_validate({"roles": list(ROLE_MEANINGS)})
    assert len(value.roles) == 16
    assert {"icons", "typography", "spacing", "charts", "forms"}.issubset(value.roles)


def guidance(version):
    return {"roles": ["color", "layout"], "image_version": version,
            "regions": [{"x": .1, "y": .2, "width": .3, "height": .4, "note": "Use the chart spacing"}]}


@pytest.mark.parametrize("value", [
    {"roles": ["unknown"]}, {"roles": ["color", "color"]},
    {"regions": [{"x": .9, "y": 0, "width": .2, "height": .2, "note": "out"}], "image_version": "a" * 64},
    {"regions": [{"x": 0, "y": 0, "width": .2, "height": .2, "note": "missing version"}]},
    {"regions": [{"x": 0, "y": 0, "width": .2, "height": .2, "note": "  "}], "image_version": "a" * 64},
])
def test_invalid_guidance_is_rejected(value):
    with pytest.raises(ValidationError):
        DesignGuidance.model_validate(value)


def test_guidance_roundtrip_and_changed_preview_require_review(library_client, owner):
    client = library_client
    project, kind = setup_path(client)
    ref = save(client, project, kind, design_note="Existing note", preview_url="https://example.com/a.png").json()
    path = f"/api/v1/references/{ref['id']}"
    data = guidance(ref["preview_version"])
    response = client.patch(path, json={"design_guidance": data})
    assert response.status_code == 200, response.text
    assert response.json()["design_guidance"] == data
    assert response.json()["design_note"] == "Existing note"
    assert "design_guidance_json" not in response.json()
    client.patch(path + "/thumbnail", json={"preview_url": "https://example.com/b.png", "preview_source": "page_metadata"})
    updated = client.get(path).json()
    assert updated["guidance_stale"] is True
    assert client.patch(path, json={"design_guidance": data}).status_code == 409
    data["image_version"] = updated["preview_version"]
    assert client.patch(path, json={"design_guidance": data}).json()["guidance_stale"] is False
    client.patch(path, json={"design_guidance": None})
    assert client.get(path).json()["design_guidance"]["regions"] == []


def test_roles_regions_reach_prompt_snapshot_and_context_digest(synthesis):
    client, project_id, ref, _, calls, _ = synthesis
    path = f"/api/v1/references/{ref['id']}"
    ref = client.patch(path + "/thumbnail", json={"preview_url": "https://example.com/a.png", "preview_source": "page_metadata"}).json()
    old = request_data(client, project_id)
    data = guidance(ref["preview_version"])
    client.patch(path, json={"design_guidance": data})
    endpoint = f"/api/v1/projects/{project_id}/generations"
    assert client.post(endpoint, json=old).status_code == 409
    assert not calls
    request = request_data(client, project_id)
    response = client.post(endpoint, json=request)
    assert response.status_code == 202, response.text
    assert "Use the chart spacing" in calls[0][1]
    assert '"color"' in calls[0][1] and "normalized" in calls[0][1]
    job = client.get(f"/api/v1/generations/{response.json()['id']}").json()
    row = next(row for row in job["project_snapshot"]["references"] if row["id"] == ref["id"])
    assert row["design_guidance"] == data
    client.patch(path, json={"design_guidance": None})
    assert client.get(f"/api/v1/generations/{job['id']}").json()["project_snapshot"] == job["project_snapshot"]


def test_stale_regions_block_paid_request(synthesis):
    client, project_id, ref, _, calls, _ = synthesis
    path = f"/api/v1/references/{ref['id']}"
    ref = client.patch(path + "/thumbnail", json={"preview_url": "https://example.com/a.png", "preview_source": "page_metadata"}).json()
    client.patch(path, json={"design_guidance": guidance(ref["preview_version"])})
    client.patch(path + "/thumbnail", json={"preview_url": "https://example.com/b.png", "preview_source": "page_metadata"})
    data = request_data(client, project_id)
    response = client.post(f"/api/v1/projects/{project_id}/generations", json=data)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "GUIDANCE_STALE"
    assert not calls
