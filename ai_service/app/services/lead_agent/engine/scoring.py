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

Hard rejects (no usable contact, site not readable, not the target segment, pages of another
organisation, outside the markets (another country, or none of the agent's cities and states), selling
the offer itself, an excluded kind or a deal-breaker) are flagged and always REJECT. Rank and fill
(2026-10-30): one bar, the agent's send_score. A lead at or above it is sent (best score first, up to
the daily quota), one below it is rejected; the risk penalty ranks a competitor's user or a very large
organisation lower instead of holding it back. Only validity goes to a person, and only at or above the
bar and within the list's own rules (min_contact, require_intent): a lead judged
from its Google Maps listing alone (its website could not be read: flag "maps_only", research.py) and a
possible duplicate of another lead. An agent with require_approval sends nothing a person has not approved.

The engine's catalogue product scores are kept as ``products`` (research/catalogue.py).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

import phonenumbers

from .discovery.exclusions import _SCHOOL, _TRAINING_SCHOOL, _pattern, left_out
from .discovery.pipeline import METRO_AREAS, _has_phrase, place_keys, place_names
from .discovery.pipeline import _words as _place_words
from .fingerprint import VENDORS_BY_KEY
from .offer import LEGACY_FIT_POINTS, as_offer
from .research.catalogue import SIGNALS
from .research.contacts import country_region, domain_region, number_region, phone_region, region_name
from .research.lead import is_national_brand
from .research.maps_listing import _STATES

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

# Flags that send a lead to a person when its score reaches the send bar and it meets the list's own rules
# (min_contact, require_intent; below the bar or failing them: rejected, since nobody reviews in this funnel),
# and flags that always reject it. Validity first: outreach after delivery is
# automated, so a lead that may name the wrong organisation waits for a person instead of going out.
# maps_only: judged from its Google Maps listing because the website could not be read (2026-10-29 audit:
# 202 of 237 "No readable page" rejects on "Leads for Vacademy" had a listing with a phone); a listing
# alone cannot show the signals and fit points a website would, so its score is a floor, not a verdict.
# possible_duplicate: same name and city as another of the agent's live leads with nothing shared, added
# after research (lead_agent/dedupe.py; quantumcoaching.in and quantumcoachinginstitute.in, 2026-10-29).
# competitor_platform and enterprise held a lead back until 2026-10-30; their risk penalty ranks it now.
ALWAYS_REVIEW_FLAGS = ("maps_only", "possible_duplicate")
HARD_REJECT_FLAGS = ("no_contact", "site_unreadable", "not_target_segment", "excluded_kind", "deal_breaker",
                     "sells_the_offer", "wrong_site", "outside_market")
# Flags that carry a risk penalty: named after a reject so the reason says why the score is low.
RISK_FLAGS = ("competitor_platform", "enterprise", "micro")

# send_score: the lowest score a lead is sent with (rank and fill, 2026-10-30). An agent saved before it
# has none and gets this default. auto_score / review_score (the two bars before it) may still be in an
# agent's gate_json; the gate ignores them.
DEFAULT_GATE = {"send_score": 50, "require_approval": False, "min_contact": "likely", "require_intent": False,
                "auto_competitor_users": False}
# gate()'s own rules, part of gate_fingerprint: bumped when gate() decides differently from the same stored
# score and settings, so the REVIEW queue is judged again once (scheduler.rejudge_waiting skips a row
# already judged under the current fingerprint). 2: the list's own rules (min_contact, require_intent)
# before the held flags (2026-10-31).
GATE_RULES = 2


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


def _part(market: dict[str, Any], key: str) -> str:
    """A market's city, state or country as written, spaces tidied ('' when it has none)."""
    return " ".join(str(market.get(key) or "").split())


def _place_text(*texts: Any) -> str:
    """Texts written as words for place matching (lower case, accents dropped: discovery's spelling)."""
    return " ".join(_place_words(" ".join(str(t or "") for t in texts)))


def _names_place(place: str, text: str) -> bool:
    """The text (as _place_text writes it) names the place, or another name of it (Gurgaon / Gurugram,
    Bangalore / Bengaluru: discovery's table of Indian city renamings), as whole words."""
    key = " ".join(_place_words(place))
    return bool(key) and any(_has_phrase(name, text) for name in place_names(key))


def _names_market_place(place: str, text: str) -> bool:
    """_names_place, or a place of the metro area a market city stands for (Noida, Gurugram for Delhi;
    Thane for Mumbai: discovery's METRO_AREAS). For the city/state market rule only: a lead in the metro area
    is in the market, though it earns no FIT_LOCATION points for it."""
    if _names_place(place, text):
        return True
    words = " ".join(_place_words(place))
    city = place_names(words)[0] if words else ""
    return any(_names_place(area, text) for area in METRO_AREAS.get(city, ()))


def _location_text(lead: dict[str, Any]) -> str:
    """Everything that may say where the organisation is: its city, branches, Google Maps listing address,
    description and evidence."""
    org = lead.get("organisation") or {}
    branches = " ".join(str(b.get("city") or b.get("value") or "") for b in org.get("branches") or []
                        if isinstance(b, dict))
    return _place_text(org.get("city"), branches, _listing_address(lead), org.get("what_they_do"),
                       _evidence_text(lead))


def _listing_address(lead: dict[str, Any]) -> str:
    listing = lead.get("maps_listing")
    return str(listing.get("address") or "") if isinstance(listing, dict) else ""


def _location_match(lead: dict[str, Any], markets: list[dict[str, Any]]) -> str | None:
    """Which market the lead is in, as a reason; None when it is not shown to be in any."""
    if not markets:
        return "no market restriction"
    org = lead.get("organisation") or {}
    text = _location_text(lead)
    for market in markets:
        for key in ("city", "state"):
            place = _part(market, key)
            if place and _names_place(place, text):
                return f"in {place}"
    for market in markets:
        if not market.get("city") and not market.get("state") and market.get("country"):
            region = phone_region(None, market["country"])
            if (lead.get("phone_region") or "") == region or region == phone_region(org.get("domain")):
                return f"in {market['country']}"
    return None


_PHONE_KINDS = ("institute_phone", "whatsapp")


def outside_markets(lead: dict[str, Any], markets: list[dict[str, Any]] | None) -> str | None:
    """Positive evidence that the organisation is in a COUNTRY none of the agent's markets is in, in words
    ("its phones are +1 (United States)"), or None. Since 2026-10-30 is_target_segment is the kind only, and
    _location_match only adds points for a market it sees, so nothing else keeps a US lead of an India-only
    agent from being sent and charged.

    Conservative on purpose: it fires only when every usable phone is from another country, or the domain
    has a country code outside the markets (.uk, .com.au), and no phone at all (usable or not) is from a
    market country and the domain is not a market country's (.in is India). Never for an agent without
    markets, a market whose country the tables do not know (or "Worldwide"), an unknown location (a phone
    without a country code, a generic domain: .com, .org, .io) or a city or state inside a market country
    (prod audit 2026-10-30: Delhi colleges on a Rajasthan + Delhi agent were real leads); the agent's
    cities and states are outside_market_places'."""
    homes = [country_region(m.get("country")) for m in markets or [] if isinstance(m, dict)]
    if not homes or None in homes:
        return None
    home = set(homes)
    domain = (lead.get("organisation") or {}).get("domain") or ""
    tld = domain_region(domain)
    if tld in home:  # a market country's domain (.in for India) is evidence for the market, whatever the phones
        return None
    phones = [c for c in lead.get("contacts") or [] if c.get("kind") in _PHONE_KINDS]
    if any(number_region(c.get("value")) in home for c in phones):
        return None
    usable = [number_region(c.get("value")) for c in phones if c.get("quality") != "avoid"]
    if usable and all(usable):
        where = ", ".join(f"+{phonenumbers.country_code_for_region(r)} ({region_name(r)})"
                          for r in dict.fromkeys(usable))
        return f"its phone{'s are' if len(usable) > 1 else ' is'} {where}"
    if tld:  # a country-code domain outside the markets, and no phone from a market country
        return f"its website is on .{domain.rsplit('.', 1)[-1].lower()} ({region_name(tld)})"
    return None


# Indian states and union territories an address may name. Those that are also cities (Delhi, Chandigarh,
# Puducherry) are left out: naming one says nothing about which state an organisation is in.
_OTHER_STATES = tuple(sorted(_STATES - {"delhi", "new delhi", "chandigarh", "puducherry", "pondicherry"}))


def _lead_countries(lead: dict[str, Any]) -> set[str]:
    """The countries the lead is shown to be in: its usable phones' country codes, a country-code domain."""
    found = {number_region(c.get("value")) for c in lead.get("contacts") or []
             if c.get("kind") in _PHONE_KINDS and c.get("quality") != "avoid"}
    found.add(domain_region((lead.get("organisation") or {}).get("domain")))
    return {r for r in found if r}


def outside_market_places(lead: dict[str, Any], markets: list[dict[str, Any]] | None) -> str | None:
    """Positive evidence that the organisation is in none of the agent's cities and states, in words ("it
    is in Mumbai; your markets are Jaipur"), or None. Since 2026-10-30 is_target_segment is the kind only
    and discovery never judges the place, so being elsewhere cost a lead only FIT_LOCATION (3.5 points): a
    Mumbai coaching institute that is hiring scored about 57 on an agent whose only market is Jaipur, and
    was sent and charged (review of PR 3569, 2026-10-31).

    Conservative on purpose. It fires only when all of these hold:
      * the organisation's city is known (from its pages or its Google Maps listing; never a country or
        "online"), and nothing about it (city, branches, listing address, description, evidence) names a
        market's city or state, another name of one (Gurgaon / Gurugram, Bombay / Mumbai) or a place of
        the metro area a market city stands for (Noida for Delhi, Thane for Mumbai: METRO_AREAS; "delhi"
        stored as a state counts, as Evalezy's market is);
      * every market in its country names a city or a state: a country-wide market takes every place in
        that country. With a country-wide market somewhere, the lead must be shown (a phone's country code,
        a country-code domain) to be in a country where the agent names only cities or states;
      * a market that names a state and no city is ruled out only when the organisation's city or listing
        address names another state: a city rarely carries its state's name (Kota, Udaipur for Rajasthan),
        so a city alone never rules a state out.
    Never for an agent without markets, a "Worldwide" market or a market country the tables do not know.
    The 2026-10-30 audit case (Delhi colleges on a "Rajasthan, India" + "delhi, India" agent) names a
    market, so it stays."""
    markets = [m for m in markets or [] if isinstance(m, dict)]
    org = lead.get("organisation") or {}
    city = " ".join(str(org.get("city") or "").split())
    if not markets or not place_keys(city):
        return None
    local = [m for m in markets if _part(m, "city") or _part(m, "state")]
    wide = {country_region(m.get("country")) for m in markets if not (_part(m, "city") or _part(m, "state"))}
    if wide:
        found = _lead_countries(lead)
        if None in wide or not found or found & wide:
            return None
        local = [m for m in local if country_region(m.get("country")) in found]
        if not local:
            return None  # a country with no market at all: outside_markets' rule
    text = _location_text(lead)
    located = _place_text(city, _listing_address(lead))
    for market in local:
        if _names_market_place(_part(market, "city"), text) or _names_market_place(_part(market, "state"), text):
            return None
        if not _part(market, "city") and not any(_names_place(state, located) for state in _OTHER_STATES):
            return None  # a state market, and nothing names another state
    names = ", ".join(dict.fromkeys(_part(m, "city") or _part(m, "state") for m in local))
    return f"it is in {city[:80]}; your markets are {names}"


def _fmt(n: int) -> str:
    return f"{n:,}"


def score_lead(lead: dict, brief: dict, platforms: list[dict], size: dict, *, today: date | None = None) -> dict:
    """{"score", "base_score", "fit", "intent", "reach", "risk", "products": [{key, name, score, why}],
    "has_intent", "flags": [...], "reasons": [...], "reach_level"}.

    lead: research.lead.build_lead's record (after merge_lookup + apply_rules when a lookup ran).
    brief: lead_agent.brief_json (spec §2.1), optionally with "markets": [{country, state?, city?}];
    its offer (or product keys) says which signals fit and which platforms compete.
    platforms: fingerprint.detect_platforms; size: fingerprint.size_signals.
    base_score is the score before the risk penalty (gate uses it for a list that takes competitors' users)."""
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
    # Pages of another organisation (pages_match_organisation false: a link shortener, a portal, a directory
    # page) are their own reject, not "not the kind": 34 of 179 "not the kind" rejects in the 2026-10-30 prod
    # audit were that. The kind and a seller verdict read from those pages say nothing about this organisation.
    # The kind is the kind only: a market city or state counts in fit (FIT_LOCATION); another country, or a
    # place shown to be none of the agent's cities and states, is outside_market.
    wrong_site = org.get("pages_match_organisation") is False
    if wrong_site:
        flags.append("wrong_site")
        reasons.append(_FLAG_WORDS["wrong_site"])
    elif not in_segment:
        flags.append("not_target_segment")
        reasons.append(_FLAG_WORDS["not_target_segment"])
    if org.get("sells_the_offer") and not wrong_site:
        flags.append("sells_the_offer")
        reasons.append(f"Sells what is being sold ({offer.name}): a competitor or reseller, not a buyer")
    # Another country, shown by its phones or its country-code domain (outside_markets); or a known city that is
    # none of the agent's cities and states (outside_market_places). Never read from another organisation's pages.
    markets = list(brief.get("markets") or [])
    elsewhere = None if wrong_site else (outside_markets(lead, markets) or outside_market_places(lead, markets))
    if elsewhere:
        flags.append(f"outside_market:{elsewhere}")
        reasons.append(_flag_words(f"outside_market:{elsewhere}"))
    name, description = org.get("name") or org.get("listed_name") or "", f"{org.get('what_they_do') or ''} {lead.get('summary') or ''}"
    if wrong_site:  # the description is the other organisation's
        description = ""
    phrase = left_out(name, brief.get("exclude")) or (
        left_out(org.get("what_they_do") or "", brief.get("exclude")) if not in_segment and not wrong_site else None)
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


def send_bar(gate_cfg: dict | None) -> int:
    """The agent's send_score (0-100); DEFAULT_GATE's for an agent saved before it had one."""
    try:
        value = int((gate_cfg or {}).get("send_score"))
    except (TypeError, ValueError):
        return int(DEFAULT_GATE["send_score"])
    return max(0, min(100, value))


def _settings(gate_cfg: dict | None) -> dict:
    """The gate's settings as gate() reads them: DEFAULT_GATE fills what an agent never saved (or saved as
    None), send_score clamped to 0-100, an unknown min_contact read as the default."""
    cfg = {**DEFAULT_GATE, **{k: v for k, v in (gate_cfg or {}).items() if v is not None}}
    min_contact = cfg["min_contact"] if cfg["min_contact"] in CONTACT_ORDER else DEFAULT_GATE["min_contact"]
    return {"send_score": send_bar(cfg), "require_approval": bool(cfg.get("require_approval")),
            "min_contact": min_contact, "require_intent": bool(cfg.get("require_intent")),
            "auto_competitor_users": bool(cfg.get("auto_competitor_users"))}


def gate_fingerprint(gate_cfg: dict | None) -> str:
    """Everything that decides gate()'s answer for a stored score, in one string ("v2:send=50:contact=likely:
    intent=0:competitors=0:approval=0"): the settings as gate() reads them and GATE_RULES. A lead kept in
    REVIEW is stamped with it (score_json.rejudged_for) and not judged again until it changes."""
    cfg = _settings(gate_cfg)
    return (f"v{GATE_RULES}:send={cfg['send_score']}:contact={cfg['min_contact']}:intent={int(cfg['require_intent'])}"
            f":competitors={int(cfg['auto_competitor_users'])}:approval={int(cfg['require_approval'])}")


def gate(scored: dict, lead: dict, gate_cfg: dict) -> tuple[str, list[str]]:
    """("AUTO" | "REVIEW" | "REJECT", reasons in plain words). Rank and fill (2026-10-30), in order:

      1. a hard-reject flag -> REJECT;
      2. score below send_score -> REJECT (the score after the risk penalty: a competitor's user or a very
         large organisation is ranked lower, never held back). A Maps-only lead or a possible duplicate too
         ("Judged from its Google Maps listing only: score X is below the send bar (Y)" for a Maps-only
         lead): nobody reviews in this funnel, so REVIEW holds only leads worth a person's look;
      3. the best contact below min_contact, or require_intent and no buying signal -> REVIEW when
         require_approval, else REJECT. Before the held flags (2026-10-31): a lead that fails the list's
         own rules must not wait in REVIEW on a list that needs no approval, where approving it sends it;
      4. maps_only or possible_duplicate -> REVIEW (validity first: a person decides);
      5. otherwise REVIEW ("waiting for your approval") when require_approval, else AUTO.

    auto_competitor_users: a list that takes organisations on a competitor's platform like any other;
    they are judged on their score without that penalty (the other risks still count).
    auto_score / review_score, the bars before rank and fill, are ignored when an old agent still has them."""
    cfg = _settings(gate_cfg)
    bar, approval, min_contact = cfg["send_score"], cfg["require_approval"], cfg["min_contact"]
    flags = list(scored.get("flags") or [])
    score = int(scored.get("score") or 0)
    switch_ok = cfg["auto_competitor_users"] and any(_flag_kind(f) == "competitor_platform" for f in flags)
    if switch_ok:  # the other risks (enterprise, micro) still count
        score = _clamp(int(scored.get("base_score") or 0)
                       - WEIGHT_RISK * max(0, int(scored.get("risk") or 0) - RISK_COMPETITOR))

    hard = [f for f in flags if _flag_kind(f) in HARD_REJECT_FLAGS]
    if hard:
        return "REJECT", [_flag_words(f) for f in hard]

    if lead.get("maps_only") and "maps_only" not in flags:  # the lead says so even if a flag list lost it
        flags.append("maps_only")
    held = [f for f in flags if _flag_kind(f) in ALWAYS_REVIEW_FLAGS]
    maps_only = any(_flag_kind(f) == "maps_only" for f in held)
    if score < bar:
        risks = [_flag_words(f) for f in flags if _flag_kind(f) in RISK_FLAGS
                 and not (switch_ok and _flag_kind(f) == "competitor_platform")]
        first = (f"Judged from its Google Maps listing only: score {score} is below the send bar ({bar})" if maps_only
                 else f"Score {score} is below the send bar ({bar})")
        return "REJECT", [first, *risks]

    level = (lead.get("contact_quality") or {}).get("level") or scored.get("reach_level") or "none"
    blockers: list[str] = []
    if CONTACT_ORDER.get(level, 0) < CONTACT_ORDER[min_contact]:
        blockers.append(f"Best contact is {level}; this list needs at least {min_contact}")
    if cfg["require_intent"] and not scored.get("has_intent"):
        blockers.append("No buying signal, and this list requires one")
    held_words = [_flag_words(f) for f in held]
    if blockers:
        return ("REVIEW", [*blockers, *held_words]) if approval else ("REJECT", blockers)
    if held:
        if maps_only:
            held_words.insert(0, f"Score {score} counts only what is known without the website: a person should decide")
        return "REVIEW", held_words
    met = [f"Score {score} meets the send bar ({bar}) with a {level} contact"]
    if switch_ok:
        met.append("Already uses a competitor's platform: this list takes them without review")
    if approval:
        return "REVIEW", ["Waiting for your approval: this list sends no lead without it", *met]
    return "AUTO", met


_FLAG_WORDS = {
    "no_contact": "No usable contact (only helplines, support inboxes or an enquiry form)",
    "site_unreadable": "The organisation's website could not be read",
    "not_target_segment": "Not the kind of organisation the brief targets",
    "wrong_site": "The pages read belong to another organisation, not this one",
    "outside_market": "Outside your markets: {detail}",
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
