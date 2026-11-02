"""Store optional reference thumbnails and their provenance."""

import sqlalchemy as sa

from alembic import op

revision = "0003_thumbnails"
down_revision = "0002_library"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("references", sa.Column("preview_url", sa.Text(), nullable=True))
    op.add_column("references", sa.Column("preview_source", sa.String(32), nullable=True))


def downgrade():
    op.drop_column("references", "preview_source")
    op.drop_column("references", "preview_url")
