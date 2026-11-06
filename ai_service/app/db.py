import logging
import threading
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine

from .config import get_settings

logger = logging.getLogger(__name__)


_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker] = None


_mcp_engine: Optional[Engine] = None
_McpSessionLocal: Optional[sessionmaker] = None
_mcp_engine_lock = threading.Lock()
_search_path_listening = False
_search_path_lock = threading.Lock()

MCP_POOL_TIMEOUT_S = 5
MCP_CONNECT_ARGS = {
    "application_name": "ai_service_mcp",
    "connect_timeout": 5,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 3,
}
#: Transaction-local, so nothing outlives the transaction on a pooled connection.
_MCP_TIMEOUTS_SQL = text(
    "SELECT set_config('statement_timeout', '60000', true), set_config('lock_timeout', '10000', true)"
)


def _listen_for_search_path(target_schema: Optional[str]) -> None:
    """Optionally set search_path to a specific schema on session begin. On Session itself, so once per process."""
    global _search_path_listening
    if not target_schema:
        return
    with _search_path_lock:
        if _search_path_listening:
            return
        _search_path_listening = True

    @event.listens_for(Session, "after_begin")
    def set_search_path(session: Session, transaction, connection):  # type: ignore[no-redef]
        session.execute(text(f"SET search_path TO {target_schema}"))


def _create_engine() -> Engine:
    settings = get_settings()
    url = settings.build_sqlalchemy_url()
    engine = create_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_recycle=settings.db_pool_recycle_seconds,
        pool_pre_ping=True,  # Test connections before use to detect stale connections
        future=True,
    )

    _listen_for_search_path(settings.db_schema)
    return engine


def _create_mcp_engine() -> Engine:
    settings = get_settings()
    engine = create_engine(
        settings.build_sqlalchemy_url(),
        pool_size=settings.mcp_lane_connections(),
        max_overflow=0,
        pool_timeout=MCP_POOL_TIMEOUT_S,
        pool_recycle=settings.db_pool_recycle_seconds,
        pool_pre_ping=True,
        future=True,
        hide_parameters=True,
        connect_args=dict(MCP_CONNECT_ARGS),
    )
    _listen_for_search_path(settings.db_schema)
    return engine


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        _engine = _create_engine()
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def get_sessionmaker() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_mcp_engine() -> Engine:
    """The engine behind MCP's worker threads, kept apart from the main pool. Created on first use."""
    global _mcp_engine, _McpSessionLocal
    with _mcp_engine_lock:
        if _mcp_engine is None:
            engine = _create_mcp_engine()
            factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)

            @event.listens_for(factory, "after_begin")
            def set_mcp_timeouts(session: Session, transaction, connection):  # type: ignore[no-redef]
                connection.execute(_MCP_TIMEOUTS_SQL)

            _mcp_engine, _McpSessionLocal = engine, factory
        return _mcp_engine


def get_mcp_sessionmaker() -> sessionmaker:
    get_mcp_engine()
    assert _McpSessionLocal is not None
    return _McpSessionLocal


def mcp_pool_checked_out() -> int:
    """Connections out of the MCP engine's pool. Does not create the engine."""
    return _mcp_engine.pool.checkedout() if _mcp_engine is not None else 0


@contextmanager
def db_session() -> Iterator[Session]:
    """
    Context-managed DB session for imperative usage.
    """
    session_factory = get_sessionmaker()
    session: Session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def mcp_db_session() -> Iterator[Session]:
    """``db_session`` on the MCP engine, with the same exit semantics."""
    session: Session = get_mcp_sessionmaker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def background_db_session() -> Iterator[Session]:
    """
    Context-managed DB session for LONG-RUNNING background tasks
    (video generation / resume / retry).

    Identical to `db_session()` except the exit commit is best-effort.
    These tasks run for many minutes; SQLAlchemy auto-begins a
    transaction on the session's first read, so by the time the task
    finishes the connection has usually been killed by PgBouncer /
    Postgres (idle-in-transaction timeout) and `commit()` raises
    `psycopg.errors.ProtocolViolation: server conn crashed?` — AFTER
    the task already succeeded. With `db_session()` that propagates
    into the caller's error path and a successful run gets reported
    as failed (and refunded). All meaningful writes on these paths go
    through short-lived sessions that commit themselves, so nothing
    rides on this final commit — log it loudly and move on.
    """
    session_factory = get_sessionmaker()
    session: Session = session_factory()
    try:
        yield session
    except Exception:
        try:
            session.rollback()
        except Exception:
            logger.warning("background_db_session: rollback failed", exc_info=True)
        raise
    else:
        try:
            session.commit()
        except Exception:
            logger.warning(
                "background_db_session: exit commit failed (stale connection "
                "after a long-running task?) — swallowed so a finished task "
                "is not misreported as failed; any uncommitted writes on "
                "this session are discarded",
                exc_info=True,
            )
            try:
                session.rollback()
            except Exception:
                pass
    finally:
        session.close()


def db_dependency() -> Iterator[Session]:
    """
    FastAPI dependency for per-request DB session
    """
    with db_session() as session:
        yield session


