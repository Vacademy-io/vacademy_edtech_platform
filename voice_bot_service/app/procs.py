"""Several bot processes in one pod (app/supervisor.py): the little state they share.

One Python process tops out at about one core (the GIL) -- about five calls on
the 2026-11-23 load test. A pod with VB_PROCS=N runs N uvicorn processes behind
an in-pod HAProxy, and these helpers keep the pod-level answers right:

  * live-call counts -- each process publishes its own count to a small file in
    /dev/shm; /health (which the preStop drain reads) and /answer (the busy
    check) sum them, so whichever process answers sees the whole pod;
  * single-use /ws tokens -- spent with an O_CREAT|O_EXCL file, atomic across
    processes, so a replayed token is refused by every process, not just one;
  * singleton jobs -- the report-spool sweeper and the speech-cache sweeper and
    reporter run in process 0 only.

With VB_PROCS unset (or 1) every helper reduces to the old single-process
behaviour: index 0, count 1, and the token check is in-memory as before.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time

logger = logging.getLogger("voice_bot.procs")

SHM_DIR = os.environ.get("VB_SHM_DIR", "/dev/shm/voice-bot")


def index() -> int:
    try:
        return int(os.environ.get("VB_PROC_INDEX", "0"))
    except ValueError:
        return 0


def count() -> int:
    try:
        return max(1, int(os.environ.get("VB_PROCS", "1")))
    except ValueError:
        return 1


def multi() -> bool:
    return count() > 1


def is_leader() -> bool:
    """Process 0 runs the pod's singleton background jobs."""
    return index() == 0


def _ensure_dir(path: str) -> None:
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        logger.exception("procs: cannot create %s", path)


# -- live-call counts ----------------------------------------------------------

def _count_path(i: int) -> str:
    return os.path.join(SHM_DIR, f"active.{i}")


def publish(active: int, handshakes: int) -> None:
    """This process's live calls and pending handshakes, for the pod totals.
    Written whole and renamed into place, so a reader never sees half a file."""
    if not multi():
        return
    _ensure_dir(SHM_DIR)
    path = _count_path(index())
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w") as f:
            f.write(f"{int(active)} {int(handshakes)} {os.getpid()}")
        os.replace(tmp, path)
    except OSError:
        logger.exception("procs: could not publish live-call count")


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def pod_totals(own_active: int, own_handshakes: int) -> tuple[int, int]:
    """(live calls, pending handshakes) across every process in the pod. A file
    left by a process that has died counts as zero -- its calls died with it."""
    if not multi():
        return own_active, own_handshakes
    active, hs = own_active, own_handshakes
    me = index()
    for i in range(count()):
        if i == me:
            continue
        try:
            with open(_count_path(i)) as f:
                parts = f.read().split()
            a, h, pid = int(parts[0]), int(parts[1]), int(parts[2])
        except (OSError, ValueError, IndexError):
            continue
        if not _pid_alive(pid):
            continue
        active += max(0, a)
        hs += max(0, h)
    return active, hs


# -- single-use ws tokens ------------------------------------------------------

_TOKENS_DIR = os.path.join(SHM_DIR, "spent")
_last_prune = 0.0


def spend_token_shared(key: str, ttl_secs: float) -> bool:
    """True if this is the first time `key` is spent anywhere in the pod.
    One file per token, created with O_EXCL: exactly one process can win.
    Spent files are pruned by age (mtime) once the token itself has expired."""
    global _last_prune
    _ensure_dir(_TOKENS_DIR)
    now = time.time()
    path = os.path.join(_TOKENS_DIR, hashlib.sha256(key.encode()).hexdigest()[:40])
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
    except FileExistsError:
        return False
    except OSError:
        # Shared memory unusable: refusing every call would be an outage, and
        # the token is still HMAC-verified and short-lived. Log and admit.
        logger.exception("procs: token spend file failed -- admitting on HMAC alone")
        return True
    if now - _last_prune > 60:
        _last_prune = now
        _prune_tokens(now - ttl_secs)
    return True


def _prune_tokens(older_than: float) -> None:
    try:
        with os.scandir(_TOKENS_DIR) as it:
            for e in it:
                try:
                    if e.stat().st_mtime < older_than:
                        os.remove(e.path)
                except FileNotFoundError:
                    continue
    except OSError:
        pass
