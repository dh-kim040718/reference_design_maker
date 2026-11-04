"""Optional reference roles and normalized region notes; no original images."""
import sqlalchemy as sa
from alembic import op

revision = "0010_reference_guidance"
down_revision = "0009_project_concepts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("references", sa.Column("design_guidance_json", sa.Text(), nullable=True))


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT COUNT(*) FROM "references" WHERE design_guidance_json IS NOT NULL')):
        raise RuntimeError("Reference guidance exists; export before downgrading.")
    op.drop_column("references", "design_guidance_json")
