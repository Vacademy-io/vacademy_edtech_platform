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


# Beyond MAJOR_CITIES, roughly by size: the search frontier (frontier.py) opens them FRONTIER_RING at a time
# once an agent's first lists run thin. Tier-2 and tier-3 towns hold most of the local organisations a
# whole-country search never reaches (2026-11-17: Telleo, Voomsales and "Leads for Vacademy" had searched every
# major city to the last results page and found a few new organisations a day).
MORE_CITIES: Dict[str, tuple] = {
    "india": (
        # ring 1
        "Faridabad", "Thane", "Navi Mumbai", "Pimpri-Chinchwad", "Howrah", "Srinagar", "Guntur", "Warangal",
        "Solapur", "Hubballi", "Bareilly", "Moradabad", "Aligarh", "Jalandhar", "Tiruchirappalli", "Salem",
        "Tiruppur", "Gorakhpur", "Saharanpur", "Bikaner", "Amravati", "Jamshedpur", "Bhilai", "Cuttack",
        "Bhavnagar", "Dhanbad", "Durgapur", "Asansol", "Nanded", "Kolhapur", "Ajmer", "Kalaburagi", "Jamnagar",
        "Ujjain", "Jhansi", "Nellore", "Belagavi", "Tirunelveli", "Gaya", "Jalgaon", "Davanagere", "Kozhikode",
        "Akola", "Kurnool", "Bokaro", "Rajahmundry", "Ballari", "Agartala", "Bhagalpur", "Patiala",
        # ring 2
        "Latur", "Dhule", "Korba", "Bhilwara", "Berhampur", "Muzaffarpur", "Ahmednagar", "Mathura", "Kollam",
        "Kadapa", "Bilaspur", "Shahjahanpur", "Vijayapura", "Rampur", "Shivamogga", "Chandrapur", "Junagadh",
        "Thrissur", "Alwar", "Bardhaman", "Kakinada", "Nizamabad", "Parbhani", "Tumakuru", "Khammam", "Panipat",
        "Darbhanga", "Aizawl", "Dewas", "Karnal", "Bathinda", "Jalna", "Eluru", "Purnia", "Satna", "Sonipat",
        "Sagar", "Rourkela", "Durg", "Imphal", "Ratlam", "Arrah", "Anantapur", "Karimnagar", "Bharatpur",
        "Begusarai", "Puducherry", "Sikar", "Thoothukudi", "Rewa",
        # ring 3
        "Mirzapur", "Raichur", "Haridwar", "Vizianagaram", "Nagercoil", "Sri Ganganagar", "Thanjavur", "Katni",
        "Nadiad", "Yamunanagar", "Bidar", "Panchkula", "Kharagpur", "Dindigul", "Gandhinagar", "Hosapete",
        "Ongole", "Deoghar", "Chhapra", "Khandwa", "Anand", "Bhiwani", "Ambala", "Morbi", "Chittoor", "Vellore",
        "Mehsana", "Hisar", "Rohtak", "Tirupati", "Kottayam", "Shillong", "Pathankot", "Hoshiarpur", "Mohali",
        "Haldwani", "Roorkee", "Rudrapur", "Erode", "Hosur", "Sangli", "Satara", "Udupi", "Hassan", "Kannur",
        "Palakkad", "Malappuram", "Panaji", "Bharuch", "Vapi",
        # ring 4
        "Navsari", "Valsad", "Silchar", "Dibrugarh", "Jorhat", "Sambalpur", "Balasore", "Chhindwara", "Vidisha",
        "Ayodhya", "Azamgarh", "Jaunpur", "Ballia", "Basti", "Sitapur", "Muzaffarnagar", "Bijnor", "Badaun",
        "Hazaribagh", "Hajipur", "Motihari", "Sasaram", "Ratnagiri", "Wardha", "Yavatmal", "Beed", "Baramati",
        "Mandya", "Alappuzha", "Kasaragod", "Mahbubnagar", "Nalgonda", "Srikakulam", "Machilipatnam", "Hindupur",
        "Firozpur", "Kurukshetra", "Rewari", "Rishikesh", "Shimla", "Solan", "Dharamshala", "Margao",
        "Rajnandgaon", "Ambikapur", "Jagdalpur", "Krishnanagar", "Kumbakonam", "Karur", "Kanchipuram",
    ),
}
FRONTIER_RING = 50


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


def frontier_places(markets: Sequence[Any], places: List[str], ring: int) -> List[str]:
    """Ring `ring` (1, 2, ...) of the cities beyond MAJOR_CITIES for the plan's whole-country markets, FRONTIER_RING
    a ring; [] when no such market or the ring is past the list. A market named by city or state has no rings:
    the agent was asked to stay there."""
    if ring < 1:
        return []
    whole = _whole_countries(markets)
    seen = {c.lower() for c in maps_places(markets, places)}
    out: List[str] = []
    for place in places or []:
        key = (place or "").strip().lower()
        if key not in whole:
            continue
        more = [c for c in MORE_CITIES.get(key, ()) if c.lower() not in seen]
        out.extend(more[(ring - 1) * FRONTIER_RING: ring * FRONTIER_RING])
    return list(dict.fromkeys(out))


__all__ = ["MAJOR_CITIES", "MORE_CITIES", "FRONTIER_RING", "maps_places", "frontier_places"]
