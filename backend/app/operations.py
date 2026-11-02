"""Local operator summary. Content-free JSON; never sends external alerts."""
import json

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.budget import state
from app.core.settings import get_settings
from app.db.models import Generation, now
from app.db.session import engine
from app.job_recovery import STALE_AFTER


def summary(db, settings):
    statuses = dict(db.execute(select(Generation.status, func.count()).group_by(
        Generation.status)).all())
    stale = db.scalar(select(func.count()).select_from(Generation).where(
        Generation.status.in_(["queued", "processing"]),
        Generation.updated_at < now() - STALE_AFTER))
    allowance = state(db, settings)
    alerts = []
    if stale:
        alerts.append("STALE_JOBS")
    if statuses.get("unknown", 0):
        alerts.append("UNCERTAIN_OUTCOMES")
    if allowance["unreconciled_jobs"]:
        alerts.append("BILLING_RECONCILIATION_REQUIRED")
    if (settings.image_generation_enabled or settings.image_editing_enabled) and not allowance[
        "available"
    ]:
        alerts.append("BUDGET_BLOCKED")
    return {"checked_at": now().isoformat(), "database": "reachable",
            "statuses": {name: statuses.get(name, 0) for name in (
                "queued", "processing", "succeeded", "failed", "unknown")},
            "stale_jobs": stale, "budget": allowance, "alerts": alerts,
            "auto_resume": False, "provider_calls": 0,
            "scope": "local_operator_only_not_public_api"}


def main():
    try:
        with Session(engine) as db:
            report = summary(db, get_settings())
        print(json.dumps(report))
        raise SystemExit(2 if report["alerts"] else 0)
    except SQLAlchemyError:
        print(json.dumps({"database": "unavailable", "alerts": ["DATABASE_UNAVAILABLE"],
                          "provider_calls": 0}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
