"""Owner-scoped, content-free operational summaries. No provider requests."""
import json
import math
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Response
from sqlalchemy import select

from app.api.library import DB, User
from app.db.models import Generation, now
from app.job_recovery import expire_jobs

router = APIRouter(prefix="/api/v1")
REASONS = {"authentication", "permission", "model_unavailable", "quota", "rate_limit",
           "invalid_request", "safety", "upstream", "timeout", "connection", "rejected"}


@router.get("/generation-metrics")
def metrics(user: User, db: DB, response: Response, days: Literal["7", "30"] = "7"):
    response.headers["Cache-Control"] = "no-store"
    period_days = int(days)
    end = now()
    start = end.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=period_days - 1)
    expire_jobs(db, owner_id=user.id)
    db.commit()
    # Never select image, note, instruction, key, URL, IDs or raw provider errors.
    rows = db.execute(select(
        Generation.status, Generation.operation, Generation.elapsed_ms,
        Generation.usage_json, Generation.provider_reason,
    ).where(Generation.owner_id == user.id,
            Generation.created_at >= start, Generation.created_at <= end)).all()
    statuses = dict.fromkeys(("queued", "processing", "succeeded", "failed", "unknown"), 0)
    operations = {"generate": 0, "edit": 0}
    reasons = {}
    latencies = []
    total_tokens = known_usage = missing_usage = 0
    for status, operation, elapsed, usage_json, reason in rows:
        statuses[status if status in statuses else "unknown"] += 1
        if operation in operations:
            operations[operation] += 1
        if status not in {"succeeded", "failed", "unknown"}:
            continue
        if type(elapsed) is int and elapsed >= 0:
            latencies.append(elapsed)
        try:
            usage = json.loads(usage_json) if usage_json else {}
            tokens = usage.get("total_tokens") if isinstance(usage, dict) else None
        except (ValueError, TypeError):
            tokens = None
        if type(tokens) is int and 0 <= tokens <= 1_000_000_000:
            known_usage += 1
            total_tokens += tokens
        else:
            missing_usage += 1
        if status in {"failed", "unknown"}:
            category = reason if reason in REASONS else "unspecified"
            reasons[category] = reasons.get(category, 0) + 1
    latencies.sort()
    terminal = statuses["succeeded"] + statuses["failed"] + statuses["unknown"]
    return {"scope": "current_user", "days": period_days, "start_utc": start, "end_utc": end,
            "includes_deleted": True, "total": len(rows), "statuses": statuses,
            "operations": operations, "terminal_count": terminal,
            "success_rate": statuses["succeeded"] / terminal if terminal else None,
            "failure_reasons": reasons,
            "latency": {"samples": len(latencies),
                        "average_ms": round(sum(latencies) / len(latencies)) if latencies else None,
                        "p95_ms": latencies[math.ceil(len(latencies) * .95) - 1]
                        if latencies else None},
            "usage": {"known_jobs": known_usage, "missing_jobs": missing_usage,
                      "total_tokens": total_tokens}, "actual_billed_usd": None}
