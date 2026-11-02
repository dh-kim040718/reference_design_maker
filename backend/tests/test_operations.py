from uuid import UUID

import pytest
from sqlalchemy.orm import Session
from test_generations import generation as generation  # noqa: F401
from test_generations import payload
from test_job_recovery import bind_for
from test_library import library_client as library_client  # noqa: F401
from test_library import owner as owner  # noqa: F401
from test_library import postgres_engine as postgres_engine  # noqa: F401

from app.core.settings import Settings
from app.db.models import Generation
from app.operations import summary
from app.release_check import check


def test_operator_summary_is_content_free_and_does_not_replay(generation):
    client, ref, calls, settings = generation
    job = client.post(f"/api/v1/references/{ref['id']}/generations", json=payload()).json()
    with Session(bind=bind_for(client), join_transaction_mode="create_savepoint") as db:
        row = db.get(Generation, UUID(job["id"]))
        row.status = "unknown"
        row.instruction = "private instruction must not leak"
        db.commit()
        report = summary(db, settings)
    assert "UNCERTAIN_OUTCOMES" in report["alerts"]
    assert report["provider_calls"] == 0 and len(calls) == 1
    assert "private" not in str(report) and job["id"] not in str(report)


def test_local_configuration_cannot_be_mistaken_for_release_readiness():
    report = check(Settings(_env_file=None))
    assert not report["deployment_approved"]
    assert "EXPLICIT_HTTPS_ORIGINS_REQUIRED" in report["configuration_blockers"]
    assert "REMOTE_CI" in report["manual_gates"]


def test_editing_remains_a_release_blocker_even_with_https():
    settings = Settings(_env_file=None, database_url="postgresql://localhost/local",
                        cors_origins="https://app.example.com", supabase_url="https://auth.example.com",
                        image_editing_enabled=True)
    assert "EDITING_QUALITY_GATE_FAILED" in check(settings)["configuration_blockers"]


@pytest.mark.parametrize("origin", ["https://*", "https://", "https://user:pass@example.com",
                                    "https://example.com/private", "https://["])
def test_invalid_origins_cannot_pass_the_release_check(origin):
    settings = Settings(_env_file=None, cors_origins=origin)
    assert "EXPLICIT_HTTPS_ORIGINS_REQUIRED" in check(settings)["configuration_blockers"]
