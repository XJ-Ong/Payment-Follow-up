"""Orbyte adapter layer — the only door to Orbyte-owned data.

Services depend on the OrbyteAdapter protocol; the MVP wires
MockOrbyteAdapter (synthetic fixture). See protocol.py for the swap story.
"""

from .mock import MockOrbyteAdapter
from .protocol import OrbyteAdapter
from .schemas import (
    AppUser,
    ApprovedLeave,
    Client,
    Company,
    Milestone,
    Project,
    PublicHoliday,
)

__all__ = [
    "AppUser",
    "ApprovedLeave",
    "Client",
    "Company",
    "MockOrbyteAdapter",
    "Milestone",
    "OrbyteAdapter",
    "Project",
    "PublicHoliday",
]
