import json
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from test_generations import image
from test_library import postgres_engine as postgres_engine  # noqa: F401

from app import backup
from app.db.base import Base
from app.db.models import (
    DeliverableType,
    Generation,
    GenerationBudget,
    GenerationQuota,
    Project,
    Reference,
    now,
)


@pytest.fixture
def project_archive(tmp_path):
    source = create_engine("sqlite://")
    Base.metadata.create_all(source)
    owner_id, project_id, kind_id, reference_id, job_id = [uuid4() for _ in range(5)]
    snapshot = {"project_id": str(project_id), "project_name": "Project restore fixture",
                "brief": "Original requirements", "references": [{"id": str(reference_id),
                "title": "Layout", "type_name": "Dashboard", "design_note": "Original note"}]}
    with source.begin() as connection:
        connection.execute(text(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"))
        connection.execute(text("INSERT INTO alembic_version VALUES (:revision)"),
                           {"revision": backup.SCHEMA})
    with Session(source) as db:
        db.add(Project(id=project_id, owner_id=owner_id, name="Project restore fixture",
                       brief="Updated requirements after generation"))
        db.flush()
        db.add(DeliverableType(id=kind_id, project_id=project_id, name="Dashboard"))
        db.flush()
        db.add(Reference(id=reference_id, deliverable_type_id=kind_id,
                         source_url="https://example.com/reference", design_note="Updated note"))
        db.flush()
        db.add(Generation(id=job_id, owner_id=owner_id, project_id=project_id, reference_id=None,
                          scope="project", request_id=uuid4(), request_hash="a" * 64,
                          instruction="", note_snapshot="Original requirements", status="succeeded",
                          project_snapshot_json=json.dumps(snapshot), result_image=image(),
                          reserved_micro_usd=1_000_000))
        db.add(GenerationBudget(id=1, reserved_micro_usd=1_000_000))
        db.add(GenerationQuota(day=now().date(), used=1))
        db.commit()
    path = tmp_path / "project.json"
    backup.snapshot(source, path)
    try:
        yield backup.load_snapshot(path), backup.current_redactions(source), job_id, snapshot
    finally:
        source.dispose()


def verify(target, archive):
    data, redactions, job_id, snapshot = archive
    report = backup.restore(data, target, redactions=redactions)
    assert report["verified"] and report["provider_calls"] == 0
    with Session(target) as db:
        job = db.get(Generation, job_id)
        assert job.scope == "project" and job.reference_id is None
        assert json.loads(job.project_snapshot_json) == snapshot
        assert job.note_snapshot == "Original requirements" and job.result_image == image()
        assert db.get(Project, job.project_id).brief == "Updated requirements after generation"
        assert db.get(GenerationBudget, 1).reserved_micro_usd == 1_000_000


def test_project_snapshot_and_nullable_reference_survive_sqlite_restore(project_archive):
    target = create_engine("sqlite://")
    try:
        verify(target, project_archive)
    finally:
        target.dispose()


@pytest.mark.integration
def test_project_snapshot_survives_real_postgres_restore(project_archive, postgres_engine):
    name = "rdm_restore_project_test_" + uuid4().hex
    target = backup.create_target(postgres_engine.url, name)
    try:
        verify(target, project_archive)
    finally:
        target.dispose()
        assert name.startswith("rdm_restore_project_test_") and len(name) == 57
        # This exact temporary database was created by this test; never drop an existing target.
        with postgres_engine.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as connection:
            connection.execute(text('DROP DATABASE "' + name + '"'))
