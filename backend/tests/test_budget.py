from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_generations import generation as generation  # noqa: F401
from test_generations import payload
from test_job_recovery import bind_for
from test_library import library_client as library_client  # noqa: F401
from test_library import owner as owner  # noqa: F401
from test_library import postgres_engine as postgres_engine  # noqa: F401

from app.api.generation_provider import ProviderFailure, get_image_provider
from app.db.models import Generation, GenerationBudget, GenerationQuota


def test_budget_boundary_idempotency_and_delete_do_not_refund(generation):
    client, ref, calls, settings = generation
    settings.generation_budget_usd = 1
    url = f"/api/v1/references/{ref['id']}/generations"
    data = payload()
    job = client.post(url, json=data)
    assert job.status_code == 202, job.text
    assert client.post(url, json=data).json()["id"] == job.json()["id"]
    assert len(calls) == 1
    assert client.post(url, json=payload()).status_code == 429
    assert client.delete(f"/api/v1/generations/{job.json()['id']}").status_code == 204
    assert client.post(url, json=payload()).status_code == 429
    with Session(bind=bind_for(client), join_transaction_mode="create_savepoint") as db:
        assert db.get(GenerationBudget, 1).reserved_micro_usd == 1_000_000
        assert db.scalar(select(GenerationQuota.used)) == 1


@pytest.mark.parametrize("code", ["PROVIDER_REJECTED", "OUTCOME_UNKNOWN"])
def test_failure_and_uncertainty_keep_full_reservation(generation, code):
    client, ref, _, settings = generation
    settings.generation_budget_usd = 1

    def reject(*args):
        raise ProviderFailure(code)

    client.app.dependency_overrides[get_image_provider] = lambda: reject
    url = f"/api/v1/references/{ref['id']}/generations"
    assert client.post(url, json=payload()).status_code == 202
    assert client.post(url, json=payload()).status_code == 429
    budget = client.get("/api/v1/generation-policy").json()["budget"]
    assert budget["reserved_micro_usd"] == 1_000_000 and budget["actual_billed_usd"] is None


def test_unconfigured_budget_and_unreconciled_history_block_new_calls(generation):
    client, ref, calls, settings = generation
    url = f"/api/v1/references/{ref['id']}/generations"
    settings.generation_budget_usd = 0
    assert client.post(url, json=payload()).status_code == 503
    assert not calls
    settings.generation_budget_usd = 10
    job = client.post(url, json=payload()).json()
    with Session(bind=bind_for(client), join_transaction_mode="create_savepoint") as db:
        row = db.get(Generation, UUID(job["id"]))
        row.reserved_micro_usd = None
        db.commit()
    response = client.post(url, json=payload())
    assert response.status_code == 503 and "BILLING_RECONCILIATION_REQUIRED" in response.text
    assert len(calls) == 1
