"""Create the Phase 2 library schema."""

import sqlalchemy as sa

from alembic import op

revision = "0002_library"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_projects_owner", "projects", ["owner_id", "archived_at", "updated_at", "id"]
    )
    op.create_table(
        "deliverable_types",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_types_project", "deliverable_types", ["project_id", "archived_at", "updated_at", "id"]
    )
    op.create_table(
        "references",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "deliverable_type_id",
            sa.Uuid(),
            sa.ForeignKey("deliverable_types.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(200)),
        sa.Column("description", sa.Text()),
        sa.Column("design_note", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_references_type", "references", ["deliverable_type_id", "created_at", "id"])
    op.create_table(
        "user_preferences",
        sa.Column("owner_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "last_deliverable_type_id",
            sa.Uuid(),
            sa.ForeignKey("deliverable_types.id", ondelete="RESTRICT"),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("user_preferences")
    op.drop_table("references")
    op.drop_table("deliverable_types")
    op.drop_table("projects")
