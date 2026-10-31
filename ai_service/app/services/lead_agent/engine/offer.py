"""What an agent sells, resolved from its brief: the signals research looks for, the fit points and
product score they earn, which platforms compete, and whether the education-only checks apply.

Two shapes of brief:
  - ``brief["offer"]`` (every agent made since 2026-10-26): the institute's own product, with its own
    fit signals (keys fit_1 .. fit_8, weight 1-3), competitors and an education switch. Research
    then uses the UNIVERSAL signals plus those fit signals, so a solar installer's agent never asks
    a page about test series.
  - ``brief["products"]`` only (agents made before): Vacademy's product keys, scored with the
    education catalogue in research/catalogue.py exactly as before.

Engine functions that used to take product keys take ``products`` as either a key list or an Offer;
``as_offer`` turns either (or a brief) into an Offer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from .fingerprint import VENDORS, Vendor
from .research.catalogue import (
    SATURATION, SATURATION_BY_PRODUCT, SIGNALS, SUGGESTED_ROLES, WEIGHTS, ProductScore, SignalType,
)
from .schemas import PRODUCT_NAMES

OFFER_KEY = "offer"  # the product key of an offer (plan.target_products, lead["products"])
CUSTOM_KEYS = tuple(f"fit_{i}" for i in range(1, 9))
MAX_FIT_SIGNALS = len(CUSTOM_KEYS)
COMPETITOR_KINDS = ("lms", "crm", "whatsapp", "chat", "payments", "website")

# Signals every offer looks for: buying signals and size, whatever is sold.
UNIVERSAL = ("explicit_software_need", "hiring", "hiring_other", "keyword_need", "multiple_branches", "new_centre",
             "large_scale")
UNIVERSAL_FIT_POINTS = {"multiple_branches": 10, "large_scale": 3}
UNIVERSAL_WEIGHTS = {"explicit_software_need": 4, "hiring": 3, "keyword_need": 2, "new_centre": 1,
                     "multiple_branches": 1, "large_scale": 1}
FIT_POINTS_BY_WEIGHT = {1: 5, 2: 10, 3: 15}  # an offer's own fit signal: low / medium / high

# Fit points of the education catalogue (agents with products only).
LEGACY_FIT_POINTS = {
    "online_courses": 15, "test_series": 10, "multiple_branches": 10, "admissions_open": 8, "enquiry_forms": 8,
    "high_call_volume": 4, "own_app_or_portal": 3, "large_scale": 3, "hiring_faculty": 2,
}
LEGACY_COMPETITOR_KINDS = frozenset({"lms", "crm"})
LEGACY_QUESTION = "How do you handle admissions enquiries and follow-ups today?"
GENERIC_QUESTION = "How do you handle this today?"
DEFAULT_PRODUCTS = ("complete_vacademy",)

_INTENT_SOFTWARE = re.compile(r"\b(software|app|application|platform|lms|crm|erp|system|portal|tool|solution)\b", re.I)
_NAME_FILLER = frozenset({"and", "for", "the", "with", "our", "your", "service", "services", "solution", "solutions"})


@dataclass(frozen=True)
class Offer:
    name: str
    seller: str
    summary: str
    signals: dict[str, SignalType]
    fit_points: dict[str, int]
    products: tuple[str, ...]  # product keys scored: the legacy keys, or (OFFER_KEY,)
    weights: dict[str, dict[str, int]]  # product key -> signal -> points
    saturation: dict[str, int]
    competitor_kinds: frozenset[str]
    competitors: tuple[tuple[str, str | None], ...]  # (name, registered domain or None)
    education: bool
    discovery_question: str
    roles: tuple[str, ...]  # hiring roles for runs that name none
    custom: bool

    # ------------------------------------------------------------------ products and signals

    def product_name(self, key: str) -> str:
        return self.name if key == OFFER_KEY else PRODUCT_NAMES.get(key, key)

    def label(self, key: str) -> str:
        signal = self.signals.get(key) or SIGNALS.get(key)
        return signal.label if signal else key

    def relevant_signals(self) -> set[str]:
        """Signals that count towards at least one product (all of them if none has rules)."""
        keys = {k for p in self.products for k, w in self.weights.get(p, {}).items() if w > 0}
        return keys or set(self.signals)

    def weight(self, key: str) -> int:
        return max((self.weights.get(p, {}).get(key, 0) for p in self.products), default=0)

    def score_products(self, signal_keys: set[str]) -> list[ProductScore]:
        scores = []
        for key in self.products:
            weights = self.weights.get(key)
            if not weights:
                scores.append(ProductScore(key, self.product_name(key), None, []))
                continue
            hits = sorted((k for k in signal_keys if k in weights), key=lambda k: -weights[k])
            points = sum(weights[k] for k in hits)
            saturation = self.saturation.get(key, SATURATION)
            scores.append(ProductScore(key, self.product_name(key), min(100, round(points * 100 / saturation)),
                                       [self.label(k) for k in hits]))
        return sorted(scores, key=lambda s: -1 if s.score is None else s.score, reverse=True)

    def run_hiring_roles(self, hiring_roles: list[str] | None) -> list[str]:
        return list(hiring_roles) if hiring_roles else list(self.roles)

    def need_holds(self, quote: str) -> bool:
        """An explicit request must name what is wanted: a software word for the education catalogue,
        or for an offer a software word or one of the offer's own name words ('solar', 'payroll')."""
        if _INTENT_SOFTWARE.search(quote):
            return True
        if not self.custom:
            return False
        words = set(re.findall(r"[a-z0-9]+", quote.lower()))
        return any(w in words for w in _name_words(self.name))

    # ------------------------------------------------------------------ competitors

    def extra_vendors(self) -> tuple[Vendor, ...]:
        """The offer's competitors that the vendor library does not know, as vendors detected by their
        domain in the page code or by 'powered by <name>'."""
        known = {v.key for v in VENDORS} | {d for v in VENDORS for d in v.hosts}
        known_names = {v.name.lower() for v in VENDORS}
        out = []
        for name, domain in self.competitors:
            if (domain and domain in known) or name.lower() in known_names:
                continue
            key = domain or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")  # read as is in flag words
            out.append(Vendor(key, name, "competitor", True, hosts=(domain,) if domain else (),
                              powered=(name.lower(),) if len(name) >= 4 else ()))
        return tuple(out)

    def is_competitor(self, platform: dict[str, Any]) -> bool:
        """A detected platform competes with this offer: its kind is one the offer competes with, it
        is one of the offer's named competitors, or it was found as one (extra_vendors)."""
        if platform.get("kind") == "competitor":
            return True
        if not self.custom:
            return bool(platform.get("competitor")) and platform.get("kind") in self.competitor_kinds
        if platform.get("kind") in self.competitor_kinds:
            return True
        vendor = next((v for v in VENDORS if v.key == platform.get("key")), None)
        for name, domain in self.competitors:
            if name.lower() == str(platform.get("name") or "").lower():
                return True
            if vendor and domain and domain in vendor.hosts:
                return True
        return False

    def mark_competitors(self, platforms: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{**p, "competitor": self.is_competitor(p)} for p in platforms]


def _name_words(name: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", name.lower()) if len(w) > 2 and w not in _NAME_FILLER]


def competitor_domain(value: Any) -> str | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    host = urlparse(text if "://" in text else f"https://{text}").hostname or ""
    host = host.removeprefix("www.")
    return host if "." in host else None


def _text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


# ---------------------------------------------------------------------- building offers

def legacy_offer(products: list[str] | tuple[str, ...] | None, description: str | None = None) -> Offer:
    """Vacademy's product keys scored with the education catalogue (agents made before offers)."""
    keys = tuple(p for p in products or () if p in PRODUCT_NAMES and p != OFFER_KEY) or DEFAULT_PRODUCTS
    return Offer(
        name=", ".join(PRODUCT_NAMES[p] for p in keys), seller="Vacademy", summary=_text(description, 600),
        signals=dict(SIGNALS), fit_points=dict(LEGACY_FIT_POINTS), products=keys,
        weights={k: dict(WEIGHTS.get(k, {})) for k in keys}, saturation=dict(SATURATION_BY_PRODUCT),
        competitor_kinds=LEGACY_COMPETITOR_KINDS, competitors=(), education=True,
        discovery_question=LEGACY_QUESTION,
        roles=tuple(dict.fromkeys(r for p in keys for r in SUGGESTED_ROLES.get(p, []))), custom=False,
    )


def custom_offer(offer: dict[str, Any], description: str | None = None) -> Offer:
    """brief["offer"] (models.Offer) -> Offer. Fit signals take keys fit_1.. by position."""
    name = _text(offer.get("name"), 80) or "what is being sold"
    signals = {k: SIGNALS[k] for k in UNIVERSAL}
    signals["explicit_software_need"] = SignalType(
        "Looking for a solution",
        f"The organisation says it is looking for, evaluating or buying {name} or something like it, or has "
        "published a tender, RFP or requirement for it.",
        True,
    )
    fit_points = dict(UNIVERSAL_FIT_POINTS)
    weights = dict(UNIVERSAL_WEIGHTS)
    for key, item in zip(CUSTOM_KEYS, [s for s in offer.get("fit_signals") or [] if isinstance(s, dict)]):
        label = _text(item.get("label"), 60)
        if not label:
            continue
        weight = item.get("weight") if item.get("weight") in FIT_POINTS_BY_WEIGHT else 2
        signals[key] = SignalType(label, _text(item.get("description"), 200) or label)
        fit_points[key] = FIT_POINTS_BY_WEIGHT[weight]
        weights[key] = weight
    competitors = []
    for c in offer.get("competitors") or []:
        if isinstance(c, dict) and _text(c.get("name"), 80):
            competitors.append((_text(c.get("name"), 80), competitor_domain(c.get("domain"))))
    return Offer(
        name=name, seller=_text(offer.get("seller"), 120), summary=_text(description, 600),
        signals=signals, fit_points=fit_points, products=(OFFER_KEY,), weights={OFFER_KEY: weights},
        saturation={OFFER_KEY: SATURATION},
        competitor_kinds=frozenset(k for k in offer.get("competitor_kinds") or [] if k in COMPETITOR_KINDS),
        competitors=tuple(competitors), education=bool(offer.get("education")),
        discovery_question=_text(offer.get("discovery_question"), 200) or GENERIC_QUESTION,
        roles=(), custom=True,
    )


def resolve_offer(brief: dict[str, Any] | None) -> Offer:
    brief = brief or {}
    offer = brief.get("offer")
    if isinstance(offer, dict) and _text(offer.get("name"), 80):
        return custom_offer(offer, brief.get("description"))
    return legacy_offer(brief.get("products"), brief.get("description"))


def as_offer(value: Any) -> Offer:
    """An Offer from an Offer, a brief (dict) or a list of product keys."""
    if isinstance(value, Offer):
        return value
    if isinstance(value, dict):
        return resolve_offer(value)
    keys = list(value or [])
    if OFFER_KEY in keys:  # a plan's target_products without its brief: the universal signals only
        return custom_offer({"name": "what is being sold"})
    return legacy_offer(keys)


def legacy_offer_dict(products: list[str] | None) -> dict[str, Any]:
    """brief["offer"] for a brief that has only product keys, so the form edits every agent the same
    way: the education catalogue's fit signals with their points as weights."""
    legacy = legacy_offer(products)
    by_points = {15: 3, 10: 2, 8: 2}
    fit = [{"label": SIGNALS[k].label, "description": SIGNALS[k].description, "weight": by_points.get(p, 1)}
           for k, p in LEGACY_FIT_POINTS.items() if k not in UNIVERSAL]
    return {"name": legacy.name, "seller": legacy.seller, "website": None, "fit_signals": fit[:MAX_FIT_SIGNALS],
            "competitors": [], "competitor_kinds": sorted(LEGACY_COMPETITOR_KINDS), "education": True,
            "discovery_question": legacy.discovery_question}


def offer_dict(brief: dict[str, Any] | None) -> dict[str, Any]:
    """brief["offer"] as stored, or derived from the product keys of an older brief."""
    brief = brief or {}
    offer = brief.get("offer")
    if isinstance(offer, dict) and _text(offer.get("name"), 80):
        return offer
    return legacy_offer_dict(brief.get("products"))


__all__ = [n for n in dir() if not n.startswith("_")]
