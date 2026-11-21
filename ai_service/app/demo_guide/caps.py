"""The demo guide's caps (SPEC 2.1), kept in the database so every replica
sees one count:

  sessions_per_ip_per_day      POST /sessions          (repository.create_session)
  turns_per_session            every turn              (repository.take_turn)
  turns_per_ip_per_day         every turn
  daily_turns                  every turn, all visitors
  speech_chars_per_session     speech synthesis        (cache hits are free)
  listen_seconds_per_session   microphone
  3 contacts per IP per day    POST /contact

The narration cap (600 a day per IP) is the one in-memory count: the audio
is public, cacheable at the edge and its text comes from the catalogue, so a
per-process count is enough to stop one address from draining the voice
provider through a single pod.
"""
from __future__ import annotations

import threading
import time
from typing import Dict, Optional, Tuple

from sqlalchemy.orm import Session

from . import repository as repo
from . import settings as S


def take_turn(db: Session, session_id: str, ip_hash: Optional[str]) -> Optional[int]:
    """The new turn number, or None when a cap is reached. Commits."""
    turn = repo.take_turn(db, session_id, ip_hash,
                          session_cap=S.cap("turns_per_session", db),
                          ip_cap=S.cap("turns_per_ip_per_day", db),
                          daily_cap=S.cap("daily_turns", db))
    db.commit()
    return turn


def take_speech(db: Session, session_id: str, chars: int) -> bool:
    ok = repo.add_speech_chars(db, session_id, chars, S.cap("speech_chars_per_session", db))
    db.commit()
    return ok


def listen_left(db: Session, session: Dict) -> float:
    return float(S.cap("listen_seconds_per_session", db) - int(session.get("listen_seconds") or 0))


def contact_allowed(db: Session, ip_hash: Optional[str]) -> bool:
    if not ip_hash:
        return True
    return repo.leads_from_ip_today(db, ip_hash) < S.CONTACTS_PER_IP_PER_DAY


# ── narration: per process ────────────────────────────────────────────────

_narration: Dict[Tuple[str, int], int] = {}
_narration_lock = threading.Lock()


def _today() -> int:
    return int(time.time() // 86400)


def take_narration(ip_hash: str) -> bool:
    """Count one narration request for this network today; False at the cap."""
    cap = S.NARRATIONS_PER_IP_PER_DAY
    day = _today()
    with _narration_lock:
        if len(_narration) > 20000:
            for key in [k for k in _narration if k[1] != day]:
                _narration.pop(key, None)
        n = _narration.get((ip_hash, day), 0)
        if n >= cap:
            return False
        _narration[(ip_hash, day)] = n + 1
        return True


def reset_narration() -> None:
    with _narration_lock:
        _narration.clear()
