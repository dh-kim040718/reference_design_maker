from datetime import UTC
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.preview_cache import cached_preview
from app.api.schemas import (
    ClassificationPatch,
    NameInput,
    NoteInput,
    PreviewInput,
    ReferenceInput,
    ThumbnailInput,
)
from app.auth.dependencies import AuthenticatedUser, get_current_user
from app.db.models import DeliverableType, Project, Reference, UserPreference, now
from app.db.session import get_db

router = APIRouter(prefix="/api/v1")
DB = Annotated[Session, Depends(get_db)]
User = Annotated[AuthenticatedUser, Depends(get_current_user)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


def fail(status: int, code: str, message: str):
    raise HTTPException(status, detail={"code": code, "message": message, "fields": []})


def project(db: Session, user: AuthenticatedUser, item_id: UUID, lock=False) -> Project:
    query = select(Project).where(Project.id == item_id, Project.owner_id == user.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    result = db.scalar(query)
    if result is None:
        fail(404, "NOT_FOUND", "항목을 찾을 수 없습니다.")
    return result


def category(db: Session, user: AuthenticatedUser, item_id: UUID, lock=False):
    item = db.scalar(
        select(DeliverableType)
        .join(Project)
        .where(
            DeliverableType.id == item_id,
            Project.owner_id == user.id,
        )
    )
    if item is None:
        fail(404, "NOT_FOUND", "항목을 찾을 수 없습니다.")
    parent = project(db, user, item.project_id, lock)
    if lock:
        item = db.scalar(
            select(DeliverableType)
            .where(DeliverableType.id == item_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    return item, parent


def reference(db: Session, user: AuthenticatedUser, item_id: UUID, lock=False):
    item = db.scalar(
        select(Reference)
        .join(DeliverableType)
        .join(Project)
        .where(
            Reference.id == item_id,
            Project.owner_id == user.id,
        )
    )
    if item is None:
        fail(404, "NOT_FOUND", "항목을 찾을 수 없습니다.")
    kind, parent = category(db, user, item.deliverable_type_id, lock)
    return item, kind, parent


def writable(parent: Project, kind: DeliverableType | None = None):
    if parent.archived_at or (kind and kind.archived_at):
        fail(
            409, "ARCHIVED_PATH", "보관된 경로입니다. 보관을 해제하거나 다른 경로를 선택해 주세요."
        )


def serialize(item, **extra):
    result = {}
    for column in item.__table__.columns:
        if column.name == "owner_id":
            continue
        value = getattr(item, column.name)
        if hasattr(value, "tzinfo") and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        result[column.name] = value
    return {**result, **extra}


def kind_data(item, parent):
    return serialize(
        item, project_name=parent.name, read_only=bool(parent.archived_at or item.archived_at)
    )


def ref_data(item, kind, parent):
    return serialize(
        item,
        project_id=parent.id,
        project_name=parent.name,
        deliverable_type_name=kind.name,
        read_only=bool(parent.archived_at or kind.archived_at),
    )


def page(db, query, limit, offset, convert):
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    return {
        "items": [convert(x) for x in db.scalars(query.limit(limit).offset(offset))],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def cover(db, *, project_id=None, type_id=None):
    query = (
        select(Reference.preview_url)
        .join(DeliverableType)
        .where(Reference.preview_url.is_not(None))
    )
    query = (
        query.where(DeliverableType.id == type_id)
        if type_id
        else query.where(DeliverableType.project_id == project_id)
    )
    return db.scalar(query.order_by(Reference.updated_at.desc(), Reference.id.desc()).limit(1))


@router.get("/projects")
def list_projects(
    db: DB, user: User, archived: bool = False, limit: Limit = 24, offset: Offset = 0
):
    query = select(Project).where(Project.owner_id == user.id)
    query = query.where(
        Project.archived_at.is_not(None) if archived else Project.archived_at.is_(None)
    )
    return page(
        db,
        query.order_by(Project.updated_at.desc(), Project.id.desc()),
        limit,
        offset,
        lambda item: serialize(item, thumbnail_url=cover(db, project_id=item.id)),
    )


@router.post("/projects", status_code=201)
def create_project(body: NameInput, db: DB, user: User):
    item = Project(owner_id=user.id, name=body.name)
    db.add(item)
    db.commit()
    return serialize(item)


@router.get("/projects/{item_id}")
def get_project(item_id: UUID, db: DB, user: User):
    return serialize(project(db, user, item_id))


@router.patch("/projects/{item_id}")
def update_project(item_id: UUID, body: ClassificationPatch, db: DB, user: User):
    item = project(db, user, item_id, True)
    if body.archived is False:
        item.archived_at = None
    else:
        writable(item)
        if body.archived:
            item.archived_at = now()
        else:
            item.name = body.name
    item.updated_at = now()
    db.commit()
    return serialize(item)


@router.get("/projects/{item_id}/deliverable-types")
def list_types(
    item_id: UUID, db: DB, user: User, archived: bool = False, limit: Limit = 24, offset: Offset = 0
):
    parent = project(db, user, item_id)
    query = select(DeliverableType).where(DeliverableType.project_id == parent.id)
    query = query.where(
        DeliverableType.archived_at.is_not(None)
        if archived
        else DeliverableType.archived_at.is_(None)
    )
    return page(
        db,
        query.order_by(DeliverableType.updated_at.desc(), DeliverableType.id.desc()),
        limit,
        offset,
        lambda item: {**kind_data(item, parent), "thumbnail_url": cover(db, type_id=item.id)},
    )


@router.post("/projects/{item_id}/deliverable-types", status_code=201)
def create_type(item_id: UUID, body: NameInput, db: DB, user: User):
    parent = project(db, user, item_id, True)
    writable(parent)
    item = DeliverableType(project_id=parent.id, name=body.name)
    db.add(item)
    db.commit()
    return kind_data(item, parent)


@router.get("/deliverable-types/{item_id}")
def get_type(item_id: UUID, db: DB, user: User):
    return kind_data(*category(db, user, item_id))


@router.patch("/deliverable-types/{item_id}")
def update_type(item_id: UUID, body: ClassificationPatch, db: DB, user: User):
    item, parent = category(db, user, item_id, True)
    writable(parent)
    if body.archived is False:
        item.archived_at = None
    else:
        writable(parent, item)
        if body.archived:
            item.archived_at = now()
        else:
            item.name = body.name
    item.updated_at = now()
    db.commit()
    return kind_data(item, parent)


@router.get("/deliverable-types/{item_id}/references")
def list_references(item_id: UUID, db: DB, user: User, limit: Limit = 24, offset: Offset = 0):
    kind, parent = category(db, user, item_id)
    query = select(Reference).where(Reference.deliverable_type_id == kind.id)
    return page(
        db,
        query.order_by(Reference.created_at.desc(), Reference.id.desc()),
        limit,
        offset,
        lambda item: ref_data(item, kind, parent),
    )


@router.get("/projects/{item_id}/references")
def list_project_references(item_id: UUID, db: DB, user: User,
                            limit: Limit = 24, offset: Offset = 0, archived: bool = False):
    parent = project(db, user, item_id)
    query = select(Reference).join(DeliverableType).where(DeliverableType.project_id == parent.id)
    query = query.where(DeliverableType.archived_at.is_not(None) if archived
                        else DeliverableType.archived_at.is_(None))
    return page(db, query.order_by(Reference.created_at.desc(), Reference.id.desc()),
                limit, offset, lambda item: ref_data(item, db.get(DeliverableType, item.deliverable_type_id), parent))


@router.post("/references", status_code=201)
def create_reference(body: ReferenceInput, db: DB, user: User):
    parent = project(db, user, body.project_id)
    kind, actual_parent = category(db, user, body.deliverable_type_id)
    if actual_parent.id != parent.id:
        fail(422, "PATH_MISMATCH", "선택한 프로젝트의 산출물 유형을 선택해 주세요.")
    kind, parent = category(db, user, kind.id, True)
    writable(parent, kind)
    item = Reference(**body.model_dump(exclude={"project_id"}))
    db.add(item)
    # Dialect upserts serialize first-use preferences without a read/insert race.
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    statement = insert(UserPreference).values(
        owner_id=user.id,
        last_deliverable_type_id=kind.id,
        updated_at=now(),
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=["owner_id"],
            set_={"last_deliverable_type_id": kind.id, "updated_at": now()},
        )
    )
    db.commit()
    return ref_data(item, kind, parent)


@router.get("/references/{item_id}")
def get_reference(item_id: UUID, db: DB, user: User):
    return ref_data(*reference(db, user, item_id))


@router.post("/references/preview")
def preview(body: PreviewInput, user: User):
    return cached_preview(str(user.id), body.source_url, refresh=body.refresh)


@router.patch("/references/{item_id}/thumbnail")
def update_thumbnail(item_id: UUID, body: ThumbnailInput, db: DB, user: User):
    item, kind, parent = reference(db, user, item_id, True)
    writable(parent, kind)
    item.preview_url = body.preview_url
    item.preview_source = body.preview_source if body.preview_url else None
    db.commit()
    return ref_data(item, kind, parent)


@router.patch("/references/{item_id}")
def update_reference(item_id: UUID, body: NoteInput, db: DB, user: User):
    item, kind, parent = reference(db, user, item_id, True)
    writable(parent, kind)
    if "design_note" in body.model_fields_set:
        item.design_note = body.design_note
    db.commit()
    return ref_data(item, kind, parent)


@router.get("/references/{item_id}/generation-source")
def generation_source(item_id: UUID, db: DB, user: User, response: Response,
                      version: str | None = None):
    """Read only this user's saved image into bounded request memory; never persist it."""
    import base64
    import hashlib
    import http.client
    import io
    import json
    import time
    from PIL import Image
    from app.api.preview import fetch, PreviewUnavailable
    from app.api.generation_provider import decode_image, ProviderFailure

    response.headers["Cache-Control"] = "no-store"
    item, _, _ = reference(db, user, item_id)
    saved = item.preview_url
    actual = hashlib.sha256(json.dumps(saved, sort_keys=True, ensure_ascii=False,
                                       separators=(",", ":")).encode()).hexdigest()
    if version is not None and version != actual:
        fail(409, "PREVIEW_CHANGED", "이미지가 변경됐습니다. 입력을 새로고침해 주세요.")
    if not saved:
        fail(422, "IMAGE_MISSING", "저장된 이미지가 없습니다. 이미지를 교체해 주세요.")
    try:
        if saved.startswith("data:image/"):
            image = saved
        else:
            status, raw, _, _ = fetch(saved, time.monotonic() + 10, limit=8 * 1024 * 1024)
            if status != 200:
                raise ValueError("Unavailable image")
            with Image.open(io.BytesIO(raw)) as picture:
                mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(picture.format)
            if mime is None:
                raise ValueError("Unsupported image")
            image = f"data:{mime};base64," + base64.b64encode(raw).decode()
        decode_image(image)
    except (PreviewUnavailable, ProviderFailure, ValueError, OSError, TimeoutError,
            http.client.HTTPException, Image.DecompressionBombError):
        fail(422, "IMAGE_UNAVAILABLE", "이 이미지를 사용할 수 없습니다. PNG·JPEG·WebP 이미지로 교체해 주세요.")
    return {"image": image}


@router.get("/preferences")
def preferences(db: DB, user: User):
    pref = db.get(UserPreference, user.id)
    if pref and pref.last_deliverable_type_id:
        row = db.execute(
            select(DeliverableType, Project)
            .join(Project)
            .where(
                DeliverableType.id == pref.last_deliverable_type_id,
                Project.owner_id == user.id,
                Project.archived_at.is_(None),
                DeliverableType.archived_at.is_(None),
            )
        ).first()
        if row:
            return {"last_path": {"project_id": row[1].id, "deliverable_type_id": row[0].id}}
    return {"last_path": None}
