import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

pytestmark = pytest.mark.integration
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_local_postgresql_accepts_connections_and_alembic_migrations() -> None:
    if os.environ.get("RUN_POSTGRES_INTEGRATION_TESTS") != "1":
        pytest.skip("Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run PostgreSQL integration tests.")

    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.fail("TEST_DATABASE_URL must point to a dedicated local test database.")

    url = make_url(database_url)
    if (
        url.get_backend_name() != "postgresql"
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or url.port not in {5432, 54322}
    ):
        pytest.fail(
            "PostgreSQL tests are restricted to a local test database on the expected port."
        )

    environment = {
        **os.environ,
        "DATABASE_URL": database_url,
        "TEST_DATABASE_URL": database_url,
    }
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
            assert (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
                == "0009_project_concepts"
            )
    finally:
        engine.dispose()
