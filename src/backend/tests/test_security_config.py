"""Startup security configuration (security review: CORS validation, rate limit, demo gate)."""
import pytest
from app.main import parse_cors_origins, rate_limit_per_minute, demo_mode_enabled


def test_parse_cors_origins_valid():
    assert parse_cors_origins("http://localhost:5173, http://127.0.0.1:5173") == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


def test_parse_cors_origins_rejects_wildcard():
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        parse_cors_origins("*")


def test_parse_cors_origins_rejects_malformed():
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        parse_cors_origins("localhost:5173")


def test_parse_cors_origins_rejects_non_http_scheme():
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        parse_cors_origins("ftp://evil.example")


def test_rate_limit_default(monkeypatch):
    monkeypatch.delenv("RATE_LIMIT_PER_MINUTE", raising=False)
    assert rate_limit_per_minute() == 1200


def test_rate_limit_override(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "0")
    assert rate_limit_per_minute() == 0


def test_demo_mode_default_off(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    assert demo_mode_enabled() is False


def test_demo_mode_true(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    assert demo_mode_enabled() is True
