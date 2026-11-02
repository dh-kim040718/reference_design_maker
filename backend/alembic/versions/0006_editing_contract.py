"""Separate edit operation and existing design direction; never store source/mask."""
import sqlalchemy as sa

from alembic import op

revision = "0006_editing_contract"
down_revision = "0005_generation_usage"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("generations", sa.Column("operation", sa.String(16), nullable=False,
                                          server_default="generate"))
    op.add_column("generations", sa.Column("direction", sa.Text(), nullable=False,
                                          server_default=""))


def downgrade():
    op.drop_column("generations", "direction")
    op.drop_column("generations", "operation")
