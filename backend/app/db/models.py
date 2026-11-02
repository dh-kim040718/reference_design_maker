from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def now() -> datetime:
    return datetime.now(UTC)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Project(Timestamps, Base):
    __tablename__ = "projects"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(Uuid)
    name: Mapped[str] = mapped_column(String(100))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_projects_owner", "owner_id", "archived_at", "updated_at", "id"),)


class DeliverableType(Timestamps, Base):
    __tablename__ = "deliverable_types"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(100))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_types_project", "project_id", "archived_at", "updated_at", "id"),)


class Reference(Timestamps, Base):
    __tablename__ = "references"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    deliverable_type_id: Mapped[UUID] = mapped_column(
        ForeignKey("deliverable_types.id", ondelete="RESTRICT")
    )
    source_url: Mapped[str] = mapped_column(Text)
    preview_url: Mapped[str | None] = mapped_column(Text)
    preview_source: Mapped[str | None] = mapped_column(String(32))
    title: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    design_note: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index("ix_references_type", "deliverable_type_id", "created_at", "id"),)


class UserPreference(Base):
    __tablename__ = "user_preferences"
    owner_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    last_deliverable_type_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("deliverable_types.id", ondelete="RESTRICT")
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Generation(Timestamps, Base):
    __tablename__ = "generations"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(Uuid)
    reference_id: Mapped[UUID] = mapped_column(ForeignKey("references.id", ondelete="RESTRICT"))
    request_id: Mapped[UUID] = mapped_column(Uuid)
    request_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    instruction: Mapped[str] = mapped_column(Text)
    operation: Mapped[str] = mapped_column(
        String(16), default="generate", server_default="generate")
    direction: Mapped[str] = mapped_column(Text, default="", server_default="")
    note_snapshot: Mapped[str] = mapped_column(Text)
    result_image: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(40))
    provider_http_status: Mapped[int | None] = mapped_column(Integer)
    provider_reason: Mapped[str | None] = mapped_column(String(32))
    reserved_micro_usd: Mapped[int | None] = mapped_column(BigInteger)
    model: Mapped[str] = mapped_column(String(80), default="gpt-image-2.5-flare-2026-09-08")
    usage_json: Mapped[str | None] = mapped_column(Text)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("owner_id", "request_id", name="uq_generation_request"),
        Index("ix_generation_owner_created", "owner_id", "created_at"),
    )


class GenerationQuota(Base):
    __tablename__ = "generation_quotas"
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    used: Mapped[int] = mapped_column(Integer, default=0)


class GenerationBudget(Base):
    __tablename__ = "generation_budget"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reserved_micro_usd: Mapped[int] = mapped_column(BigInteger, default=0)
