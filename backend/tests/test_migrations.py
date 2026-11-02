import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect


def test_sqlite_migrations_roundtrip_and_match_metadata(tmp_path):
    url = f"sqlite:///{(tmp_path / 'migration.db').as_posix()}"
    environment = {**os.environ, "TEST_DATABASE_URL": url, "DATABASE_URL": url}
    root = Path(__file__).resolve().parents[1]

    def alembic(*args):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=root,
            env=environment,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr

    alembic("upgrade", "head")
    alembic("check")
    engine = create_engine(url)
    try:
        assert {"projects", "deliverable_types", "references", "user_preferences"} <= set(
            inspect(engine).get_table_names()
        )
    finally:
        engine.dispose()
    alembic("downgrade", "0001_baseline")
    alembic("upgrade", "head")
