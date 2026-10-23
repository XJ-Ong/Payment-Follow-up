"""Declarative base shared by every Payment Follow-up model."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """All 11 plugin-owned tables inherit from this."""

    pass
