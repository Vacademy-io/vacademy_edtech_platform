"""Lead score and delivery gate (v1 rules, to be tuned with sales; spec §3, plan §5-6).

A lead that passes the gate is called and messaged automatically, so the score asks four questions:

  fit    (0-100)  does the organisation match the brief: the target segment, the offer's fit signals
                  found on its site (engine/offer.py: an offer's own, or for Vacademy's product keys
                  online courses, test series, admissions, enquiry forms), branches, the markets, the
                  brief's must-have phrases found in the evidence;
  intent (0-100)  is it acting now: hiring for the brief's roles, asking for software, a keyword need,
                  a new centre; worth more when dated within RECENT_DAYS, much less after STALE_DAYS;
  reach  (0-100)  can a decision maker be reached: the best contact's tier (direct > likely > general);
  risk   (0-100)  reasons not to sell: already on a platform that competes with the offer, too big to
                  buy self-serve, (education offers only) a single tutor.

  score = clamp(0.35 * fit + 0.30 * intent + 0.35 * reach - 0.5 * risk)

Hard rejects (no usable contact, site not readable, not the target segment, selling the offer itself,
an excluded kind or a deal-breaker) are flagged and always REJECT. Fitting the brief is not enough to be delivered
automatically: without a buying signal a lead reaches the auto bar only with a full fit and a direct
contact. A lead judged from its Google Maps listing alone (its website could not be read: flag
"maps_only", research.py) always goes to a person, whatever its score: the listing shows too little
to score it like a read website.

The engine's catalogue product scores are kept as ``products`` (research/catalogue.py).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from .discovery.exclusions import _SCHOOL, _TRAINING_SCHOOL, _pattern, left_out
from .fingerprint import VENDORS_BY_KEY
from .offer import LEGACY_FIT_POINTS, as_offer
from .research.catalogue import SIGNALS
from .research.contacts import phone_region
from .research.lead import is_national_brand

# ------------------------------------------------------------------------------------ constants

WEIGHT_FIT = 0.35
WEIGHT_INTENT = 0.30
WEIGHT_REACH = 0.35
WEIGHT_RISK = 0.5

# Fit points (capped at 100).
FIT_SEGMENT = 30  # the model read the site as the requested kind of organisation
FIT_LOCATION = 10  # in one of the agent's markets
FIT_SIGNALS = LEGACY_FIT_POINTS  # Vacademy's product keys; an offer has its own (Offer.fit_points)
FIT_MUST_HAVE = 5  # per must-have phrase found in the evidence
FIT_MUST_HAVE_MAX = 15

# Intent points per buying signal; the strongest counts fully, the others add OTHER_SIGNALS_SHARE.
INTENT_SIGNALS = {"explicit_software_need": 70, "hiring": 60, "new_centre": 50, "keyword_need": 40}
INTENT_DATED_ADMISSIONS = 20  # admissions or a new batch opened within RECENT_DAYS (a date is shown)
OTHER_SIGNALS_SHARE = 0.3
RECENT_DAYS = 60
RECENT_BOOST = 1.4
STALE_DAYS = 180
STALE_FACTOR = 0.35

REACH_POINTS = {"direct": 100, "likely": 70, "general": 35, "none": 0}
CONTACT_ORDER = {"none": 0, "general": 1, "likely": 2, "direct": 3}

RISK_COMPETITOR = 40  # already runs on a platform that competes with the offer (Offer.is_competitor)
RISK_ENTERPRISE = 30  # national-scale brand: not a self-serve buyer
RISK_MICRO = 25  # a single tutor or home tuition

# Flags that send a lead to a person (never AUTO), and flags that always reject it.
# possible_duplicate: same name and city as another of the agent's live leads with nothing shared, added
# after research (lead_agent/dedupe.py; quantumcoaching.in and quantumcoachinginstitute.in, 2026-10-29).
# maps_only: judged from its Google Maps listing because the website could not be read (2026-10-29 audit:
# 202 of 237 "No readable page" rejects on "Leads for Vacademy" had a listing with a phone).
REVIEW_FLAGS = ("competitor_platform", "enterprise", "possible_duplicate", "maps_only")
# Review flags without a risk penalty: they hold a lead back from AUTO but never lift a score that
# is below the review bar into REVIEW.
UNPENALISED_REVIEW_FLAGS = ("possible_duplicate",)
# Review flags that send a lead to REVIEW whatever its score (unless a hard reject applies): a listing
# alone cannot show the signals and fit points a website would, so its score is a floor, not a verdict.
ALWAYS_REVIEW_FLAGS = ("maps_only",)
HARD_REJECT_FLAGS = ("no_contact", "site_unreadable", "not_target_segment", "excluded_kind", "deal_breaker",
                     "sells_the_offer")

DEFAULT_GATE = {"auto_score": 70, "review_score": 45, "min_contact": "likely", "require_intent": False,
                "auto_competitor_users": False}


def _clamp(value: float) -> int:
    return int(max(0, min(100, round(value))))


# ---------------------------------------------------------------------------------- event dates

_ORDINAL = re.compile(r"(\d{1,2})(?:st|nd|rd|th)\b", re.I)
_AGO = re.compile(r"\b(\d+|an?|one)\+?\s*(hours?|hrs?|days?|d|weeks?|wks?|w|months?|mos?|years?|yrs?)\s+ago\b", re.I)
_UNIT_DAYS = {"h": 0, "d": 1, "w": 7, "m": 30, "y": 365}
_FORMATS = ("%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
            "%d %B, %Y", "%d %b, %Y", "%B %d, %Y", "%b %d, %Y", "%b. %d, %Y", "%B %Y", "%b %Y")


def signal_age_days(event_date: str | None, today: date | None = None) -> int | None:
    """Days since a signal's date as written on the page or result ("3 days ago", "24 September
    2026", "2026-10-03", "Sep 2026"); 0 for future dates (an upcoming batch), None if unreadable."""
    if not event_date:
        return None
    today = today or date.today()
    text = " ".join(event_date.strip().split())
    lowered = text.lower()
    if re.search(r"\b(today|just now|just posted|few hours ago|\d+\s*(?:minutes?|mins?)\s+ago)\b", lowered):
        return 0
    if "yesterday" in lowered:
        return 1
    m = _AGO.search(lowered)
    if m:
        count = 1 if m.group(1) in ("a", "an", "one") else int(m.group(1))
        unit = m.group(2)[0]
        unit = "m" if m.group(2).startswith(("mo", "mos")) else unit
        return count * _UNIT_DAYS.get(unit, 1)
    cleaned = _ORDINAL.sub(r"\1", text).replace("Sept ", "Sep ")
    candidates = [cleaned] + re.findall(
        r"\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}"
        r"|[A-Za-z]{3,9}\s+\d{4}", cleaned)
    for candidate in candidates:
        for fmt in _FORMATS:
            try:
                parsed = datetime.strptime(candidate.strip(" ,."), fmt).date()
            except ValueError:
                continue
            if fmt in ("%B %Y", "%b %Y"):
                parsed = parsed.replace(day=15)
            return max(0, (today - parsed).days)
    return None


def _recency(age: int | None) -> float:
    if age is None:
        return 1.0
    if age <= RECENT_DAYS:
        return RECENT_BOOST
    if age > STALE_DAYS:
        return STALE_FACTOR
    return 1.0


# --------------------------------------------------------------------------------- text matching

_FILLER = frozenset({"the", "and", "for", "with", "has", "have", "offers", "offer", "offering", "provides", "provide",
                     "runs", "run", "its", "their", "own", "any", "all", "our", "who", "that", "are", "is", "a", "an",
                     "of", "in", "on", "to", "or"})


def _stem(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("es") and word[-3] in "sxz":
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _words(text: str) -> set[str]:
    return {_stem(w) for w in re.findall(r"[a-z0-9]+", (text or "").lower())}


def _terms(phrase: str) -> list[str]:
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", phrase.lower()) if len(w) > 2 and w not in _FILLER]


def phrase_found(phrase: str, text: str) -> bool:
    """Every distinctive word of the phrase is in the text ('offers online courses' needs 'online'
    and 'course')."""
    terms = _terms(phrase)
    return bool(terms) and set(terms) <= _words(text)


def _kind_phrase(phrase: str) -> bool:
    return _pattern(phrase) is _SCHOOL or bool(re.search(r"college|universit|higher education", phrase, re.I))


def deal_breaker_hit(phrase: str, name: str, description: str, in_segment: bool) -> bool:
    """Kinds ("schools", "colleges") match the organisation's name, and its description only when the
    model also says it is outside the segment (a coaching institute may teach school students); any
    other phrase must have all its words in the name or description."""
    if _kind_phrase(phrase):
        pattern = _pattern(phrase)
        if pattern is None:
            return False
        subject = _TRAINING_SCHOOL.sub(" ", name) if pattern is _SCHOOL else name
        if pattern.search(subject):
            return True
        if not in_segment:
            subject = _TRAINING_SCHOOL.sub(" ", description) if pattern is _SCHOOL else description
            return bool(pattern.search(subject))
        return False
    return phrase_found(phrase, name) or phrase_found(phrase, description)


# Words that say "an organisation" without saying which kind: a Maps category or name sharing only
# these with an industry ("Training center" and "tuition centres") does not match it.
_KIND_FILLER = frozenset({
    "online", "company", "companies", "centre", "centres", "center", "centers", "service", "services", "business",
    "businesses", "provider", "providers", "agency", "agencies", "firm", "firms", "brand", "brands", "team",
    "teams", "organisation", "organisations", "organization", "organizations", "institute", "institutes",
    "institution", "institutions", "shop", "shops", "store", "stores", "group", "groups", "private", "local",
    "small", "large", "independent", "new", "other", "office", "offices", "industry", "industries",
})
_INDUSTRY_PARTS = re.compile(r"\s*(?:/|,|&|\(|\)|\band\b|\bor\b)\s*", re.I)


def maps_kind(category: str | None, name: str | None, industries: list[dict[str, Any]] | None) -> str | None:
    """The brief's industry that a Google Maps listing's category or name shows, or None.

    Each industry's name and search term is read in parts ("Tutoring and tuition centres" -> "Tutoring",
    "tuition centres"); a part matches when every distinctive word of it is in the category or name
    (phrase_found; "Coaching institutes" -> coaching: "Coaching center"), and a school or college part
    by exclusions' kind patterns (a "University" is a college; a "Business school" is not a K-12 school).
    For a lead whose website could not be read (2026-10-29): judged without the model, so a category
    that shares only words like "centre" or "services" with an industry does not count."""
    subject = f"{category or ''} {name or ''}".strip()
    if not subject:
        return None
    for industry in industries or []:
        label = (industry.get("name") or industry.get("search_term") or "").strip()
        for text in (industry.get("search_term"), industry.get("name")):
            for part in _INDUSTRY_PARTS.split(text or ""):
                words = [w for w in re.findall(r"[a-z0-9]+", part.lower()) if w not in _KIND_FILLER]
                if not words:
                    continue
                if _kind_phrase(part):
                    if left_out(subject, [part]):
                        return label
                elif phrase_found(" ".join(words), subject):
                    return label
    return None


# ------------------------------------------------------------------------------------- scoring

def _live(signal: dict[str, Any]) -> bool:
    return (signal.get("verification") or {}).get("status") != "removed"


def _evidence_text(lead: dict[str, Any]) -> str:
    org = lead.get("organisation") or {}
    parts = [org.get("name") or "", org.get("what_they_do") or "", lead.get("summary") or ""]
    parts += [f"{s.get('value') or ''} {s.get('quote') or ''}" for s in lead.get("signals") or []]
    parts += [e.get("quote") or "" for e in lead.get("evidence") or []]
    return "\n".join(parts)


def _location_match(lead: dict[str, Any], markets: list[dict[str, Any]]) -> str | None:
    """Which market the lead is in, as a reason; None when it is not shown to be in any."""
    if not markets:
        return "no market restriction"
    org = lead.get("organisation") or {}
    places = " ".join([org.get("city") or "", " ".join(b.get("city") or b.get("value") or ""
                                                       for b in org.get("branches") or [])])
    text = f"{places}\n{org.get('what_they_do') or ''}\n{_evidence_text(lead)}".lower()
    for market in markets:
        for key in ("city", "state"):
            place = (market.get(key) or "").strip().lower()
            if place and re.search(rf"\b{re.escape(place)}\b", text):
                return f"in {market[key]}"
    for market in markets:
        if not market.get("city") and not market.get("state") and market.get("country"):
            region = phone_region(None, market["country"])
            if (lead.get("phone_region") or "") == region or region == phone_region(org.get("domain")):
                return f"in {market['country']}"
    return None


def _fmt(n: int) -> str:
    return f"{n:,}"


def score_lead(lead: dict, brief: dict, platforms: list[dict], size: dict, *, today: date | None = None) -> dict:
    """{"score", "base_score", "fit", "intent", "reach", "risk", "products": [{key, name, score, why}],
    "has_intent", "flags": [...], "reasons": [...], "reach_level"}.

    lead: research.lead.build_lead's record (after merge_lookup + apply_rules when a lookup ran).
    brief: lead_agent.brief_json (spec §2.1), optionally with "markets": [{country, state?, city?}];
    its offer (or product keys) says which signals fit and which platforms compete.
    platforms: fingerprint.detect_platforms; size: fingerprint.size_signals.
    base_score is the score before the risk penalty (gate uses it for flagged leads)."""
    brief = brief or {}
    offer = as_offer(brief)
    org = lead.get("organisation") or {}
    in_segment = bool(org.get("is_target_segment"))
    signals = [s for s in lead.get("signals") or [] if _live(s)]
    keys = {s["key"] for s in signals}
    flags: list[str] = []
    reasons: list[str] = []

    # Fit.
    fit = 0
    fit_why: list[str] = []
    if in_segment:
        fit += FIT_SEGMENT
        fit_why.append("the kind of organisation the brief targets")
    where = _location_match(lead, list(brief.get("markets") or []))
    if where:
        fit += FIT_LOCATION
        if where != "no market restriction":
            fit_why.append(where)
    if len(org.get("branches") or []) >= 2:
        keys.add("multiple_branches")
    for key, points in offer.fit_points.items():
        if key in keys:
            fit += points
            fit_why.append(offer.label(key).lower())
    corpus = _evidence_text(lead)
    matched = [p for p in brief.get("must_have") or [] if isinstance(p, str) and phrase_found(p, corpus)]
    if matched:
        fit += min(FIT_MUST_HAVE_MAX, FIT_MUST_HAVE * len(matched))
        fit_why.append("must-have: " + "; ".join(matched))
    fit = _clamp(fit)

    # Intent.
    found: list[tuple[float, str, bool]] = []  # (points, reason, counts as a buying signal)
    for s in signals:
        points = INTENT_SIGNALS.get(s["key"])
        age = signal_age_days(s.get("event_date"), today)
        if points is None:
            if s["key"] == "admissions_open" and age is not None and age <= RECENT_DAYS:
                found.append((INTENT_DATED_ADMISSIONS, f"admissions opened recently ({s.get('event_date')})", False))
            continue
        factor = _recency(age)
        when = f" ({s['event_date']})" if s.get("event_date") else ""
        label = s.get("label") or SIGNALS.get(s["key"], SIGNALS["hiring"]).label
        stale = " - old, counts little" if factor < 1 else ""
        found.append((points * factor, f"{label}{when}{stale}", factor >= 1))
    found.sort(key=lambda f: -f[0])
    intent = _clamp(found[0][0] + OTHER_SIGNALS_SHARE * sum(f[0] for f in found[1:])) if found else 0
    has_intent = any(buying for _, _, buying in found)

    # Reach.
    quality = lead.get("contact_quality") or {}
    level = quality.get("level") or "none"
    reach = REACH_POINTS.get(level, 0)

    # Risk.
    risk = 0
    competitors = [p for p in platforms or [] if offer.is_competitor(p)]
    for p in competitors:
        flags.append(f"competitor_platform:{p['key']}")
    if competitors:
        risk += RISK_COMPETITOR
        names = ", ".join(f"{p['name']} ({p.get('kind', '')})" for p in competitors)
        reasons.append(f"Risk: already uses {names}, a competitor: needs a switch pitch ({competitors[0].get('evidence', '')})")
    tier = (size or {}).get("tier")
    if tier == "enterprise" or (offer.education and is_national_brand(lead)):
        flags.append("enterprise")
        risk += RISK_ENTERPRISE
        figures = [f"{_fmt(size[f])} {f.replace('_', ' ')}" for f in ("youtube_subscribers", "app_downloads", "students",
                                                                       "selections", "branches") if (size or {}).get(f)]
        what = ", ".join(figures[:3]) if figures else "a national brand"
        reasons.append(f"Risk: very large ({what}): not a self-serve buyer")
    elif tier == "micro" and offer.education:
        flags.append("micro")
        risk += RISK_MICRO
        reasons.append(f"Risk: looks like a single tutor or home tuition (\"{size.get('micro_hint') or ''}\")")
    risk = _clamp(risk)

    # Hard rejects.
    if level == "none":
        flags.append("no_contact")
        reasons.append(f"No usable contact: {quality.get('label') or 'none published'}")
    pages = lead.get("pages") or []
    if lead.get("maps_only"):
        flags.append("maps_only")
        reasons.append(_FLAG_WORDS["maps_only"])
    elif lead.get("site_readable") is False or not any(p.get("type") != "job_post" for p in pages):
        flags.append("site_unreadable")
        reasons.append("The organisation's website could not be read")
    if not in_segment:
        flags.append("not_target_segment")
        reasons.append("Not the kind of organisation (or place) the brief targets")
    if org.get("sells_the_offer"):
        flags.append("sells_the_offer")
        reasons.append(f"Sells what is being sold ({offer.name}): a competitor or reseller, not a buyer")
    name, description = org.get("name") or org.get("listed_name") or "", f"{org.get('what_they_do') or ''} {lead.get('summary') or ''}"
    phrase = left_out(name, brief.get("exclude")) or (
        left_out(org.get("what_they_do") or "", brief.get("exclude")) if not in_segment else None)
    if phrase:
        flags.append(f"excluded_kind:{phrase}")
        reasons.append(f"Left out by the brief: {phrase}")
    for breaker in brief.get("deal_breakers") or []:
        if isinstance(breaker, str) and breaker.strip() and deal_breaker_hit(breaker, name, description, in_segment):
            flags.append(f"deal_breaker:{breaker}")
            reasons.append(f"Deal-breaker in the brief: {breaker}")

    base = WEIGHT_FIT * fit + WEIGHT_INTENT * intent + WEIGHT_REACH * reach
    score = _clamp(base - WEIGHT_RISK * risk)

    head = [f"Fit {fit}/100" + (f": {', '.join(fit_why)}" if fit_why else "")]
    head.append(f"Buying signal: {'; '.join(r for _, r, _ in found)}" if found else "No buying signal found")
    head.append(f"Reach: {quality.get('label') or level}")
    reasons = head + reasons

    products = lead.get("products")
    if products is None:
        products = [{"key": s.key, "name": s.name, "score": s.score, "why": s.why}
                    for s in offer.score_products(keys)]
    return {
        "score": score, "base_score": _clamp(base), "fit": fit, "intent": intent, "reach": reach, "risk": risk,
        "products": products, "has_intent": has_intent, "flags": list(dict.fromkeys(flags)), "reasons": reasons,
        "reach_level": level,
    }


# ------------------------------------------------------------------------------------------ gate

def _flag_kind(flag: str) -> str:
    return flag.split(":", 1)[0]


def gate(scored: dict, lead: dict, gate_cfg: dict) -> tuple[str, list[str]]:
    """("AUTO" | "REVIEW" | "REJECT", reasons in plain words).

    REJECT: a hard-reject flag, or a score below review_score. A lead flagged for a person
    (competitor platform, enterprise) whose score is below the bar only because of that flag's risk
    penalty goes to REVIEW instead, so a salesperson decides on the switch pitch; a lead judged from
    its Google Maps listing alone (maps_only) goes to REVIEW whatever its score.
    AUTO: score >= auto_score, the best contact at least min_contact, a buying signal when
    require_intent, and no review flag. Otherwise REVIEW.
    auto_competitor_users: a list that takes organisations on a competitor's platform like any
    other; they are judged on their score without that penalty and the flag holds nothing back."""
    cfg = {**DEFAULT_GATE, **{k: v for k, v in (gate_cfg or {}).items() if v is not None}}
    auto_bar, review_bar = int(cfg["auto_score"]), int(cfg["review_score"])
    min_contact = cfg["min_contact"] if cfg["min_contact"] in CONTACT_ORDER else DEFAULT_GATE["min_contact"]
    flags = list(scored.get("flags") or [])
    score = int(scored.get("score") or 0)
    switch_ok = bool(cfg.get("auto_competitor_users")) and any(
        _flag_kind(f) == "competitor_platform" for f in flags)
    if switch_ok:  # the other risks (enterprise, micro) still count
        score = _clamp(int(scored.get("base_score") or 0)
                       - WEIGHT_RISK * max(0, int(scored.get("risk") or 0) - RISK_COMPETITOR))

    hard = [f for f in flags if _flag_kind(f) in HARD_REJECT_FLAGS]
    if hard:
        return "REJECT", [_flag_words(f) for f in hard]

    review_flags = [f for f in flags if _flag_kind(f) in REVIEW_FLAGS
                    and not (switch_ok and _flag_kind(f) == "competitor_platform")]
    flag_words = [_flag_words(f) for f in review_flags]
    if score < review_bar and any(_flag_kind(f) in ALWAYS_REVIEW_FLAGS for f in review_flags):
        return "REVIEW", [f"Score {score} counts only what is known without the website: a person should decide",
                          *flag_words]
    if score < review_bar:
        penalised = [f for f in review_flags if _flag_kind(f) not in UNPENALISED_REVIEW_FLAGS]
        if penalised and int(scored.get("base_score") or 0) >= review_bar:
            return "REVIEW", [f"Score {score} after the risk penalty (before it {scored.get('base_score')}): "
                              "a person should decide", *flag_words]
        return "REJECT", [f"Score {score} is below the review bar ({review_bar})"]

    level = (lead.get("contact_quality") or {}).get("level") or scored.get("reach_level") or "none"
    blockers: list[str] = []
    if score < auto_bar:
        blockers.append(f"Score {score} is below the auto-deliver bar ({auto_bar})")
    if CONTACT_ORDER.get(level, 0) < CONTACT_ORDER[min_contact]:
        blockers.append(f"Best contact is {level}; this list needs at least {min_contact}")
    if cfg.get("require_intent") and not scored.get("has_intent"):
        blockers.append("No buying signal, and this list requires one")
    blockers += flag_words
    if not blockers:
        met = [f"Score {score} meets the auto-deliver bar ({auto_bar}) with a {level} contact"]
        if switch_ok:
            met.append("Already uses a competitor's platform: this list takes them without review")
        return "AUTO", met
    return "REVIEW", blockers


_FLAG_WORDS = {
    "no_contact": "No usable contact (only helplines, support inboxes or an enquiry form)",
    "site_unreadable": "The organisation's website could not be read",
    "not_target_segment": "Not the kind of organisation the brief targets",
    "sells_the_offer": "Sells what you sell: a competitor or reseller, not a buyer",
    "excluded_kind": "Left out by the brief: {detail}",
    "deal_breaker": "Deal-breaker in the brief: {detail}",
    "competitor_platform": "Already uses a competitor's platform ({detail}): needs a switch pitch",
    "enterprise": "Very large organisation: not a self-serve buyer",
    "micro": "Single tutor or home tuition",
    "possible_duplicate": "Possibly the same organisation as {detail} (same name and city): check before it goes out",
    "maps_only": "Judged from its Google Maps listing: the website could not be read",
}


def flag_words(flag: str) -> str:
    """A flag in plain words, as gate reasons show it."""
    return _flag_words(flag)


def _flag_words(flag: str) -> str:
    kind, _, detail = flag.partition(":")
    if kind == "competitor_platform" and detail in VENDORS_BY_KEY:
        detail = VENDORS_BY_KEY[detail].name
    return _FLAG_WORDS.get(kind, flag).format(detail=detail)
