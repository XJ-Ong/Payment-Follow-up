---
name: Imported dependency compatibility
description: Why this import must explicitly retain its declared PostgreSQL driver.
---

Preserve psycopg2 when installing or updating this imported project's PostgreSQL dependencies.

**Why:** Its open-ended SQLAlchemy requirement resolves to 2.1, which defaults generic PostgreSQL URLs to psycopg 3, while the imported backend declares psycopg2. An otherwise successful dependency installation can therefore fail when opening a database connection.

**How to apply:** Keep driver selection consistent with installed dependencies. Treat a move to psycopg 3 as a deliberate dependency change, not an incidental setup fix.
