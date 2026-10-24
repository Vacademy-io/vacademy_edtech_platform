"""
Cancellation registry — a tiny module shared by the async router and the
sync pipeline thread.

A single ``threading.Event`` per ``video_id``. The router sets it from
``POST /cancel/{video_id}``; the pipeline checks ``is_set()`` at safe
points (stage boundaries, before each parallel HTML shot submission) and
raises ``PipelineCancelled`` to unwind.

We use ``threading.Event`` rather than ``asyncio.Event`` because the
pipeline runs inside a thread executor (``loop.run_in_executor(...)``) and
must not import asyncio internals to check the flag.
"""
from __future__ import annotations

import logging
import threading
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_stop_flags: Dict[str, threading.Event] = {}
# Why the flag was raised: "user" (cancel endpoint / cross-pod cancel seen by
# the heartbeat) or "fenced" (another pod took the run over — the leg must
# exit silently: no CANCELLED status, no refund).
_reasons: Dict[str, str] = {}
_lock = threading.Lock()


def register(video_id: str) -> threading.Event:
    """Create (or return) the stop flag for a video. Called by the service
    when it kicks off the pipeline thread."""
    with _lock:
        flag = _stop_flags.get(video_id)
        if flag is None:
            flag = threading.Event()
            _stop_flags[video_id] = flag
        return flag


def get(video_id: str) -> Optional[threading.Event]:
    """Look up an existing stop flag — returns ``None`` if generation is
    not currently running for this video."""
    with _lock:
        return _stop_flags.get(video_id)


def signal_stop(video_id: str, reason: str = "user") -> bool:
    """Set the stop flag for ``video_id``. Returns True if a flag was
    found and set, False if no in-flight generation matched. The first
    reason wins (a user cancel is not re-labelled by a later fence)."""
    flag = get(video_id)
    if flag is None:
        return False
    with _lock:
        _reasons.setdefault(video_id, reason or "user")
    flag.set()
    logger.info(f"[Cancel] Stop signal raised for {video_id} (reason={reason})")
    return True


def reason(video_id: str) -> Optional[str]:
    """Why the stop flag was raised (None when it was not, or before any
    reason was recorded)."""
    with _lock:
        return _reasons.get(video_id)


def clear(video_id: str) -> None:
    """Remove the flag — called from the pipeline's ``finally`` block once
    the thread has unwound. Safe to call when no flag exists."""
    with _lock:
        _stop_flags.pop(video_id, None)
        _reasons.pop(video_id, None)


class PipelineCancelled(Exception):
    """Raised inside the pipeline thread when ``stop_event.is_set()`` is
    detected at a safe checkpoint. Caught by ``video_generation_service``
    and translated into a ``cancelled`` SSE event + clean unwind."""
    pass
