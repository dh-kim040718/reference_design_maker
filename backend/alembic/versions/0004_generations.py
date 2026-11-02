"""Private AI generation jobs and a serialized daily request allowance."""
import sqlalchemy as sa

from alembic import op

revision = "0004_generations"
down_revision = "0003_thumbnails"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "generations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("reference_id", sa.Uuid(),
                  sa.ForeignKey("references.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("note_snapshot", sa.Text(), nullable=False),
        sa.Column("result_image", sa.Text()),
        sa.Column("error_code", sa.String(40)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "request_id", name="uq_generation_request"),
    )
    op.create_index("ix_generation_owner_created", "generations", ["owner_id", "created_at"])
    op.create_table("generation_quotas", sa.Column("day", sa.Date(), primary_key=True),
                    sa.Column("used", sa.Integer(), nullable=False))


def downgrade():
    op.drop_table("generation_quotas")
    op.drop_index("ix_generation_owner_created", table_name="generations")
    op.drop_table("generations")
