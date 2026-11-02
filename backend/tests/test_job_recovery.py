import asyncio
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from test_generations import generation as generation  # noqa: F401
from test_generations import image, payload
from test_library import library_client as library_client  # noqa: F401
from test_library import owner as owner  # noqa: F401
from test_library import postgres_engine as postgres_engine  # noqa: F401

from app import job_recovery, main
from app.api import generations
from app.api.generation_provider import ProviderFailure, get_image_provider, marked_result
from app.db.models import Generation, GenerationQuota, now
from app.db.session import get_db


def bind_for(client):
    generator = client.app.dependency_overrides[get_db]()
    try:
        return next(generator).get_bind()
    finally:
        generator.close()


def change(bind, job_id, **changes):
    with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
        job = db.get(Generation, UUID(job_id))
        for field, value in changes.items():
            setattr(job, field, value)
        db.commit()


def test_stale_reservation_cannot_call_provider_and_releases_active_slot(generation, monkeypatch):
    client, ref, calls, _ = generation
    pending = []
    monkeypatch.setattr(generations.BackgroundTasks, "add_task",
                        lambda self, *args, **kwargs: pending.append(args))
    url = f"/api/v1/references/{ref['id']}/generations"
    data = payload()
    job = client.post(url, json=data).json()
    bind = bind_for(client)
    change(bind, job["id"], updated_at=now() - timedelta(minutes=6))
    task, *arguments = pending[0]
    task(*arguments)
    assert not calls
    assert client.post(url, json=data).json()["status"] == "unknown"
    assert client.post(url, json=payload()).status_code == 202
    assert client.get("/api/v1/generation-policy").json()["remaining"] == 1


def test_new_request_cleans_stale_active_job_without_history_visit(generation):
    client, ref, calls, _ = generation
    url = f"/api/v1/references/{ref['id']}/generations"
    old = client.post(url, json=payload()).json()
    change(bind_for(client), old["id"], status="processing",
           updated_at=now() - timedelta(minutes=6))
    assert client.post(url, json=payload()).status_code == 202
    assert len(calls) == 2
    assert client.get(f"/api/v1/generations/{old['id']}").json()["status"] == "unknown"


def test_sweep_preserves_completed_fresh_and_quota_records(generation):
    client, ref, _, _ = generation
    url = f"/api/v1/references/{ref['id']}/generations"
    jobs = [client.post(url, json=payload()).json()["id"] for _ in range(3)]
    bind = bind_for(client)
    change(bind, jobs[0], status="processing", updated_at=now() - timedelta(minutes=6))
    change(bind, jobs[1], status="processing", updated_at=now())
    assert job_recovery.sweep(bind) == 1
    assert job_recovery.sweep(bind) == 0
    with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
        assert [db.get(Generation, UUID(key)).status for key in jobs] == [
            "unknown", "processing", "succeeded"]
        used = db.scalar(select(GenerationQuota.used).where(GenerationQuota.day == now().date()))
        assert used == 3


@pytest.mark.parametrize("delete", [False, True])
def test_late_result_cannot_overwrite_expired_or_deleted_job(generation, delete):
    client, ref, _, _ = generation
    bind = bind_for(client)

    def delayed(*args):
        with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
            row = db.scalar(select(Generation).where(Generation.status == "processing"))
            row.updated_at = now() - timedelta(minutes=6)
            db.commit()
        assert job_recovery.sweep(bind) == 1
        if delete:
            with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
                row = db.scalar(select(Generation).where(Generation.status == "unknown"))
                row.deleted_at = now()
                db.commit()
        return marked_result(image().split(",")[1]), {"total_tokens": 1}

    client.app.dependency_overrides[get_image_provider] = lambda: delayed
    job = client.post(f"/api/v1/references/{ref['id']}/generations", json=payload()).json()
    with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
        stored = db.get(Generation, UUID(job["id"]))
        assert stored.status == "unknown" and stored.result_image is None
        assert (stored.deleted_at is not None) == delete


def test_provider_diagnostics_are_private_and_do_not_retry(generation):
    client, ref, calls, _ = generation

    def reject(*args):
        calls.append(1)
        raise ProviderFailure("PROVIDER_REJECTED", 429, "quota")

    client.app.dependency_overrides[get_image_provider] = lambda: reject
    url = f"/api/v1/references/{ref['id']}/generations"
    data = payload()
    job = client.post(url, json=data).json()
    result = client.get(f"/api/v1/generations/{job['id']}").json()
    assert result["provider_http_status"] == 429 and result["provider_reason"] == "quota"
    assert client.post(url, json=data).json()["id"] == job["id"]
    assert calls == [1]


def test_lifespan_sweeps_once_then_cancels_periodic_worker(monkeypatch):
    calls = []
    stopped = []

    async def worker(bind):
        try:
            await asyncio.Event().wait()
        finally:
            stopped.append(True)

    monkeypatch.setattr(main, "sweep", lambda bind: calls.append(bind))
    monkeypatch.setattr(main, "recovery_loop", worker)

    async def run():
        async with main.lifespan(main.app):
            await asyncio.sleep(0)

    asyncio.run(run())
    assert len(calls) == 1 and stopped == [True]


def test_sweep_failure_is_redacted_and_a_later_sweep_can_recover(client, monkeypatch, caplog):
    original = job_recovery.expire_jobs

    def broken(db):
        raise SQLAlchemyError("secret-key private-image")

    bind = bind_for(client)
    monkeypatch.setattr(job_recovery, "expire_jobs", broken)
    assert job_recovery.sweep(bind) is None
    assert "secret-key" not in caplog.text and "private-image" not in caplog.text
    monkeypatch.setattr(job_recovery, "expire_jobs", original)
    assert job_recovery.sweep(bind) == 0


def test_worker_database_failure_does_not_dump_private_parameters(monkeypatch, caplog):
    def broken(*args):
        raise SQLAlchemyError("secret-key private-image")

    monkeypatch.setattr(generations, "_execute_job", broken)
    generations.execute_job(None, None, "private-image", None)
    assert "No retry" in caplog.text
    assert "secret-key" not in caplog.text and "private-image" not in caplog.text
