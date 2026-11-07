"""Places the Maps lane searches when an agent's market is a whole country.

A Maps search for "coaching institute India" returns a handful of national brands; the
same search city by city returns the local organisations the agent is for. A whole-country
market of a country listed here is searched through its major cities (in this order); any
other market is searched as before: its city, else its state, else its country.
"""
from __future__ import annotations

from typing import Any, Dict, List, Sequence

MAJOR_CITIES: Dict[str, tuple] = {
    "india": (
        "Delhi", "Mumbai", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur",
        "Lucknow", "Kota", "Patna", "Indore", "Bhopal", "Chandigarh", "Nagpur", "Surat", "Vadodara", "Kanpur",
        "Varanasi", "Prayagraj", "Ranchi", "Bhubaneswar", "Guwahati", "Dehradun", "Noida", "Gurugram",
        "Ghaziabad", "Ludhiana", "Amritsar", "Jodhpur", "Udaipur", "Raipur", "Visakhapatnam", "Vijayawada",
        "Coimbatore", "Kochi", "Thiruvananthapuram", "Madurai", "Mysuru", "Mangaluru", "Nashik", "Aurangabad",
        "Rajkot", "Agra", "Meerut", "Gwalior", "Jabalpur", "Siliguri", "Jammu",
    ),
}


def _whole_countries(markets: Sequence[Any]) -> set:
    return {str(m.get("country")).strip().lower() for m in markets or []
            if isinstance(m, dict) and m.get("country") and not m.get("state") and not m.get("city")}


def maps_places(markets: Sequence[Any], places: List[str]) -> List[str]:
    """The plan's places, each whole-country market's country replaced by its major cities."""
    whole = _whole_countries(markets)
    out: List[str] = []
    for place in places or []:
        key = (place or "").strip().lower()
        out.extend(MAJOR_CITIES.get(key, (place,)) if key in whole else (place,))
    return list(dict.fromkeys(out))


__all__ = ["MAJOR_CITIES", "maps_places"]
