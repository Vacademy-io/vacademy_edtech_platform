"""Run lease + heartbeat for AI-video generation legs.

Every generation leg (one ``generate_till_stage`` call) owns
``extra_metadata.run_lease`` while it runs:

    {"v":1, "leg_id", "owner_pod", "owner_boot", "owner_boot_at",
     "state": "running|handoff|interrupted|released|sweeping|failing",
     "origin": "user|auto_resume", "started_at", "heartbeat_at",
     "interrupted_at", "interrupt_reason", "crash_resumes", "drain_resumes"}

The lease is only ever written with single-statement SQL
(AiVideoRepository.acquire_lease / heartbeat / release_lease /
claim_for_resume), so the whole-column metadata writers cannot revert it.

One daemon THREAD per process (not an asyncio task: the stage upload loops
block the event loop) heartbeats every active leg every 15 s. A heartbeat that
matches no row means another pod took the run over (fenced): the leg is told
to stop with reason ``fenced`` and exits silently — no CANCELLED, no refund.
A heartbeat that reads status CANCELLED (a cancel issued on the other
replica) stops the leg with reason ``user``.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from . import cancellation_registry

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_S = 15.0
# A lease whose heartbeat is older than this is dead (find_resumable uses the
# same 180 s; acquire_lease lets a user leg take a lease this stale).
LEASE_STALE_S = 180

# Identity of this process: a new value per boot, so a restarted pod never
# mistakes its predecessor's lease for its own.
BOOT_ID = str(uuid.uuid4())
BOOT_AT = datetime.now(timezone.utc).isoformat()


def pod_name() -> str:
    return (os.environ.get("POD_NAME") or "").strip() or socket.gethostname()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_lease(
    *,
    origin: str = "user",
    state: str = "running",
    prev: Optional[Dict[str, Any]] = None,
    crash_resumes: Optional[int] = None,
    drain_resumes: Optional[int] = None,
) -> Dict[str, Any]:
    """A fresh lease for a new leg owned by this process. The resume counters
    carry over from ``prev`` (they count per video, across legs)."""
    prev = prev if isinstance(prev, dict) else {}
    ts = now_iso()
    return {
        "v": 1,
        "leg_id": str(uuid.uuid4()),
        "owner_pod": pod_name(),
        "owner_boot": BOOT_ID,
        "owner_boot_at": BOOT_AT,
        "state": state,
        "origin": origin,
        "started_at": ts,
        "heartbeat_at": ts,
        "interrupted_at": None,
        "interrupt_reason": None,
        "crash_resumes": int(prev.get("crash_resumes") or 0) if crash_resumes is None else int(crash_resumes),
        "drain_resumes": int(prev.get("drain_resumes") or 0) if drain_resumes is None else int(drain_resumes),
    }


@dataclass
class LegHandle:
    """One running leg of one video on this process."""

    video_id: str
    leg_id: Optional[str]
    lease: Optional[Dict[str, Any]]
    origin: str = "user"
    repository: Any = None
    work_dir: Any = None
    uploader: Any = None
    started_at: str = field(default_factory=now_iso)
    stop_reason: Optional[str] = None
    done_event: threading.Event = field(default_factory=threading.Event)
    ended: bool = False

    @property
    def leased(self) -> bool:
        return bool(self.leg_id)


_ACTIVE_LEGS: Dict[str, LegHandle] = {}
_lock = threading.Lock()
_hb_thread: Optional[threading.Thread] = None
_hb_stop = threading.Event()


def active_legs() -> List[LegHandle]:
    with _lock:
        return list(_ACTIVE_LEGS.values())


def active_leg(video_id: str) -> Optional[LegHandle]:
    with _lock:
        return _ACTIVE_LEGS.get(video_id)


def count_active(origin: Optional[str] = None) -> int:
    with _lock:
        return sum(1 for h in _ACTIVE_LEGS.values() if origin is None or h.origin == origin)


def begin_leg(
    repository: Any,
    video_id: str,
    *,
    origin: str = "user",
    lease: Optional[Dict[str, Any]] = None,
    prev_lease: Optional[Dict[str, Any]] = None,
    stale_s: int = LEASE_STALE_S,
) -> Optional[LegHandle]:
    """Register a leg for ``video_id``.

    ``lease``: a lease the caller already holds (a router acquired it before
    starting the task, or the resumer claimed it) — used as is. Otherwise the
    lease is acquired here. Returns None when another live leg holds the lease
    (the caller must not run). A database error while acquiring degrades to a
    lease-less leg (the pre-lease behaviour) rather than refusing the run."""
    if lease is None:
        lease = new_lease(origin=origin, prev=prev_lease)
        try:
            if not repository.acquire_lease(video_id, lease, stale_s):
                logger.warning("[RunLease] %s: another live leg holds the lease", video_id)
                return None
        except Exception as exc:  # noqa: BLE001
            logger.warning("[RunLease] %s: lease acquire failed (%s); running without a lease", video_id, exc)
            lease = None
    handle = LegHandle(
        video_id=video_id,
        leg_id=(lease or {}).get("leg_id"),
        lease=lease,
        origin=(lease or {}).get("origin") or origin,
        repository=repository,
    )
    with _lock:
        _ACTIVE_LEGS[video_id] = handle
    if handle.leased:
        ensure_heartbeat_thread()
    return handle


def end_leg(
    handle: Optional[LegHandle],
    state: str,
    *,
    outcome: Optional[str] = None,
    reason: Optional[str] = None,
    **fields: Any,
) -> bool:
    """Unregister the leg and, unless it was fenced, write its final lease
    state (compare-and-set on leg_id) plus a resume_history entry."""
    if handle is None or handle.ended:
        return False
    handle.ended = True
    with _lock:
        if _ACTIVE_LEGS.get(handle.video_id) is handle:
            _ACTIVE_LEGS.pop(handle.video_id, None)
    ok = False
    try:
        if handle.leased and handle.stop_reason != "fenced" and handle.repository is not None:
            hist = {
                "leg_id": handle.leg_id,
                "owner_pod": (handle.lease or {}).get("owner_pod"),
                "origin": handle.origin,
                "started_at": handle.started_at,
                "ended_at": now_iso(),
                "outcome": outcome or state,
                "reason": reason,
            }
            ok = bool(handle.repository.release_lease(
                handle.video_id, handle.leg_id, state, history=hist, ended_at=hist["ended_at"], **fields
            ))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[RunLease] %s: release failed: %s", handle.video_id, exc)
    finally:
        handle.done_event.set()
    return ok


# ── heartbeat ────────────────────────────────────────────────────────────────

def heartbeat_once(repository_factory: Optional[Callable[[], Any]] = None) -> Dict[str, Optional[str]]:
    """Heartbeat every active leased leg once. Returns {video_id: status|None}.
    Fenced legs get signal_stop(reason="fenced"); legs whose row reads
    CANCELLED get signal_stop(reason="user")."""
    out: Dict[str, Optional[str]] = {}
    for h in active_legs():
        if not h.leased or h.ended:
            continue
        repo = h.repository
        if repo is None and repository_factory is not None:
            repo = repository_factory()
        if repo is None:
            continue
        try:
            status = repo.heartbeat(h.video_id, h.leg_id)
        except Exception as exc:  # noqa: BLE001 — a DB blip is not a fence
            logger.warning("[RunLease] heartbeat failed for %s: %s", h.video_id, exc)
            continue
        out[h.video_id] = status
        if status is None:
            if h.stop_reason is None:
                h.stop_reason = "fenced"
                logger.warning("[RunLease] %s leg %s was fenced (another pod owns the run); stopping",
                               h.video_id, h.leg_id)
                cancellation_registry.signal_stop(h.video_id, reason="fenced")
        elif status == "CANCELLED" and h.stop_reason is None:
            h.stop_reason = "user"
            cancellation_registry.signal_stop(h.video_id, reason="user")
    return out


def _heartbeat_loop() -> None:
    while not _hb_stop.wait(HEARTBEAT_INTERVAL_S):
        try:
            heartbeat_once()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[RunLease] heartbeat loop error: %s", exc)


def ensure_heartbeat_thread() -> None:
    global _hb_thread
    with _lock:
        if _hb_thread is not None and _hb_thread.is_alive():
            return
        _hb_stop.clear()
        _hb_thread = threading.Thread(target=_heartbeat_loop, name="ai-video-lease-heartbeat", daemon=True)
        _hb_thread.start()


__all__ = [
    "BOOT_ID", "BOOT_AT", "HEARTBEAT_INTERVAL_S", "LEASE_STALE_S", "LegHandle",
    "active_leg", "active_legs", "begin_leg", "count_active", "end_leg",
    "ensure_heartbeat_thread", "heartbeat_once", "new_lease", "now_iso", "pod_name",
]
