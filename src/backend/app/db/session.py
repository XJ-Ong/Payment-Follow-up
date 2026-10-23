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

engine = create_engine(os.environ["DATABASE_URL"])

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
