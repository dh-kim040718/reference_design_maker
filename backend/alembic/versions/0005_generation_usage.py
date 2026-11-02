"""Record model, elapsed time and sanitized provider token usage."""
import sqlalchemy as sa

from alembic import op

revision = "0005_generation_usage"
down_revision = "0004_generations"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("generations", sa.Column("model", sa.String(80), nullable=False,
                  server_default="gpt-image-2.5-flare-2026-09-08"))
    op.add_column("generations", sa.Column("usage_json", sa.Text()))
    op.add_column("generations", sa.Column("elapsed_ms", sa.Integer()))


def downgrade():
    op.drop_column("generations", "elapsed_ms")
    op.drop_column("generations", "usage_json")
    op.drop_column("generations", "model")
