"""Engine and session factory for the Payment Follow-up database.

DATABASE_URL is read from the repository-root .env, the same way
check_db.py does it.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# src/backend/app/db/session.py -> repository root is 5 levels up (parents[4]).
load_dotenv(Path(__file__).resolve().parents[4] / ".env")

def validate_database_url(raw: str) -> str:
    """Fail fast at startup unless DATABASE_URL is a PostgreSQL connection string."""
    if not raw.startswith(("postgresql://", "postgresql+psycopg2://")):
        raise RuntimeError(
            "DATABASE_URL must be a postgresql:// connection string "
            "(postgresql://user:password@host:port/dbname); "
            f"got {raw[:20]!r}..."
        )
    return raw


engine = create_engine(validate_database_url(os.environ["DATABASE_URL"]))

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
