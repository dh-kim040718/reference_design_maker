import json
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy.orm import Session
from test_generations import generation as generation  # noqa: F401
from test_job_recovery import bind_for
from test_library import library_client as library_client  # noqa: F401
from test_library import owner as owner  # noqa: F401
from test_library import postgres_engine as postgres_engine  # noqa: F401

from app.api import metrics
from app.auth.dependencies import AuthenticatedUser, get_current_user
from app.db.models import Generation, now


def seed(client, ref, owner_id, **values):
    defaults = {"owner_id": owner_id, "reference_id": UUID(ref["id"]),
                "request_id": uuid4(), "request_hash": "x" * 64,
                "instruction": "private instruction", "note_snapshot": "private note",
                "result_image": "private image", "status": "succeeded", "updated_at": now()}
    with Session(bind=bind_for(client), join_transaction_mode="create_savepoint") as db:
        db.add(Generation(**{**defaults, **values}))
        db.commit()


def test_owner_summary_includes_deleted_and_excludes_content_and_outside_window(
    generation, owner, monkeypatch,
):
    client, ref, calls, _ = generation
    end = now()
    monkeypatch.setattr(metrics, "now", lambda: end)
    start = end.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=6)
    seed(client, ref, owner.id, created_at=start, deleted_at=end,
         elapsed_ms=100, usage_json=json.dumps({"total_tokens": 10}))
    seed(client, ref, owner.id, created_at=end, operation="edit", status="failed",
         elapsed_ms=300, provider_reason="quota")
    seed(client, ref, owner.id, created_at=end, status="unknown", usage_json="invalid-json",
         provider_reason="private unexpected error")
    seed(client, ref, owner.id, created_at=end, status="processing")
    seed(client, ref, owner.id, created_at=start - timedelta(microseconds=1))
    seed(client, ref, uuid4(), created_at=end, elapsed_ms=9999)
    response = client.get("/api/v1/generation-metrics?days=7")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["total"] == 4 and data["includes_deleted"]
    assert data["statuses"] == {"queued": 0, "processing": 1, "succeeded": 1,
                                "failed": 1, "unknown": 1}
    assert data["operations"] == {"generate": 3, "edit": 1}
    assert data["success_rate"] == 1 / 3
    assert data["latency"] == {"samples": 2, "average_ms": 200, "p95_ms": 300}
    assert data["usage"] == {"known_jobs": 1, "missing_jobs": 2, "total_tokens": 10}
    assert data["actual_billed_usd"] is None
    assert data["failure_reasons"] == {"quota": 1, "unspecified": 1}
    assert "private" not in response.text and ref["id"] not in response.text
    assert not calls
    assert client.get("/api/v1/generation-metrics?days=30").json()["total"] == 5


def test_empty_summary_and_ownership(generation, owner):
    client, ref, calls, _ = generation
    seed(client, ref, owner.id, created_at=now(), usage_json='{"total_tokens":0}')
    client.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=uuid4())
    data = client.get("/api/v1/generation-metrics").json()
    assert data["total"] == 0 and data["success_rate"] is None
    assert data["latency"]["average_ms"] is None
    assert data["usage"] == {"known_jobs": 0, "missing_jobs": 0, "total_tokens": 0}
    assert not calls


def test_period_validation_and_authentication(client):
    assert client.get("/api/v1/generation-metrics").status_code == 401
    client.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=uuid4())
    for value in ("0", "8", "31", "-1", "all"):
        assert client.get(f"/api/v1/generation-metrics?days={value}").status_code == 422


def test_zero_usage_is_known_and_bool_is_not_a_token_count(generation, owner):
    client, ref, _, _ = generation
    seed(client, ref, owner.id, usage_json='{"total_tokens":0}')
    seed(client, ref, owner.id, usage_json='{"total_tokens":true}')
    seed(client, ref, owner.id, usage_json='{"total_tokens":-1}')
    data = client.get("/api/v1/generation-metrics").json()
    assert data["usage"] == {"known_jobs": 1, "missing_jobs": 2, "total_tokens": 0}
