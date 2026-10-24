"""Startup configuration validation (security review: fail fast on bad URLs)."""
import pytest
from app.db.session import validate_database_url


def test_accepts_postgresql_urls():
    url = "postgresql+psycopg2://user:pass@localhost:5432/db"
    assert validate_database_url(url) == url


def test_rejects_missing_url():
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        validate_database_url("")


def test_rejects_non_postgres_scheme():
    with pytest.raises(RuntimeError, match="postgresql"):
        validate_database_url("sqlite:///.db")
