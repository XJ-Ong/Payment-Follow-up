"""Initial schema; verify existing databases before adopting them."""
from alembic import op
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, CheckConstraint
from migrations.schema_v1 import Base
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    connection = op.get_bind()
    existing = set(inspect(connection).get_table_names()) - {"alembic_version"}
    if not existing:
        Base.metadata.create_all(connection)
        return
    differences = compare_metadata(MigrationContext.configure(connection, opts={"compare_type": True}), Base.metadata)
    inspector = inspect(connection)
    for table in Base.metadata.sorted_tables:
        if table.name in existing:
            expected = {c.name for c in table.constraints if isinstance(c, CheckConstraint)}
            actual = {c["name"] for c in inspector.get_check_constraints(table.name)}
            if actual != expected:
                differences.append(("check_constraint_names", table.name, expected, actual))
    if differences:
        raise RuntimeError("Existing schema differs from baseline. Review schema differences before migrating; no business tables were changed: " + repr(differences))

def downgrade():
    raise RuntimeError("Baseline downgrade is disabled to preserve demo data")
