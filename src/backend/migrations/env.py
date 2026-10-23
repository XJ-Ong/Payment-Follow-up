from alembic import context
from app.db.session import engine
from app.db.base import Base
from app.db import models

if context.is_offline_mode():
    raise RuntimeError("Use an online connection to verify the existing schema safely")
with (context.config.attributes.get("engine") or engine).connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()
