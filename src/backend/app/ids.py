"""Map Orbyte external ids ("CLI-02") to the uuids our database stores.

The synthetic demo fixtures (app/db/demo_data.py and app/orbyte/fixture.py)
keep human-readable ids issued by Orbyte: COMP-01, USR-01, CLI-01..10,
PRJ-01..06, MLS-01..03. Our schema stores uuid references, so every
external code maps to a fixed uuid in one band per entity type:

    COMP-01 -> 00000000-0000-4000-8000-000000000001
    USR-02  -> 00000000-0000-4000-8000-000000000102
    CLI-04  -> 00000000-0000-4000-8000-000000000204
    PRJ-01  -> 00000000-0000-4000-8000-000000000301
    MLS-01  -> 00000000-0000-4000-8000-000000000401

One shared contract: seed.py uses it to insert rows, and the Orbyte adapter
will use it to answer lookups by uuid. Mapping is deterministic, so any code
can translate in both directions without a lookup table.
"""

from uuid import UUID

_BANDS = {
    "COMP": 0,
    "USR": 100,
    "CLI": 200,
    "PRJ": 300,
    "MLS": 400,
}


def external_uuid(code: str) -> UUID:
    """Translate an Orbyte external id (e.g. "CLI-02") to its stored uuid."""
    prefix, _, number = code.partition("-")
    if prefix not in _BANDS or not number.isdigit():
        raise ValueError(f"Unknown Orbyte external id: {code!r}")
    n = _BANDS[prefix] + int(number)
    return UUID(f"00000000-0000-4000-8000-{n:012d}")


def reference_uuid(value: str, prefix: str) -> UUID:
    """Resolve a typed demo code or UUID; callers still verify tenant ownership."""
    if value.startswith(prefix + '-'):
        return external_uuid(value)
    return UUID(value)


def reference_code(value: UUID, prefix: str) -> str:
    """Human-readable codes for synthetic IDs; opaque real IDs remain UUIDs."""
    tail = str(value).rsplit('-', 1)[-1]
    if tail.isdecimal():
        number = int(tail) - _BANDS[prefix]
        if 0 < number < 100:
            code = f'{prefix}-{number:02d}'
            if external_uuid(code) == value:
                return code
    return str(value)
