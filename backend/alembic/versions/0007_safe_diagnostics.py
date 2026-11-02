"""Store HTTP status and allowlisted diagnostics, never raw provider errors."""
import sqlalchemy as sa

from alembic import op

revision = "0007_safe_diagnostics"
down_revision = "0006_editing_contract"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("generations", sa.Column("provider_http_status", sa.Integer()))
    op.add_column("generations", sa.Column("provider_reason", sa.String(32)))


def downgrade():
    op.drop_column("generations", "provider_reason")
    op.drop_column("generations", "provider_http_status")
