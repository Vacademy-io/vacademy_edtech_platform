"""Validation effort: how much extra reading and searching an agent may spend confirming a lead's
contact details and evidence (lead_agent.gate_json["effort"], one per agent, set in the dashboard).

The free judging rules (junk and template contacts, who an email belongs to, duplicates, hiring
proof checked against the job's place) run at every level. The level only buys extra page reads
and searches, so an institute chooses how much it spends per lead. A lead whose contact still
cannot be confirmed at its agent's level is rejected: the funnel after delivery is fully
automated, and a lead nobody can reach is worth nothing (2026-10-29).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

BASIC, STANDARD, DEEP = "BASIC", "STANDARD", "DEEP"
LEVELS = (BASIC, STANDARD, DEEP)
DEFAULT = STANDARD


@dataclass(frozen=True)
class Effort:
    level: str
    pages_per_site: int  # pages read after the home page (engine.pagefetch.choose_pages)
    maps_lookup: bool  # look the organisation up on Google Maps when discovery did not come from Maps
    open_job_post: bool  # read the job post itself before a hiring signal counts
    contact_hunt_rounds: int  # extra searches for the organisation's own phone / email when none is certain
    social_pages: bool  # a contact hunt also reads the organisation's Facebook / Instagram / LinkedIn page


_EFFORTS: Dict[str, Effort] = {
    BASIC: Effort(BASIC, pages_per_site=3, maps_lookup=False, open_job_post=False, contact_hunt_rounds=0,
                  social_pages=False),
    STANDARD: Effort(STANDARD, pages_per_site=3, maps_lookup=True, open_job_post=True, contact_hunt_rounds=1,
                     social_pages=False),
    DEEP: Effort(DEEP, pages_per_site=6, maps_lookup=True, open_job_post=True, contact_hunt_rounds=3,
                 social_pages=True),
}


def level(agent: Optional[Dict[str, Any]]) -> str:
    """The agent's level; agents made before effort levels (no gate_json["effort"]) run at DEFAULT."""
    value = str(((agent or {}).get("gate_json") or {}).get("effort") or "").upper()
    return value if value in _EFFORTS else DEFAULT


def of(agent: Optional[Dict[str, Any]]) -> Effort:
    return _EFFORTS[level(agent)]


__all__ = ["BASIC", "STANDARD", "DEEP", "LEVELS", "DEFAULT", "Effort", "level", "of"]
