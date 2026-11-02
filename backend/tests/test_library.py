import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth.dependencies import AuthenticatedUser, get_current_user
from app.db.session import get_db


@pytest.fixture(scope="session")
def postgres_engine():
    if os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1":
        pytest.skip("Local PostgreSQL integration tests are disabled.")
    database_url = os.getenv("TEST_DATABASE_URL", "")
    url = make_url(database_url)
    if (
        url.get_backend_name() != "postgresql"
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or url.port not in {5432, 54322}
    ):
        pytest.fail("Only a dedicated local PostgreSQL test database is allowed.")
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "DATABASE_URL": database_url},
        check=True,
        capture_output=True,
    )
    engine = create_engine(database_url)
    yield engine
    engine.dispose()


@pytest.fixture(params=["sqlite", pytest.param("postgres", marks=pytest.mark.integration)])
def library_client(request, client):
    if request.param == "postgres":
        engine = request.getfixturevalue("postgres_engine")
        with engine.connect() as connection:
            transaction = connection.begin()

            def database():
                with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
                    yield session

            client.app.dependency_overrides[get_db] = database
            yield client
            transaction.rollback()
    else:
        yield client


@pytest.fixture
def owner(library_client):
    user = AuthenticatedUser(id=uuid4(), email="owner@example.com")
    library_client.app.dependency_overrides[get_current_user] = lambda: user
    return user


def setup_path(client):
    project = client.post("/api/v1/projects", json={"name": "브랜드 리뉴얼"})
    assert project.status_code == 201, project.text
    project = project.json()
    kind = client.post(f"/api/v1/projects/{project['id']}/deliverable-types", json={"name": "웹"})
    assert kind.status_code == 201, kind.text
    return project, kind.json()


def save(client, project, kind, **fields):
    return client.post(
        "/api/v1/references",
        json={
            "project_id": project["id"],
            "deliverable_type_id": kind["id"],
            "source_url": "https://example.com/design?view=full#hero",
            **fields,
        },
    )


def test_save_revisit_note_and_last_path(library_client, owner):
    project, kind = setup_path(library_client)
    result = save(library_client, project, kind)
    assert result.status_code == 201, result.text
    item = result.json()
    assert item["title"] is None and item["design_note"] is None
    assert item["source_url"] == "https://example.com/design?view=full#hero"
    assert item["created_at"].endswith("Z") or item["created_at"].endswith("+00:00")
    assert library_client.get(f"/api/v1/references/{item['id']}").json() == item
    listing = library_client.get(f"/api/v1/deliverable-types/{kind['id']}/references").json()
    assert listing["total"] == 1 and listing["items"][0]["id"] == item["id"]
    assert library_client.get("/api/v1/preferences").json()["last_path"] == {
        "project_id": project["id"],
        "deliverable_type_id": kind["id"],
    }
    path = f"/api/v1/references/{item['id']}"
    assert (
        library_client.patch(path, json={"design_note": "여백\n타이포"}).json()["design_note"]
        == "여백\n타이포"
    )
    assert library_client.patch(path, json={}).json()["design_note"] == "여백\n타이포"
    assert library_client.patch(path, json={"design_note": "  "}).json()["design_note"] is None


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "ftp://example.com",
        "hello",
        "https://user:pass@example.com",
        "https://example.com:bad",
    ],
)
def test_invalid_url_does_not_save(library_client, owner, url):
    project, kind = setup_path(library_client)
    assert save(library_client, project, kind, source_url=url).status_code == 422
    assert library_client.get("/api/v1/preferences").json() == {"last_path": None}
    assert (
        library_client.get(f"/api/v1/deliverable-types/{kind['id']}/references").json()["total"]
        == 0
    )


def test_other_account_cannot_read_write_or_infer_items(library_client, owner):
    project, kind = setup_path(library_client)
    item = save(library_client, project, kind).json()
    library_client.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=uuid4()
    )
    assert library_client.get("/api/v1/projects").json()["total"] == 0
    for path in [
        f"/projects/{project['id']}",
        f"/deliverable-types/{kind['id']}",
        f"/references/{item['id']}",
    ]:
        assert library_client.get("/api/v1" + path).status_code == 404
        assert (
            library_client.patch(
                "/api/v1" + path,
                json={"name": "test"} if "references" not in path else {"design_note": "test"},
            ).status_code
            == 404
        )
    assert (
        library_client.get(f"/api/v1/projects/{project['id']}/deliverable-types").status_code == 404
    )
    assert (
        library_client.get(f"/api/v1/deliverable-types/{kind['id']}/references").status_code == 404
    )
    assert save(library_client, project, kind).status_code == 404


def test_path_mismatch_and_missing_items(library_client, owner):
    first, kind = setup_path(library_client)
    other, _ = setup_path(library_client)
    assert save(library_client, other, kind).json()["detail"]["code"] == "PATH_MISMATCH"
    first["id"] = str(uuid4())
    assert save(library_client, first, kind).status_code == 404


def test_archive_read_only_and_restore_preserves_child_archive(library_client, owner):
    project, kind = setup_path(library_client)
    second = library_client.post(
        f"/api/v1/projects/{project['id']}/deliverable-types", json={"name": "앱"}
    ).json()
    item = save(library_client, project, kind).json()
    kind_path = f"/api/v1/deliverable-types/{kind['id']}"
    project_path = f"/api/v1/projects/{project['id']}"
    assert library_client.patch(kind_path, json={"archived": True}).status_code == 200
    assert library_client.get("/api/v1/preferences").json()["last_path"] is None
    assert library_client.patch(project_path, json={"archived": True}).status_code == 200
    assert library_client.get(f"/api/v1/references/{item['id']}").json()["read_only"] is True
    assert save(library_client, project, second).status_code == 409
    assert (
        library_client.patch(
            f"/api/v1/references/{item['id']}", json={"design_note": "blocked"}
        ).status_code
        == 409
    )
    assert library_client.patch(kind_path, json={"archived": False}).status_code == 409
    assert library_client.patch(project_path, json={"archived": False}).status_code == 200
    assert library_client.get(kind_path).json()["archived_at"] is not None
    assert save(library_client, project, second).status_code == 201
    assert library_client.patch(kind_path, json={"archived": False}).status_code == 200
    assert library_client.get(f"/api/v1/references/{item['id']}").json()["read_only"] is False


def test_validation_pagination_and_duplicate_urls(library_client, owner):
    assert library_client.post("/api/v1/projects", json={"name": "  "}).status_code == 422
    project, kind = setup_path(library_client)
    for _ in range(3):
        assert save(library_client, project, kind).status_code == 201
    page = library_client.get(
        f"/api/v1/deliverable-types/{kind['id']}/references?limit=2&offset=2"
    ).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert library_client.get("/api/v1/projects?limit=101").status_code == 422
    assert (
        library_client.patch(
            f"/api/v1/projects/{project['id']}", json={"name": "new", "archived": True}
        ).status_code
        == 422
    )
    assert (
        library_client.patch(f"/api/v1/projects/{project['id']}", json={"name": " 변경 "}).json()[
            "name"
        ]
        == "변경"
    )
    assert save(library_client, project, kind, title="x" * 201).status_code == 422


def test_save_rollback_includes_preferences(library_client, owner):
    project, kind = setup_path(library_client)
    original = library_client.app.dependency_overrides[get_db]

    def broken():
        for session in original():

            def reject_commit(current):
                raise OperationalError("simulated", None, Exception("test failure"))

            event.listen(session, "before_commit", reject_commit)
            yield session

    library_client.app.dependency_overrides[get_db] = broken
    assert save(library_client, project, kind).status_code == 503
    library_client.app.dependency_overrides[get_db] = original
    assert library_client.get("/api/v1/preferences").json() == {"last_path": None}
    assert (
        library_client.get(f"/api/v1/deliverable-types/{kind['id']}/references").json()["total"]
        == 0
    )


def test_library_requires_authentication(client):
    assert client.get("/api/v1/projects").status_code == 401


def test_thumbnail_update_project_cover_and_archive(library_client, owner):
    project, kind = setup_path(library_client)
    item = save(library_client, project, kind).json()
    image = (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
        "AAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
    )
    path = f"/api/v1/references/{item['id']}/thumbnail"
    updated = library_client.patch(
        path, json={"preview_url": image, "preview_source": "user_upload"}
    )
    assert updated.status_code == 200
    assert updated.json()["preview_url"] == image
    assert library_client.get("/api/v1/projects").json()["items"][0]["thumbnail_url"] == image
    assert (
        library_client.get(f"/api/v1/projects/{project['id']}/deliverable-types").json()["items"][
            0
        ]["thumbnail_url"]
        == image
    )
    assert (
        library_client.patch(
            path, json={"preview_url": "data:image/svg+xml;base64,PHN2Zz4="}
        ).status_code
        == 422
    )
    library_client.patch(f"/api/v1/projects/{project['id']}", json={"archived": True})
    assert library_client.patch(path, json={"preview_url": None}).status_code == 409


@pytest.mark.integration
def test_archive_serializes_with_concurrent_save(postgres_engine):
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    from threading import Event

    from fastapi import HTTPException
    from sqlalchemy import delete, select

    from app.api.library import create_reference
    from app.api.schemas import ReferenceInput
    from app.db.models import DeliverableType, Project, now

    owner = AuthenticatedUser(id=uuid4())
    with Session(postgres_engine) as setup:
        parent = Project(owner_id=owner.id, name="concurrency test")
        setup.add(parent)
        setup.flush()
        kind = DeliverableType(project_id=parent.id, name="web")
        setup.add(kind)
        setup.commit()
        project_id, type_id = parent.id, kind.id

    started = Event()

    def save_while_archiving():
        with Session(postgres_engine) as session:
            started.set()
            try:
                create_reference(
                    ReferenceInput(
                        project_id=project_id,
                        deliverable_type_id=type_id,
                        source_url="https://example.com/concurrency",
                    ),
                    session,
                    owner,
                )
            except HTTPException as error:
                return error.status_code
            return 201

    try:
        with Session(postgres_engine) as archiver, ThreadPoolExecutor(max_workers=1) as pool:
            parent = archiver.scalar(
                select(Project).where(Project.id == project_id).with_for_update()
            )
            parent.archived_at = now()
            future = pool.submit(save_while_archiving)
            assert started.wait(3)
            try:
                with pytest.raises(TimeoutError):
                    future.result(timeout=0.15)
            finally:
                archiver.commit()
            assert future.result(timeout=5) == 409
    finally:
        with Session(postgres_engine) as cleanup:
            cleanup.execute(delete(DeliverableType).where(DeliverableType.project_id == project_id))
            cleanup.execute(
                delete(Project).where(Project.id == project_id, Project.owner_id == owner.id)
            )
            cleanup.commit()
