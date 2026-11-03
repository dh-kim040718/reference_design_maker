"""Admission reservations, optionally scoped to an explicitly approved new period.

Historical records and the lifetime ledger are retained; periods do not reconcile
past invoices or guarantee the provider's actual charge.
"""
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.api.library import fail
from app.db.models import Generation, GenerationBudget


def micro(value):
    return int(value * 1_000_000)


def state(db, settings):
    ledger = db.get(GenerationBudget, 1)
    used = ledger.reserved_micro_usd if ledger else 0
    lifetime_reserved = used
    legacy = db.scalar(select(func.count()).select_from(Generation).where(
        Generation.reserved_micro_usd.is_(None)))
    known = db.scalar(select(func.coalesce(func.sum(Generation.reserved_micro_usd), 0)))
    historical_legacy = 0
    if settings.generation_budget_start_at:
        before = Generation.created_at < settings.generation_budget_start_at
        historical_legacy = db.scalar(select(func.count()).select_from(Generation).where(
            before, Generation.reserved_micro_usd.is_(None)))
        previous_reservations = db.scalar(select(func.coalesce(func.sum(Generation.reserved_micro_usd), 0)).where(before))
        legacy -= historical_legacy
        used = max(0, used - previous_reservations)
    cap = micro(settings.generation_budget_usd)
    per_call = micro(settings.generation_reservation_usd)
    reason = ("budget_unconfigured" if cap == 0 else "billing_reconciliation_required" if legacy
              else "budget_ledger_inconsistent" if known > lifetime_reserved
              else "budget_exhausted" if used + per_call > cap else "")
    return {"available": not reason, "reason": reason, "limit_micro_usd": cap,
            "reserved_micro_usd": used, "per_request_micro_usd": per_call,
            "remaining_micro_usd": max(0, cap - used), "unreconciled_jobs": legacy,
            "historical_unreconciled_jobs": historical_legacy,
            "budget_start_at": settings.generation_budget_start_at.isoformat() if settings.generation_budget_start_at else None,
            "actual_billed_usd": None}


def reserve(db, settings):
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    db.execute(insert(GenerationBudget).values(id=1, reserved_micro_usd=0)
               .on_conflict_do_nothing())
    ledger = db.scalar(select(GenerationBudget).where(GenerationBudget.id == 1).with_for_update())
    info = state(db, settings)
    if not info["available"]:
        fail(503 if info["reason"] != "budget_exhausted" else 429,
             info["reason"].upper(), "AI 예산 설정·잔여 금액·이전 사용 내역을 확인해야 합니다.")
    amount = info["per_request_micro_usd"]
    ledger.reserved_micro_usd += amount
    return amount
