import hashlib
import json
import logging
import time
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import budget
from app.api.editing import get_edit_provider, validate_mask
from app.api.generation_provider import (
    MAX_RESULT,
    MODEL,
    ProviderFailure,
    decode_image,
    generation_size,
    get_image_provider,
)
from app.api.library import DB, User, fail, reference, writable
from app.core.settings import get_settings
from app.db.models import Generation, GenerationQuota, now
from app.job_recovery import expire_jobs

router = APIRouter(prefix="/api/v1")
Provider = Annotated[object, Depends(get_image_provider)]
EditProvider = Annotated[object, Depends(get_edit_provider)]
DAILY_LIMIT = 3
logger = logging.getLogger(__name__)


class GenerationInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    source_image: str = Field(max_length=11_200_000)
    instruction: str = Field(default="", max_length=2000)
    rights_confirmed: bool = False


class EditInput(GenerationInput):
    mask_image: str = Field(max_length=11_200_000)
    direction: str = Field(default="", max_length=5000)


def metadata(job):
    return {
        "id": job.id,
        "reference_id": job.reference_id,
        "status": job.status,
        "project_id": job.project_id,
        "scope": job.scope,
        "operation": job.operation,
        "direction": job.direction,
        "instruction": job.instruction,
        "note_snapshot": job.note_snapshot,
        "created_at": job.created_at,
        "error_code": job.error_code,
        "provider_http_status": job.provider_http_status,
        "provider_reason": job.provider_reason,
        "model": job.model,
        "quality": "low",
        "size": "1024x1024",
        "elapsed_ms": job.elapsed_ms,
        "usage": json.loads(job.usage_json) if job.usage_json else None,
    }


def stale(db, job):
    if expire_jobs(db, job_id=job.id):
        db.commit()
        db.refresh(job)


@router.get("/generation-policy")
def policy(user: User, db: DB, response: Response, edit_provider: EditProvider):
    response.headers["Cache-Control"] = "no-store"
    settings = get_settings()
    quota = db.get(GenerationQuota, now().date())
    allowance = budget.state(db, settings)
    return {
        "enabled": bool(
            settings.image_generation_enabled and settings.openai_api_key and allowance["available"]
        ),
        "editing_enabled": bool(
            settings.image_editing_enabled and edit_provider is not None and allowance["available"]
        ),
        "budget": allowance,
        "reason": "approval_required"
        if not settings.image_generation_enabled
        else "key_missing"
        if not settings.openai_api_key
        else allowance["reason"],
        "model": MODEL,
        "quality": "low",
        "size": "1024x1024",
        "daily_limit": settings.generation_daily_limit,
        "remaining": max(0, settings.generation_daily_limit - (quota.used if quota else 0)),
        "rates_usd_per_million": {"text_input": 5, "image_input": 8, "output": 30},
    }


def execute_job(bind, job_id, source, provider, mask=None):
    try:
        _execute_job(bind, job_id, source, provider, mask)
    except SQLAlchemyError:
        # Parameters can contain private images/prompts. Do not let a DB traceback log them.
        logger.warning("Generation worker database failure; outcome may be unknown. No retry.")


def _execute_job(bind, job_id, source, provider, mask=None):
    with Session(bind=bind, join_transaction_mode="create_savepoint") as db:
        expire_jobs(db, job_id=job_id)
        claimed = db.execute(
            update(Generation)
            .where(Generation.id == job_id, Generation.status == "queued")
            .values(status="processing", updated_at=now())
        )
        db.commit()
        if claimed.rowcount != 1:
            return
        job = db.get(Generation, job_id)
        prompt = (
            "Create one original design exploration concept inspired by the full reference image. "
            "Preserve useful layout ideas, but do not copy logos, branding or text verbatim. "
            "This is an AI concept, not a finished product. User design notes: "
            + job.note_snapshot
            + "\nAdditional instructions: "
            + job.instruction
        )
        if job.operation == "edit":
            prompt = (
                "Edit only the transparent mask area. Preserve the protected area and existing "
                "design direction. Do not copy logos or branding. AI exploration concept only.\n"
                "Existing design direction: "
                + job.direction
                + "\nReference design notes: "
                + job.note_snapshot
                + "\nLocal edit instruction: "
                + (job.instruction or "Explore a variation inside the selected area only.")
            )
        if job.scope == "project":
            from app.api.project_concepts import project_prompt

            prompt = project_prompt(json.loads(job.project_snapshot_json), job.instruction)
        safety_id = hashlib.sha256(str(job.owner_id).encode()).hexdigest()
        db.commit()
        started = time.monotonic()
        try:
            specification = (
                json.loads(job.project_snapshot_json).get("design_settings")
                if job.scope == "project" and job.project_snapshot_json
                else None
            )
            size = (
                f"{specification['generation_width']}x{specification['generation_height']}"
                if specification
                else "1024x1024"
            )
            with generation_size(size):
                result, usage = (
                    provider(source, mask, prompt, safety_id)
                    if mask is not None
                    else provider(source, prompt, safety_id)
                )
            if specification:
                from app.api.design_settings import export_result

                result = export_result(result, specification)
            # Validate even injected providers before persisting private output.
            decode_image(result, max_bytes=MAX_RESULT)
            changes = {
                "result_image": result,
                "usage_json": json.dumps(usage),
                "status": "succeeded",
                "error_code": None,
            }
        except ProviderFailure as error:
            changes = {
                "status": "unknown" if error.code == "OUTCOME_UNKNOWN" else "failed",
                "error_code": error.code,
                "provider_http_status": error.http_status,
                "provider_reason": error.reason,
            }
        except Exception:
            changes = {"status": "unknown", "error_code": "OUTCOME_UNKNOWN"}
        changes.update(elapsed_ms=int((time.monotonic() - started) * 1000), updated_at=now())
        # A sweep may have expired the job and allowed deletion while the provider was running.
        # Never resurrect its image or overwrite a newer state with a late response.
        db.execute(
            update(Generation)
            .where(
                Generation.id == job_id,
                Generation.status == "processing",
                Generation.deleted_at.is_(None),
            )
            .values(**changes)
        )
        db.commit()


@router.post("/references/{item_id}/generations", status_code=202)
def create(
    item_id: UUID,
    data: GenerationInput,
    user: User,
    db: DB,
    background: BackgroundTasks,
    provider: Provider,
):
    return reserve(item_id, data, user, db, background, provider)


@router.post("/references/{item_id}/edits", status_code=202)
def create_edit(
    item_id: UUID,
    data: EditInput,
    user: User,
    db: DB,
    background: BackgroundTasks,
    provider: EditProvider,
):
    return reserve(item_id, data, user, db, background, provider, editing=True)


def reserve(item_id, data, user, db, background, provider, editing=False):
    item, kind, parent = reference(db, user, item_id, lock=True)
    writable(parent, kind)
    if not data.rights_confirmed:
        fail(422, "RIGHTS_REQUIRED", "입력 이미지의 사용 권한을 확인해 주세요.")
    try:
        decode_image(data.source_image)
    except ProviderFailure:
        fail(422, "INVALID_IMAGE", "PNG·JPEG·WebP 이미지(8MB·1,600만 화소 이하)를 선택해 주세요.")
    if editing:
        try:
            validate_mask(data.source_image, data.mask_image)
        except ProviderFailure:
            fail(
                422,
                "INVALID_MASK",
                "원본과 같은 크기의 PNG 마스크에 투명 선택 영역과 보호 영역이 필요합니다.",
            )
    # Keep existing generation hashes stable; new edit requests use unambiguous serialization.
    content = (
        json.dumps(
            [
                "edit",
                str(item_id),
                data.source_image,
                data.mask_image,
                data.direction,
                data.instruction,
            ],
            ensure_ascii=False,
        )
        if editing
        else str(item_id) + "\0" + data.source_image + "\0" + data.instruction
    )
    digest = hashlib.sha256(content.encode()).hexdigest()
    return enqueue(
        db,
        user,
        data.request_id,
        digest,
        data.instruction,
        provider,
        background,
        data.source_image,
        editing=editing,
        mask=data.mask_image if editing else None,
        fields={
            "reference_id": item_id,
            "project_id": parent.id,
            "direction": data.direction if editing else "",
            "note_snapshot": item.design_note or "",
        },
    )


def enqueue(
    db,
    user,
    request_id,
    digest,
    instruction,
    provider,
    background,
    source,
    *,
    editing=False,
    fields=None,
    mask=None,
):
    fields = fields or {}
    # Serialize all paid reservations; no transaction remains open during the API call.
    day = now().date()
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    db.execute(insert(GenerationQuota).values(day=day, used=0).on_conflict_do_nothing())
    quota = db.scalar(select(GenerationQuota).where(GenerationQuota.day == day).with_for_update())
    expire_jobs(db, owner_id=user.id)
    existing = db.scalar(
        select(Generation).where(
            Generation.owner_id == user.id, Generation.request_id == request_id
        )
    )
    if existing:
        if (
            existing.scope != fields.get("scope", "reference")
            or existing.operation != ("edit" if editing else "generate")
            or existing.request_hash != digest
        ):
            fail(409, "REQUEST_CHANGED", "입력이 변경되었습니다. 새 요청으로 생성해 주세요.")
        result = metadata(existing)
        db.commit()
        return result
    settings = get_settings()
    if editing and (not settings.image_editing_enabled or provider is None):
        fail(503, "EDITING_DISABLED", "영역 편집은 연동·품질 검증 후 활성화됩니다.")
    if not editing and (not settings.image_generation_enabled or not settings.openai_api_key):
        fail(503, "GENERATION_DISABLED", "AI 생성은 모델·비용 승인 후 활성화됩니다.")
    active = db.scalar(
        select(func.count())
        .select_from(Generation)
        .where(Generation.owner_id == user.id, Generation.status.in_(["queued", "processing"]))
    )
    if active:
        fail(409, "GENERATION_ACTIVE", "진행 중인 생성 결과를 먼저 확인해 주세요.")
    if quota.used >= settings.generation_daily_limit:
        fail(429, "DAILY_LIMIT", "오늘의 전체 생성 한도를 사용했습니다. UTC 자정에 초기화됩니다.")
    quota.used += 1
    reservation = budget.reserve(db, settings)
    job = Generation(
        owner_id=user.id,
        request_id=request_id,
        operation="edit" if editing else "generate",
        reserved_micro_usd=reservation,
        request_hash=digest,
        instruction=instruction,
        status="queued",
        model=MODEL,
        **fields,
    )
    db.add(job)
    db.flush()
    result = metadata(job)
    job_id = job.id
    bind = db.get_bind()
    db.commit()
    background.add_task(execute_job, bind, job_id, source, provider, mask)
    return result


@router.get("/references/{item_id}/generations")
def listing(item_id: UUID, user: User, db: DB, response: Response):
    reference(db, user, item_id)
    response.headers["Cache-Control"] = "no-store"
    jobs = db.scalars(
        select(Generation)
        .where(
            Generation.owner_id == user.id,
            Generation.reference_id == item_id,
            Generation.deleted_at.is_(None),
        )
        .order_by(Generation.created_at.desc())
        .limit(30)
    ).all()
    for job in jobs:
        stale(db, job)
    return {"items": [metadata(job) for job in jobs]}


def owned(db, user, job_id):
    job = db.scalar(
        select(Generation).where(
            Generation.id == job_id, Generation.owner_id == user.id, Generation.deleted_at.is_(None)
        )
    )
    if job is None:
        fail(404, "NOT_FOUND", "생성 결과를 찾을 수 없습니다.")
    stale(db, job)
    return job


@router.get("/generations/{job_id}")
def detail(job_id: UUID, user: User, db: DB, response: Response):
    response.headers["Cache-Control"] = "no-store"
    job = owned(db, user, job_id)
    return {
        **metadata(job),
        "result_image": job.result_image,
        "project_snapshot": json.loads(job.project_snapshot_json)
        if job.project_snapshot_json
        else None,
    }


@router.delete("/generations/{job_id}", status_code=204)
def delete(job_id: UUID, user: User, db: DB):
    job = owned(db, user, job_id)
    if job.status in {"queued", "processing"}:
        fail(409, "GENERATION_ACTIVE", "생성이 끝난 뒤 삭제할 수 있습니다.")
    job.result_image = None
    job.deleted_at = now()
    db.commit()
