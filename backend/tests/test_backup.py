import json
from uuid import UUID

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from test_generations import generation as generation  # noqa: F401
from test_generations import payload
from test_job_recovery import bind_for
from test_library import library_client as library_client  # noqa: F401
from test_library import owner as owner  # noqa: F401
from test_library import postgres_engine as postgres_engine  # noqa: F401

from app import backup
from app.db.models import Generation, GenerationQuota, Reference


def stamp(bind):
    with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
        db.execute(text("CREATE TABLE IF NOT EXISTS alembic_version "
                        "(version_num VARCHAR(32) PRIMARY KEY)"))
        if not db.scalar(text("SELECT version_num FROM alembic_version")):
            db.execute(text("INSERT INTO alembic_version VALUES (:version)"),
                       {"version": backup.SCHEMA})
        db.commit()


@pytest.fixture
def source_data(generation, tmp_path):
    client, ref, calls, _ = generation
    url = f"/api/v1/references/{ref['id']}/generations"
    job = client.post(url, json=payload()).json()
    bind = bind_for(client)
    stamp(bind)
    # The normal SQLite fixture gives an Engine. PostgreSQL fixtures give an active Connection;
    # keep the source test here isolated on SQLite and exercise live PostgreSQL with the CLI drill.
    if bind.dialect.name != "sqlite":
        pytest.skip("Dedicated PostgreSQL CLI drill covers consistent snapshot transactions")
    return client, ref, job, calls, bind


def test_restore_matches_data_and_preserves_usage_reservations(source_data, tmp_path):
    client, ref, job, calls, source = source_data
    path = tmp_path / "backup.json"
    result = backup.snapshot(source, path)
    assert result["counts"]["generations"] == 1
    data = backup.load_snapshot(path)
    assert "OPENAI_API_KEY" not in path.read_text("utf-8")
    target = create_engine("sqlite://")
    try:
        report = backup.restore(data, target, redactions=backup.current_redactions(source))
        assert report["verified"] and report["provider_calls"] == 0
        with Session(target) as db:
            restored = db.get(Generation, UUID(job["id"]))
            assert restored.result_image == client.get(
                f"/api/v1/generations/{job['id']}").json()["result_image"]
            assert db.scalar(select(GenerationQuota.used)) == 1
            assert db.get(Reference, UUID(ref["id"])).source_url
        assert len(calls) == 1  # Only the fixture mock generation, no backup/restore provider call.
    finally:
        target.dispose()


def test_later_deletions_and_removed_thumbnails_do_not_resurrect(source_data, tmp_path):
    client, ref, job, _, source = source_data
    with source.begin() as connection:
        connection.execute(Reference.__table__.update().where(
            Reference.id == UUID(ref["id"])).values(preview_url="data:image/png;base64,old",
                                                   preview_source="user_upload"))
    path = tmp_path / "before-deletion.json"
    backup.snapshot(source, path)
    assert client.delete(f"/api/v1/generations/{job['id']}").status_code == 204
    with source.begin() as connection:
        connection.execute(Reference.__table__.update().where(
            Reference.id == UUID(ref["id"])).values(preview_url=None, preview_source=None))
    target = create_engine("sqlite://")
    try:
        report = backup.restore(backup.load_snapshot(path), target,
                                redactions=backup.current_redactions(source))
        assert report["redacted_images"] == 2
        with Session(target) as db:
            row = db.get(Generation, UUID(job["id"]))
            assert row.deleted_at and row.result_image is None
            assert db.get(Reference, UUID(ref["id"])).preview_url is None
    finally:
        target.dispose()


def test_active_jobs_become_unknown_without_replaying_or_refunding(source_data, tmp_path):
    _, _, job, calls, source = source_data
    with source.begin() as connection:
        connection.execute(Generation.__table__.update().where(
            Generation.id == UUID(job["id"])).values(status="processing", result_image=None))
    path = tmp_path / "active.json"
    backup.snapshot(source, path)
    target = create_engine("sqlite://")
    try:
        report = backup.restore(backup.load_snapshot(path), target,
                                redactions=backup.current_redactions(source))
        assert report["active_jobs_marked_unknown"] == 1
        with Session(target) as db:
            assert db.get(Generation, UUID(job["id"])).status == "unknown"
            assert db.scalar(select(GenerationQuota.used)) == 1
        assert len(calls) == 1
    finally:
        target.dispose()


def test_tampering_and_nonempty_target_are_rejected(source_data, tmp_path):
    _, _, _, _, source = source_data
    path = tmp_path / "backup.json"
    backup.snapshot(source, path)
    data = backup.load_snapshot(path)
    with pytest.raises(FileExistsError):
        backup.snapshot(source, path)
    package = json.loads(path.read_text("utf-8"))
    package["snapshot"]["schema"] = "tampered"
    path.write_text(json.dumps(package), "utf-8")
    with pytest.raises(ValueError):
        backup.load_snapshot(path)
    protected = create_engine(f"sqlite:///{(tmp_path / 'application.db').as_posix()}")
    try:
        with pytest.raises(ValueError, match="Dedicated SQLite"):
            backup.restore(data, protected, redactions=backup.current_redactions(source))
        assert not (tmp_path / "application.db").exists()
    finally:
        protected.dispose()
    target = create_engine("sqlite://")
    try:
        with target.begin() as connection:
            connection.execute(text("CREATE TABLE valuable_data (id INTEGER)"))
            connection.execute(text("INSERT INTO valuable_data VALUES (42)"))
        with pytest.raises(ValueError, match="not empty"):
            backup.restore(data, target, redactions=backup.current_redactions(source))
        with target.connect() as connection:
            assert connection.scalar(text("SELECT id FROM valuable_data")) == 42
    finally:
        target.dispose()


def test_old_snapshot_cannot_forget_later_paid_requests(source_data, tmp_path):
    client, ref, _, _, source = source_data
    path = tmp_path / "old.json"
    backup.snapshot(source, path)
    assert client.post(f"/api/v1/references/{ref['id']}/generations",
                       json=payload()).status_code == 202
    target = create_engine("sqlite://")
    try:
        with pytest.raises(ValueError, match="predates paid reservations"):
            backup.restore(backup.load_snapshot(path), target,
                           redactions=backup.current_redactions(source))
    finally:
        target.dispose()


def test_old_schema_does_not_invent_historical_charges(source_data, tmp_path):
    _, _, _, _, source = source_data
    path = tmp_path / "v7.json"
    backup.snapshot(source, path)
    package = json.loads(path.read_text("utf-8"))
    old = package["snapshot"]
    old["schema"] = "0007_safe_diagnostics"
    old["tables"].pop("generation_budget")
    for row in old["tables"]["generations"]:
        row.pop("reserved_micro_usd")
    package["sha256"] = backup.digest(old)
    path.write_text(json.dumps(package), "utf-8")
    upgraded = backup.load_snapshot(path)
    assert upgraded["schema"] == backup.SCHEMA
    assert upgraded["tables"]["generations"][0]["reserved_micro_usd"] is None
    assert json.loads(path.read_text("utf-8"))["snapshot"]["schema"] == "0007_safe_diagnostics"
