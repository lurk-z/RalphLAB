"""Durable lab work orders and explicitly granted read access."""

from alembic import op
import sqlalchemy as sa

revision = "20261121_0011"
down_revision = "20260821_0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "lab_work_orders",
        sa.Column(
            "project_id", sa.Integer, sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("request", sa.JSON, nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("events", sa.JSON, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "lab_work_order_readers",
        sa.Column(
            "project_id", sa.Integer, sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("email", sa.String(254), primary_key=True),
    )


def downgrade():
    op.drop_table("lab_work_order_readers")
    op.drop_table("lab_work_orders")
