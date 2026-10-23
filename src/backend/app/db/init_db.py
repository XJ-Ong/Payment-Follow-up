"""Create the 11 plugin-owned tables (idempotent: existing tables are skipped).

Run from src/backend:  uv run python -m app.db.init_db
No migrations in the MVP (README): re-run after model changes, or drop and re-init.
"""

from sqlalchemy import inspect

from . import models  # noqa: F401  (importing registers every model on Base.metadata)
from .base import Base
from .session import engine


def init_db():
    Base.metadata.create_all(engine)
    tables = sorted(inspect(engine).get_table_names())
    print(f"Database ready. Tables ({len(tables)}):")
    for name in tables:
        print(f"  - {name}")


if __name__ == "__main__":
    init_db()
