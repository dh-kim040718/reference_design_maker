"""Project-wide concepts with immutable metadata snapshots; keep legacy reference jobs."""
import sqlalchemy as sa

from alembic import op

revision = "0009_project_concepts"
down_revision = "0008_budget_reservations"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("projects", sa.Column("brief", sa.Text(), nullable=False, server_default=""))
    with op.batch_alter_table("generations") as batch:
        batch.alter_column("reference_id", existing_type=sa.Uuid(), nullable=True)
        batch.add_column(sa.Column("project_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("scope", sa.String(16), nullable=False,
                                   server_default="reference"))
        batch.add_column(sa.Column("project_snapshot_json", sa.Text()))
        batch.create_foreign_key("fk_generation_project", "projects", ["project_id"], ["id"],
                                 ondelete="RESTRICT")
    op.execute('UPDATE generations SET project_id=(SELECT deliverable_types.project_id '
               'FROM "references" JOIN deliverable_types ON '
               '"references".deliverable_type_id=deliverable_types.id '
               'WHERE "references".id=generations.reference_id)')


def downgrade():
    connection = op.get_bind()
    concepts = connection.scalar(sa.text(
        "SELECT COUNT(*) FROM generations WHERE reference_id IS NULL"))
    briefs = connection.scalar(sa.text("SELECT COUNT(*) FROM projects WHERE brief <> ''"))
    if concepts or briefs:
        raise RuntimeError(
            "Project concepts exist; downgrade would lose data. Export before downgrading.")
    with op.batch_alter_table("generations") as batch:
        batch.drop_constraint("fk_generation_project", type_="foreignkey")
        batch.drop_column("project_snapshot_json")
        batch.drop_column("scope")
        batch.drop_column("project_id")
        batch.alter_column("reference_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_column("projects", "brief")
