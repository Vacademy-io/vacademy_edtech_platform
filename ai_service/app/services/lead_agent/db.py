"""The Lead Agent's database sessions.

Every lead_agent module opens its short sessions through `session()` (and runs
them via asyncio.to_thread from async code). In production this is app.db's
db_session (commit on exit, rollback on error); tests point it at a scratch
Postgres with `use_sessionmaker(factory)`.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy.orm import Session, sessionmaker

_factory: Optional[sessionmaker] = None


def use_sessionmaker(factory: Optional[sessionmaker]) -> None:
    """Tests: route every lead_agent session to `factory` (None = back to app.db)."""
    global _factory
    _factory = factory


@contextmanager
def session() -> Iterator[Session]:
    if _factory is None:
        from ...db import db_session

        with db_session() as db:
            yield db
        return
    db = _factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


__all__ = ["session", "use_sessionmaker"]
