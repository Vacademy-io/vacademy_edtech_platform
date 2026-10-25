"""Request models of the Lead Agent API (spec §2.1, §4, §4.1) and the response
shapes built from rows."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import pacing

ProductKey = Literal["complete_vacademy", "crm", "lms", "ai_calling", "tutezy"]
SourceKey = Literal["organisation_search", "maps", "hiring", "keyword", "software_request", "new_centre"]
Mode = Literal["LOCAL", "REMOTE", "AUTO"]
ContactLevel = Literal["direct", "likely", "general", "none"]


def _clean_list(values: List[str], max_len: int) -> List[str]:
    out = []
    for v in values or []:
        v = " ".join(str(v).split())[:max_len]
        if v and v not in out:
            out.append(v)
    return out


class Industry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=80)
    search_term: str = Field(min_length=1, max_length=60)
    hiring_phrases: List[str] = Field(default_factory=list, max_length=5)
    need_phrases: List[str] = Field(default_factory=list, max_length=5)
    buyer_roles: List[str] = Field(default_factory=list, max_length=5)


class Brief(BaseModel):
    model_config = ConfigDict(extra="ignore")
    products: List[ProductKey] = Field(default_factory=lambda: ["complete_vacademy"], min_length=1, max_length=5)
    description: str = Field(default="", max_length=3000)
    industries: List[Industry] = Field(min_length=1, max_length=6)
    buyer_roles: List[str] = Field(default_factory=list, max_length=10)
    hiring_roles: List[str] = Field(default_factory=list, max_length=6)
    keywords: List[str] = Field(default_factory=list, max_length=10)
    must_have: List[str] = Field(default_factory=list, max_length=10)
    deal_breakers: List[str] = Field(default_factory=list, max_length=10)
    exclude: List[str] = Field(default_factory=list, max_length=5)
    sources: List[SourceKey] = Field(default_factory=lambda: ["organisation_search", "maps", "hiring", "keyword",
                                                               "software_request", "new_centre"], min_length=1)
    find_contacts: bool = True

    @field_validator("buyer_roles", "hiring_roles", "keywords", "exclude")
    @classmethod
    def _short(cls, v: List[str]) -> List[str]:
        return _clean_list(v, 60)

    @field_validator("must_have", "deal_breakers")
    @classmethod
    def _medium(cls, v: List[str]) -> List[str]:
        return _clean_list(v, 160)


class Market(BaseModel):
    model_config = ConfigDict(extra="ignore")
    country: str = Field(min_length=2, max_length=80)
    state: Optional[str] = Field(default=None, max_length=120)
    city: Optional[str] = Field(default=None, max_length=120)


class Gate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    auto_score: int = Field(default=70, ge=0, le=100)
    review_score: int = Field(default=45, ge=0, le=100)
    min_contact: ContactLevel = "likely"
    require_intent: bool = False

    @model_validator(mode="after")
    def _order(self) -> "Gate":
        if self.review_score > self.auto_score:
            raise ValueError("review_score must not be above auto_score")
        return self


class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tz: str = "Asia/Kolkata"
    start: str = "09:30"
    end: str = "19:00"
    days: List[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6], min_length=1, max_length=7)

    @field_validator("tz")
    @classmethod
    def _tz(cls, v: str) -> str:
        if not pacing.valid_tz(v):
            raise ValueError("unknown time zone")
        return v

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        t = pacing.parse_hhmm(v)
        if t is None:
            raise ValueError("use HH:MM")
        return f"{t.hour:02d}:{t.minute:02d}"

    @field_validator("days")
    @classmethod
    def _days(cls, v: List[int]) -> List[int]:
        if any(d < 1 or d > 7 for d in v):
            raise ValueError("days are ISO weekdays 1 (Monday) .. 7 (Sunday)")
        return sorted(set(v))

    @model_validator(mode="after")
    def _span(self) -> "Window":
        if self.start == self.end:
            raise ValueError("start and end must differ")
        return self


class AgentCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    audience_id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=200)
    brief: Brief
    markets: List[Market] = Field(min_length=1, max_length=5)
    daily_quota: int = Field(default=10, ge=1, le=200)
    monthly_credit_cap: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("9999999999"))
    mode: Mode = "AUTO"
    gate: Optional[Gate] = None
    window: Optional[Window] = None


class AgentUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    audience_id: Optional[str] = Field(default=None, min_length=1, max_length=255)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    brief: Optional[Brief] = None
    markets: Optional[List[Market]] = Field(default=None, min_length=1, max_length=5)
    daily_quota: Optional[int] = Field(default=None, ge=1, le=200)
    monthly_credit_cap: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("9999999999"))
    mode: Optional[Mode] = None
    gate: Optional[Gate] = None
    window: Optional[Window] = None


class StatusIn(BaseModel):
    status: Literal["ACTIVE", "PAUSED", "ARCHIVED"]


class DecisionIn(BaseModel):
    action: Literal["APPROVE", "REJECT"]
    reason: Optional[str] = Field(default=None, max_length=300)


class BulkDecisionIn(DecisionIn):
    ids: List[str] = Field(min_length=1, max_length=200)


class SuggestIn(BaseModel):
    products: List[ProductKey] = Field(default_factory=list, max_length=5)
    description: Optional[str] = Field(default=None, max_length=3000)
    url: Optional[str] = Field(default=None, max_length=1000)


class SuppressionIn(BaseModel):
    kind: Literal["DOMAIN", "PHONE", "EMAIL"]
    value: str = Field(min_length=1, max_length=320)
    reason: Literal["CUSTOMER", "COMPETITOR", "OPTED_OUT", "MANUAL", "NOT_INTERESTED"] = "MANUAL"
    note: Optional[str] = Field(default=None, max_length=300)


class PairIn(BaseModel):
    label: Optional[str] = Field(default=None, max_length=120)


class HelloIn(BaseModel):
    version: Optional[str] = Field(default=None, max_length=30)
    label: Optional[str] = Field(default=None, max_length=120)


class ClaimIn(BaseModel):
    max: int = Field(default=1, ge=1, le=4)


class ResultIn(BaseModel):
    task_id: str = Field(min_length=1, max_length=36)
    ok: bool
    status_code: Optional[int] = Field(default=None, ge=0, le=999)
    final_url: Optional[str] = Field(default=None, max_length=2000)
    content_type: Optional[str] = Field(default=None, max_length=200)
    html: Optional[str] = Field(default=None, max_length=1_600_000)   # the extension cuts at 1.5 MB
    error: Optional[str] = Field(default=None, max_length=2000)


# --------------------------------------------------------------------------
# response shapes
# --------------------------------------------------------------------------
def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


AGENT_FIELDS = ("id", "institute_id", "audience_id", "name", "status", "daily_quota", "monthly_credit_cap", "mode",
                "last_tick_at", "last_error", "created_at", "updated_at")


def agent_out(row: Dict[str, Any], *, audience_name: Optional[str] = None, today: Optional[dict] = None,
              workers_online: Optional[int] = None, review_waiting: Optional[int] = None) -> Dict[str, Any]:
    """The API's Agent: the row's plain columns, its JSON columns WITHOUT the
    _json suffix (brief, markets, gate, window), audience_name and live counters."""
    out = {k: _plain(row.get(k)) for k in AGENT_FIELDS}
    out["audience_name"] = audience_name
    out["brief"] = row.get("brief_json") or {}
    out["markets"] = row.get("markets_json") or []
    out["gate"] = row.get("gate_json") or {}
    out["window"] = row.get("window_json") or {}
    out["plan_built_at"] = _plain(row.get("plan_built_at"))
    if today is not None:
        out["today"] = {k: int(today.get(k) or 0) for k in ("delivered", "review", "rejected")}
    if review_waiting is not None:
        out["review_waiting"] = int(review_waiting)
    if workers_online is not None:
        out["workers_online"] = workers_online
    return out


def _best_contact(lead: dict) -> Optional[Dict[str, Any]]:
    for c in lead.get("contacts") or []:
        if c.get("kind") != "contact_form" and c.get("quality") != "avoid":
            cq = lead.get("contact_quality") or {}
            return {"kind": c.get("kind"), "value": c.get("value"), "quality": c.get("quality"),
                    "label": cq.get("label")}
    return None


def candidate_summary(row: Dict[str, Any]) -> Dict[str, Any]:
    lead = row.get("lead_json") or {}
    score = row.get("score_json") or {}
    org = lead.get("organisation") or {}
    reasons = score.get("reasons") or score.get("gate_reasons") or []
    return {
        "id": row["id"], "status": row["status"], "decision": row.get("decision"), "score": row.get("score"),
        "stage": row.get("stage"), "source": row.get("source"),
        "org": {"name": org.get("name") or row.get("org_name"), "domain": row.get("org_domain"),
                "website": org.get("website") or row.get("org_website"), "city": org.get("city") or row.get("org_city")},
        "top_reason": (reasons[0] if reasons else None) or row.get("reject_reason"),
        "flags": [str(f) for f in score.get("flags") or []],
        "score_parts": {k: score.get(k) for k in ("fit", "intent", "reach", "risk")},
        "best_contact": _best_contact(lead),
        "reject_reason": row.get("reject_reason"), "delivery_note": row.get("delivery_note"),
        "created_at": _plain(row.get("created_at")), "delivered_at": _plain(row.get("delivered_at")),
    }


def candidate_detail(row: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: _plain(v) for k, v in row.items()}
    out.update(candidate_summary(row))
    out["evidence"] = (row.get("lead_json") or {}).get("evidence") or []
    return out


__all__ = [n for n in dir() if not n.startswith("_")]
