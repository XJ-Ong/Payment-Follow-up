import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

engine = create_engine(os.environ["DATABASE_URL"])

with engine.connect() as conn:
    print(conn.execute(text("SELECT version()")).scalar())