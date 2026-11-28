"""Reading a Google Maps listing during research: whether a listing found by searching an
organisation's name is that organisation's, and which city its address is in.

The Maps lane hands research the listing it found the organisation by. For an organisation found
another way, research may look its name up on Maps once (lead_agent.contact_hunt, effort levels
STANDARD and DEEP) and must not take a same-name business for it: a listing counts only when its
website is the organisation's own domain, or, with no website, when its name matches the
organisation's both ways and its address is in the organisation's city.
"""

from __future__ import annotations

import re
from typing import Any

from ..discovery.domains import registered_domain
from ..discovery.pipeline import mentions_place, names_match
from ..discovery.search import SearchResult

# "Maharashtra 411004": the part of an Indian address before its PIN code's part is the city, unless
# that part is the city itself ("Pune 411004").
_PIN = re.compile(r"\b\d{6}\b")
_STATES = frozenset({
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat", "haryana",
    "himachal pradesh", "jharkhand", "karnataka", "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya",
    "mizoram", "nagaland", "odisha", "orissa", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana", "tripura",
    "uttar pradesh", "uttarakhand", "west bengal", "delhi", "new delhi", "jammu and kashmir", "jammu & kashmir",
    "ladakh", "chandigarh", "puducherry", "pondicherry", "andaman and nicobar islands", "lakshadweep",
    "dadra and nagar haveli and daman and diu",
})
# " - Best JEE Coaching in Indore", " | Admissions open": what follows a listing's name.
_NAME_TAIL = re.compile(r"\s+[|\-–—:]\s+|\s*\|\s*")


def maps_query(organisation: str, city: str | None) -> str:
    """'<organisation name> <city>': one Maps search per lead."""
    return " ".join(f"{organisation} {(city or '').split(',')[0]}".split())


def _as_result(title: str) -> SearchResult:
    return SearchResult(query="", rank=0, title=title or "", url="", snippet="")


def in_city(address: str | None, city: str | None) -> bool:
    """The address names the city (or its other name: Gurgaon / Gurugram) as whole words."""
    place = (city or "").split(",")[0].strip()
    return bool(place and address) and mentions_place(place, _as_result(address or ""))


def same_name(listing_title: str, organisation: str, city: str | None = None) -> bool:
    """The listing's name and the organisation's carry each other's distinctive words (the city's words
    left to the place check): "WiNNERS Institute - JEE Coaching" is WiNNERS Institute, "Excel Academy
    of Dance" is not Excel Academy. A name of only generic words ("Coaching Academy") never matches."""
    places = [(city or "").split(",")[0].strip()] if city else []
    head = _NAME_TAIL.split(listing_title or "")[0]
    return (names_match(organisation, _as_result(listing_title), places)
            and names_match(head, _as_result(organisation), places))


def listing_is_theirs(listing: dict[str, Any], *, organisation: str, domain: str | None, city: str | None) -> bool:
    """Whether a Maps listing is this organisation's: its website on the organisation's own domain;
    or, when it shows no website, the same name both ways (same_name) and an address in the
    organisation's city. A listing whose website is another domain is another business's."""
    website = (listing.get("website") or "").strip()
    if website:
        return bool(domain) and registered_domain(website) == domain
    return same_name(listing.get("title") or "", organisation, city) and in_city(listing.get("address"), city)


def pick_listing(places: list[dict[str, Any]], *, organisation: str, domain: str | None,
                 city: str | None) -> dict[str, Any] | None:
    """The first listing of a Maps search that is this organisation's (listing_is_theirs), else None."""
    return next((p for p in places or [] if isinstance(p, dict)
                 and listing_is_theirs(p, organisation=organisation, domain=domain, city=city)), None)


def listing_city(address: str | None, known: str | None = None) -> str | None:
    """The city of a listing's address: the known city (where discovery searched) when the address names
    it, else the part before the state and PIN code ("..., Noida, Uttar Pradesh 201303, India" -> Noida),
    else the known city."""
    known_city = (known or "").split(",")[0].strip() or None
    if not address:
        return known_city
    if known_city and in_city(address, known_city):
        return known_city
    parts = [p.strip() for p in address.split(",") if p.strip()]
    for index in range(len(parts) - 1, -1, -1):
        if not _PIN.search(parts[index]):
            continue
        here = " ".join(_PIN.sub(" ", parts[index]).split())
        if here and here.lower() not in _STATES:
            return here  # "Pune 411004"
        if index > 0:
            return " ".join(re.sub(r"\d+", " ", parts[index - 1]).split()) or known_city
    return known_city


__all__ = ["maps_query", "in_city", "same_name", "listing_is_theirs", "pick_listing", "listing_city"]
