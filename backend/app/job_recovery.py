"""Expire uncertain jobs without storing input images or replaying paid requests."""
import asyncio
import logging
from datetime import timedelta

from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.models import Generation, now

STALE_AFTER = timedelta(minutes=5)
SWEEP_INTERVAL = 30
logger = logging.getLogger(__name__)


def expire_jobs(db, *, owner_id=None, job_id=None):
    statement = update(Generation).where(
        Generation.status.in_(["queued", "processing"]),
        Generation.updated_at < now() - STALE_AFTER,
    )
    if owner_id is not None:
        statement = statement.where(Generation.owner_id == owner_id)
    if job_id is not None:
        statement = statement.where(Generation.id == job_id)
    result = db.execute(statement.values(
        status="unknown", error_code="OUTCOME_UNKNOWN", updated_at=now(),
    ).execution_options(synchronize_session="fetch"))
    return result.rowcount


def sweep(bind):
    try:
        with Session(bind=bind) as db:
            count = expire_jobs(db)
            db.commit()
            if count:
                logger.info("Expired generation jobs: %d", count)
            return count
    except SQLAlchemyError:
        # Database exceptions may include credentials or SQL parameters. Never log the exception.
        logger.warning("Generation recovery database unavailable; next sweep will retry.")
        return None


async def recovery_loop(bind):
    while True:
        await asyncio.sleep(SWEEP_INTERVAL)
        await asyncio.to_thread(sweep, bind)
