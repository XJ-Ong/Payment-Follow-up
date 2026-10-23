"""Compatibility entrypoint: apply migrations, including safe baseline adoption."""
from pathlib import Path
from alembic import command
from alembic.config import Config

def init_db():
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / "alembic.ini"))
    command.upgrade(config, "head")

if __name__ == "__main__":
    init_db()
