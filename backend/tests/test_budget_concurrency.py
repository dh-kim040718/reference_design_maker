from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from test_library import postgres_engine as postgres_engine  # noqa: F401

from app import budget
from app.core.settings import Settings
from app.db.base import Base
from app.db.models import GenerationBudget

pytestmark = pytest.mark.integration


def test_two_connections_cannot_reserve_the_same_last_dollar(postgres_engine):
    # A unique schema keeps this race independent of other test transactions and application data.
    schema = "test_budget_" + uuid4().hex
    with postgres_engine.begin() as connection:
        connection.execute(text('CREATE SCHEMA "' + schema + '"'))
    isolated = postgres_engine.execution_options(schema_translate_map={None: schema})
    try:
        Base.metadata.create_all(isolated)
        barrier = Barrier(2)
        settings = Settings(_env_file=None, generation_budget_usd="1")

        def attempt():
            with Session(isolated) as db:
                barrier.wait(timeout=10)
                try:
                    budget.reserve(db, settings)
                    db.commit()
                    return "accepted"
                except HTTPException as error:
                    db.rollback()
                    assert error.status_code == 429
                    return "rejected"

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: attempt(), range(2)))
        assert sorted(outcomes) == ["accepted", "rejected"]
        with Session(isolated) as db:
            assert db.get(GenerationBudget, 1).reserved_micro_usd == 1_000_000
    finally:
        # Only the exact, newly created random test schema is removed.
        assert schema.startswith("test_budget_") and len(schema) == 44
        with postgres_engine.begin() as connection:
            connection.execute(text('DROP SCHEMA "' + schema + '" CASCADE'))
