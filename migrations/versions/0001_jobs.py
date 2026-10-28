"""Create durable jobs and transition events."""

import sqlalchemy as sa
from alembic import op

revision = "0001_jobs"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), unique=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("result", sa.JSON()),
        sa.Column("error", sa.String(500)),
        sa.Column("lease_token", sa.String(36)),
        sa.Column("lease_expires_at", sa.Float()),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.Float(), nullable=False),
        sa.Column("started_at", sa.Float()),
        sa.Column("finished_at", sa.Float()),
        sa.CheckConstraint(
            "status IN ('queued','running','succeeded','failed','cancelled')",
            name="ck_jobs_status",
        ),
        sa.CheckConstraint("progress >= 0 AND progress <= 1", name="ck_jobs_progress"),
        sa.CheckConstraint("attempts >= 0 AND attempts <= max_attempts", name="ck_jobs_attempts"),
        sa.CheckConstraint("max_attempts BETWEEN 1 AND 5", name="ck_jobs_max_attempts"),
    )
    op.create_index("ix_jobs_status_created", "jobs", ["status", "created_at", "id"])
    op.create_index("ix_jobs_status_lease", "jobs", ["status", "lease_expires_at"])
    op.create_table(
        "job_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "job_id", sa.String(36), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("message", sa.String(160), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
    )
    op.create_index("ix_job_events_job_id_id", "job_events", ["job_id", "id"])


def downgrade():
    op.drop_table("job_events")
    op.drop_table("jobs")
