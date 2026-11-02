"""Persist shared monetary reservations. Historical charges require reconciliation."""
import sqlalchemy as sa

from alembic import op

revision = "0008_budget_reservations"
down_revision = "0007_safe_diagnostics"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("generations", sa.Column("reserved_micro_usd", sa.BigInteger()))
    op.create_table("generation_budget",
                    sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("reserved_micro_usd", sa.BigInteger(), nullable=False))


def downgrade():
    op.drop_table("generation_budget")
    op.drop_column("generations", "reserved_micro_usd")
