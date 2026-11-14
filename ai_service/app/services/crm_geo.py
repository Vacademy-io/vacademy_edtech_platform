"""
Where a lead or a payer is: an Indian state (and a city when it is a known one),
worked out from what the platform holds about them — a PIN code, a state /
region, a city — on the learner profile (``student``) or in their lead-form
answers.

Those values are typed by people, so the same place arrives as "pune", "Pune ",
"Nashik Maharashtra" or "Ahmdnagar". ``resolve`` turns one (pin, region, city)
triple into ``(state, city)``: the PIN's postal circle first, then a state named
in the region or city text, then a known city (exact, by alias, or by a close
spelling). Reports group by the resolved names, so every spelling of a place
lands in one row; values it cannot place stay unknown.

SQL side: ``person_location_sql`` gives the raw (pin, region, city) of a person
as three columns. Reports read the institute's distinct region / city texts first
(``text_values_sql``), resolve them here and bind the answers back
(``bind_texts``); ``location_sql`` then applies the same order as ``resolve``
inside the report's statement, so grouping stays in one query.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field as dc_field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# ── states and union territories ─────────────────────────────────────────

STATES: Tuple[str, ...] = (
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
)

#: Other names and abbreviations people write for a state (keys are normalised: lower case, single spaces).
_STATE_ALIASES: Dict[str, str] = {
    "ap": "Andhra Pradesh", "andhra": "Andhra Pradesh",
    "arunachal": "Arunachal Pradesh",
    "chattisgarh": "Chhattisgarh", "chhatisgarh": "Chhattisgarh", "chattisgad": "Chhattisgarh", "cg": "Chhattisgarh",
    "gj": "Gujarat", "gujrat": "Gujarat",
    "hr": "Haryana", "hp": "Himachal Pradesh", "himachal": "Himachal Pradesh",
    "jh": "Jharkhand", "ka": "Karnataka", "karnatka": "Karnataka", "kl": "Kerala", "keral": "Kerala",
    "mp": "Madhya Pradesh", "m p": "Madhya Pradesh", "madhyapradesh": "Madhya Pradesh",
    "mh": "Maharashtra", "maharastra": "Maharashtra", "maharashtr": "Maharashtra", "maharashra": "Maharashtra",
    "maharshtra": "Maharashtra", "maha": "Maharashtra",
    "orissa": "Odisha", "od": "Odisha", "pb": "Punjab", "rj": "Rajasthan", "rajastan": "Rajasthan",
    "tn": "Tamil Nadu", "tamilnadu": "Tamil Nadu", "tamil nadu": "Tamil Nadu",
    "ts": "Telangana", "tg": "Telangana", "telengana": "Telangana",
    "up": "Uttar Pradesh", "u p": "Uttar Pradesh", "uttarpradesh": "Uttar Pradesh",
    "uk": "Uttarakhand", "uttaranchal": "Uttarakhand", "uttrakhand": "Uttarakhand",
    "wb": "West Bengal", "westbengal": "West Bengal", "bengal": "West Bengal",
    "andaman": "Andaman and Nicobar Islands", "andaman and nicobar": "Andaman and Nicobar Islands",
    "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "daman and diu": "Dadra and Nagar Haveli and Daman and Diu", "daman": "Dadra and Nagar Haveli and Daman and Diu",
    "dl": "Delhi", "new delhi": "Delhi", "nct of delhi": "Delhi", "ncr": "Delhi",
    "j&k": "Jammu and Kashmir", "jk": "Jammu and Kashmir", "jammu": "Jammu and Kashmir",
    "jammu & kashmir": "Jammu and Kashmir", "kashmir": "Jammu and Kashmir",
    "pondicherry": "Puducherry", "pondy": "Puducherry",
}

# ── PIN codes ────────────────────────────────────────────────────────────

#: The postal circle of a PIN's first two digits.
_PIN2: Dict[str, str] = {}
for _p, _s in (
    ("11", "Delhi"), ("12", "Haryana"), ("13", "Haryana"), ("14", "Punjab"), ("15", "Punjab"), ("16", "Punjab"),
    ("17", "Himachal Pradesh"), ("18", "Jammu and Kashmir"), ("19", "Jammu and Kashmir"),
    ("20", "Uttar Pradesh"), ("21", "Uttar Pradesh"), ("22", "Uttar Pradesh"), ("23", "Uttar Pradesh"),
    ("24", "Uttar Pradesh"), ("25", "Uttar Pradesh"), ("26", "Uttar Pradesh"), ("27", "Uttar Pradesh"),
    ("28", "Uttar Pradesh"), ("30", "Rajasthan"), ("31", "Rajasthan"), ("32", "Rajasthan"), ("33", "Rajasthan"),
    ("34", "Rajasthan"), ("36", "Gujarat"), ("37", "Gujarat"), ("38", "Gujarat"), ("39", "Gujarat"),
    ("40", "Maharashtra"), ("41", "Maharashtra"), ("42", "Maharashtra"), ("43", "Maharashtra"), ("44", "Maharashtra"),
    ("45", "Madhya Pradesh"), ("46", "Madhya Pradesh"), ("47", "Madhya Pradesh"), ("48", "Madhya Pradesh"),
    ("49", "Chhattisgarh"), ("50", "Telangana"), ("51", "Andhra Pradesh"), ("52", "Andhra Pradesh"),
    ("53", "Andhra Pradesh"), ("56", "Karnataka"), ("57", "Karnataka"), ("58", "Karnataka"), ("59", "Karnataka"),
    ("60", "Tamil Nadu"), ("61", "Tamil Nadu"), ("62", "Tamil Nadu"), ("63", "Tamil Nadu"), ("64", "Tamil Nadu"),
    ("67", "Kerala"), ("68", "Kerala"), ("69", "Kerala"), ("70", "West Bengal"), ("71", "West Bengal"),
    ("72", "West Bengal"), ("73", "West Bengal"), ("74", "West Bengal"), ("75", "Odisha"), ("76", "Odisha"),
    ("77", "Odisha"), ("78", "Assam"), ("80", "Bihar"), ("81", "Bihar"), ("82", "Bihar"), ("84", "Bihar"),
    ("85", "Bihar"), ("83", "Jharkhand"),
):
    _PIN2[_p] = _s

#: First three digits that belong to another state than their two-digit circle; None = shared, use the text.
_PIN3: Dict[str, Optional[str]] = {
    "160": "Chandigarh", "194": "Ladakh", "246": "Uttarakhand", "248": "Uttarakhand", "249": "Uttarakhand",
    "263": "Uttarakhand", "244": None, "247": None, "262": None, "403": "Goa", "396": None,
    "605": None, "609": None, "737": "Sikkim", "744": "Andaman and Nicobar Islands",
    "790": "Arunachal Pradesh", "791": "Arunachal Pradesh", "792": "Arunachal Pradesh", "793": "Meghalaya",
    "794": "Meghalaya", "795": "Manipur", "796": "Mizoram", "797": "Nagaland", "798": "Nagaland", "799": "Tripura",
    "814": "Jharkhand", "815": "Jharkhand", "816": "Jharkhand", "822": "Jharkhand", "825": "Jharkhand",
    "826": "Jharkhand", "827": "Jharkhand", "828": "Jharkhand", "829": "Jharkhand",
}

_PIN_RE = re.compile(r"(?<!\d)([1-8]\d{2})\s?(\d{3})(?!\d)")


def pin_state(pin: Any) -> Optional[str]:
    """The state of a six-digit Indian PIN code (spaces allowed: '411 001'); None when unknown or shared."""
    m = _PIN_RE.search(str(pin or ""))
    if not m:
        return None
    code = m.group(1) + m.group(2)
    if code[:3] in _PIN3:
        return _PIN3[code[:3]]
    return _PIN2.get(code[:2])


# ── cities ───────────────────────────────────────────────────────────────

#: Known cities and towns → state; "alias=Canonical" maps another spelling or an old name.
_CITIES_BY_STATE: Dict[str, str] = {
    "Maharashtra": (
        "Mumbai, Bombay=Mumbai, Navi Mumbai, Thane, Kalyan, Dombivli, Bhiwandi, Vasai, Virar, Mira Road, "
        "Bhayandar, Panvel, Ulhasnagar, Ambernath, Badlapur, Pune, Poona=Pune, Pimpri Chinchwad, Pimpri=Pimpri "
        "Chinchwad, Chinchwad=Pimpri Chinchwad, PCMC=Pimpri Chinchwad, Hinjewadi=Pune, Wakad=Pune, Hadapsar=Pune, "
        "Kothrud=Pune, Baner=Pune, Wagholi=Pune, Chakan, Talegaon, Lonavala, Baramati, Shirur, Daund, Junnar, Indapur, "
        "Nashik, Nasik=Nashik, Malegaon, Sinnar, Igatpuri, Ahmednagar, Ahmadnagar=Ahmednagar, "
        "Ahilyanagar=Ahmednagar, Shrirampur, Sangamner, Shirdi, Kopargaon, Rahuri, Aurangabad, "
        "Chhatrapati Sambhajinagar=Aurangabad, Sambhajinagar=Aurangabad, Jalna, Beed, Bid=Beed, Parbhani, Hingoli, "
        "Nanded, Latur, Osmanabad, Dharashiv=Osmanabad, Solapur, Sholapur=Solapur, Pandharpur, Barshi, Kolhapur, "
        "Ichalkaranji, Sangli, Miraj, Satara, Karad, Ratnagiri, Chiplun, Sindhudurg, Kudal, Sawantwadi, Alibag, "
        "Raigad, Pen, Nagpur, Wardha, Chandrapur, Gadchiroli, Bhandara, Gondia, Amravati, Akola, Washim, Buldhana, "
        "Yavatmal, Jalgaon, Bhusawal, Dhule, Nandurbar, Shahada, Palghar, Boisar, Dahanu, Udgir, Hinganghat"),
    "Gujarat": ("Ahmedabad, Amdavad=Ahmedabad, Gandhinagar, Surat, Vadodara, Baroda=Vadodara, Rajkot, Bhavnagar, "
                "Jamnagar, Junagadh, Anand, Nadiad, Bharuch, Ankleshwar, Vapi, Valsad, Navsari, Mehsana, Morbi, "
                "Gandhidham, Bhuj, Porbandar, Palanpur, Godhra, Surendranagar"),
    "Goa": "Panaji, Panjim=Panaji, Margao, Madgaon=Margao, Vasco da Gama, Vasco=Vasco da Gama, Mapusa, Ponda",
    "Karnataka": ("Bengaluru, Bangalore=Bengaluru, Mysuru, Mysore=Mysuru, Mangaluru, Mangalore=Mangaluru, Hubballi, "
                  "Hubli=Hubballi, Dharwad, Belagavi, Belgaum=Belagavi, Kalaburagi, Gulbarga=Kalaburagi, Ballari, "
                  "Bellary=Ballari, Vijayapura, Bijapur=Vijayapura, Shivamogga, Shimoga=Shivamogga, Tumakuru, "
                  "Tumkur=Tumakuru, Davanagere, Udupi, Hassan, Bidar, Raichur, Hospet"),
    "Telangana": ("Hyderabad, Secunderabad, Warangal, Karimnagar, Nizamabad, Khammam, Nalgonda, Mahbubnagar, "
                  "Adilabad, Siddipet"),
    "Andhra Pradesh": ("Visakhapatnam, Vizag=Visakhapatnam, Vijayawada, Guntur, Nellore, Kurnool, Tirupati, "
                       "Kakinada, Rajahmundry, Rajamahendravaram=Rajahmundry, Kadapa, Anantapur, Eluru, Ongole, "
                       "Amaravati, Srikakulam, Vizianagaram, Proddatur"),
    "Tamil Nadu": ("Chennai, Madras=Chennai, Coimbatore, Madurai, Tiruchirappalli, Trichy=Tiruchirappalli, Salem, "
                   "Tirunelveli, Tiruppur, Erode, Vellore, Thoothukudi, Tuticorin=Thoothukudi, Thanjavur, Dindigul, "
                   "Hosur, Nagercoil, Kanchipuram, Karur, Cuddalore"),
    "Kerala": ("Thiruvananthapuram, Trivandrum=Thiruvananthapuram, Kochi, Cochin=Kochi, Ernakulam=Kochi, Kozhikode, "
               "Calicut=Kozhikode, Thrissur, Trichur=Thrissur, Kollam, Kannur, Kottayam, Palakkad, Alappuzha, "
               "Alleppey=Alappuzha, Malappuram, Kasaragod, Pathanamthitta"),
    "Delhi": "Delhi, New Delhi=Delhi, Dwarka=Delhi, Rohini=Delhi",
    "Haryana": ("Gurugram, Gurgaon=Gurugram, Faridabad, Panipat, Ambala, Karnal, Hisar, Rohtak, Sonipat, Panchkula, "
                "Yamunanagar, Bhiwani, Sirsa, Rewari, Kurukshetra"),
    "Uttar Pradesh": ("Lucknow, Kanpur, Noida, Greater Noida, Ghaziabad, Agra, Varanasi, Banaras=Varanasi, "
                      "Prayagraj, Allahabad=Prayagraj, Meerut, Bareilly, Aligarh, Moradabad, Gorakhpur, Saharanpur, "
                      "Jhansi, Mathura, Firozabad, Ayodhya, Faizabad=Ayodhya, Muzaffarnagar, Shahjahanpur, "
                      "Rampur, Etawah, Mirzapur, Bulandshahr, Sitapur, Hapur, Azamgarh"),
    "Uttarakhand": "Dehradun, Haridwar, Rishikesh, Roorkee, Haldwani, Nainital, Rudrapur, Kashipur, Almora",
    "Punjab": ("Ludhiana, Amritsar, Jalandhar, Jullundur=Jalandhar, Patiala, Bathinda, Mohali, Hoshiarpur, Pathankot, "
               "Moga, Firozpur, Phagwara, Kapurthala, Sangrur"),
    "Chandigarh": "Chandigarh",
    "Himachal Pradesh": "Shimla, Dharamshala, Mandi, Solan, Kullu, Manali, Hamirpur, Una",
    "Jammu and Kashmir": "Srinagar, Jammu, Anantnag, Baramulla, Udhampur, Kathua",
    "Ladakh": "Leh, Kargil",
    "Rajasthan": ("Jaipur, Jodhpur, Udaipur, Kota, Ajmer, Bikaner, Alwar, Bhilwara, Sikar, Bharatpur, Pali, "
                  "Sri Ganganagar, Ganganagar=Sri Ganganagar, Chittorgarh, Tonk, Jhunjhunu, Barmer, Jaisalmer"),
    "Madhya Pradesh": ("Bhopal, Indore, Jabalpur, Gwalior, Ujjain, Sagar, Satna, Rewa, Ratlam, Dewas, Katni, "
                       "Singrauli, Burhanpur, Khandwa, Chhindwara, Vidisha, Shivpuri, Damoh, Mandsaur, Neemuch, "
                       "Shahdol, Morena, Bhind, Balaghat, Barnagar"),
    "Chhattisgarh": "Raipur, Bhilai, Durg, Bilaspur, Korba, Rajnandgaon, Raigarh, Jagdalpur, Ambikapur",
    "Bihar": ("Patna, Gaya, Bhagalpur, Muzaffarpur, Purnia, Darbhanga, Arrah, Begusarai, Katihar, Munger, Chapra, "
              "Hajipur, Sasaram, Motihari, Bettiah, Siwan, Samastipur"),
    "Jharkhand": "Ranchi, Jamshedpur, Dhanbad, Bokaro, Deoghar, Hazaribagh, Giridih, Ramgarh, Dumka",
    "West Bengal": ("Kolkata, Calcutta=Kolkata, Howrah, Durgapur, Asansol, Siliguri, Bardhaman, Burdwan=Bardhaman, "
                    "Kharagpur, Haldia, Malda, Barasat, Krishnanagar, Darjeeling, Madhyamgram, "
                    "Rajpur Sonarpur"),
    "Odisha": "Bhubaneswar, Cuttack, Rourkela, Berhampur, Brahmapur=Berhampur, Sambalpur, Puri, Balasore, Baripada",
    "Assam": "Guwahati, Gauhati=Guwahati, Silchar, Dibrugarh, Jorhat, Tezpur, Nagaon, Tinsukia",
    "Meghalaya": "Shillong", "Manipur": "Imphal", "Mizoram": "Aizawl", "Tripura": "Agartala",
    "Nagaland": "Kohima, Dimapur", "Arunachal Pradesh": "Itanagar", "Sikkim": "Gangtok",
    "Puducherry": "Puducherry, Pondicherry=Puducherry, Karaikal",
    "Andaman and Nicobar Islands": "Port Blair",
}

#: normalised city name → (canonical city, state)
CITIES: Dict[str, Tuple[str, str]] = {}
for _state, _names in _CITIES_BY_STATE.items():
    for _entry in _names.split(","):
        _alias, _, _canon = _entry.strip().partition("=")
        _canon = (_canon or _alias).strip()
        CITIES.setdefault(re.sub(r"\s+", " ", _alias.strip().lower()), (_canon, _state))
for _city in [c for c in CITIES]:  # "navimumbai", "pimprichinchwad"
    CITIES.setdefault(_city.replace(" ", ""), CITIES[_city])

#: normalised state name or alias → canonical state
STATE_NAMES: Dict[str, str] = {s.lower(): s for s in STATES}
STATE_NAMES.update({s.lower().replace(" and ", " & "): s for s in STATES})
STATE_NAMES.update(_STATE_ALIASES)

#: Short aliases ('up', 'mp', 'mh') only count when they are the whole value, never inside a city's text.
_SHORT = {k for k in STATE_NAMES if len(k.replace(" ", "")) <= 3}
_FUZZY_MIN = 5
_FUZZY_CUTOFF = 0.84
_WORD_RE = re.compile(r"[a-z&]+")
_FUZZY_CITIES = sorted(k for k in CITIES if " " not in k and len(k) >= _FUZZY_MIN)
_FUZZY_STATES = sorted(k for k in STATE_NAMES if k not in _SHORT and len(k) >= _FUZZY_MIN)


def norm(text: Any) -> str:
    """Lower case, letters / '&' and single spaces only (punctuation and digits become spaces)."""
    return " ".join(_WORD_RE.findall(str(text or "").lower()))


def _ngrams(words: Sequence[str], longest: int = 4) -> Iterable[str]:
    for n in range(min(longest, len(words)), 0, -1):
        for i in range(len(words) - n + 1):
            yield " ".join(words[i:i + n])


def _close(word: str, choices: Sequence[str]) -> Optional[str]:
    if len(word) < _FUZZY_MIN:
        return None
    hit = difflib.get_close_matches(word, choices, n=1, cutoff=_FUZZY_CUTOFF)
    return hit[0] if hit else None


def text_state(text: Any) -> Optional[str]:
    """A state named in free text ('Nashik Maharashtra', 'MH', 'Tamilnadu')."""
    t = norm(text)
    if not t:
        return None
    if t in STATE_NAMES:
        return STATE_NAMES[t]
    words = t.split()
    for gram in _ngrams(words):
        if gram in STATE_NAMES and gram not in _SHORT:
            return STATE_NAMES[gram]
    for w in words:
        hit = _close(w, _FUZZY_STATES)
        if hit:
            return STATE_NAMES[hit]
    return None


def text_city(text: Any) -> Optional[Tuple[str, str]]:
    """A known city named in free text → (canonical city, state); a close spelling counts ('Ahmdnagar')."""
    t = norm(text)
    if not t:
        return None
    if t in CITIES:
        return CITIES[t]
    words = t.split()
    for gram in _ngrams(words):
        if gram in CITIES:
            return CITIES[gram]
        squashed = gram.replace(" ", "")
        if squashed in CITIES:
            return CITIES[squashed]
    for w in words:
        hit = _close(w, _FUZZY_CITIES)
        if hit:
            return CITIES[hit]
    return None


def resolve(pin: Any = None, region: Any = None, city: Any = None) -> Tuple[Optional[str], Optional[str]]:
    """
    ``(state, city)`` for one person. State: the PIN's circle, else a state
    named in the region, else in the city text, else the state of a known city.
    City: a known city in the city text, else in the region text. Either is
    None when it cannot be placed.
    """
    known = text_city(city) or text_city(region)
    state = pin_state(pin) or pin_state(city) or text_state(region) or text_state(city)
    if state is None and known:
        state = known[1]
    town = known[0] if known and (state is None or known[1] == state) else None
    return state, town


# ── SQL ──────────────────────────────────────────────────────────────────

#: Words in a lead-form field's key or label that say what it holds.
_PIN_WORDS = frozenset({"pin", "pincode", "zip", "zipcode", "postal", "postcode"})
_REGION_WORDS = frozenset({"state", "region", "province"})
_CITY_WORDS = frozenset({"city", "district", "town", "location", "village", "taluka", "tehsil", "place"})


def field_role(key: Any, label: Any = None) -> Optional[str]:
    """'pin' | 'region' | 'city' for a lead-form field that holds part of an address; None otherwise."""
    words = set()
    for text in (key, label):
        words.update(re.split(r"[^a-z0-9]+", str(text or "").lower()))
    joined = "_".join(sorted(words))
    if words & _PIN_WORDS or "pin_code" in str(key or "").lower() or "pin code" in str(label or "").lower():
        return "pin"
    if words & _REGION_WORDS:
        return "region"
    if words & _CITY_WORDS or "city" in joined:
        return "city"
    return None


@dataclass
class FieldIds:
    """Lead-form field ids per role (several field rows can hold the same role)."""
    pin: List[str] = dc_field(default_factory=list)
    region: List[str] = dc_field(default_factory=list)
    city: List[str] = dc_field(default_factory=list)

    def any(self) -> bool:
        return bool(self.pin or self.region or self.city)


def field_ids(fields: Iterable[Tuple[str, Optional[str], Sequence[str]]]) -> FieldIds:
    """FieldIds from (field key, label, ids) triples."""
    out = FieldIds()
    for key, label, ids in fields:
        role = field_role(key, label)
        if role:
            getattr(out, role).extend(str(i) for i in ids)
    return out


def person_location_sql(alias: str, user: str, lead: Optional[str], fids: FieldIds,
                        params: Dict[str, Any]) -> Tuple[str, Dict[str, str]]:
    """
    ``(joins, {"pin": expr, "region": expr, "city": expr})``: the raw location
    of the person ``user`` (an SQL expression for a user id) — their learner
    profile's region / city / PIN, each falling back to the lead ``lead`` (an
    SQL expression for an audience_response id, or None)'s latest answer to a
    form field holding it. Columns come out trimmed, NULL when empty.
    """
    joins = (f"\nLEFT JOIN LATERAL (\n"
             f"    SELECT NULLIF(btrim(s.pin_code), '') AS pin, NULLIF(btrim(s.region), '') AS region,\n"
             f"           NULLIF(btrim(s.city), '') AS city\n"
             f"    FROM student s WHERE s.user_id = {user}\n"
             f"    ORDER BY (COALESCE(btrim(s.pin_code), '') <> '' OR COALESCE(btrim(s.city), '') <> ''\n"
             f"              OR COALESCE(btrim(s.region), '') <> '') DESC, s.updated_at DESC NULLS LAST, s.id\n"
             f"    LIMIT 1\n) {alias}s ON true")
    cols: Dict[str, str] = {}
    for role in ("pin", "region", "city"):
        ids = getattr(fids, role)
        expr = f"{alias}s.{role}"
        if lead is not None and ids:
            p = f"{alias}_{role}_ids"
            params[p] = list(ids)
            joins += (f"\nLEFT JOIN LATERAL (\n"
                      f"    SELECT btrim(fv.value) AS v FROM custom_field_values fv\n"
                      f"    WHERE fv.source_type = 'AUDIENCE_RESPONSE' AND fv.source_id = {lead}\n"
                      f"      AND fv.custom_field_id = ANY(:{p}) AND btrim(COALESCE(fv.value, '')) <> ''\n"
                      f"    ORDER BY fv.updated_at DESC NULLS LAST, fv.id LIMIT 1\n) {alias}_{role} ON true")
            expr = f"COALESCE({expr}, left({alias}_{role}.v, 120))"
        cols[role] = expr
    return joins, cols


def text_key_sql(expr: str) -> str:
    """The key a typed value is looked up by in the bound text map."""
    return f"lower(btrim(left({expr}, 120)))"


#: At most this many distinct typed values are resolved per report (the most common ones); the rest stay unknown.
MAX_TEXTS = 20000


def text_values_sql(fids: FieldIds, params: Dict[str, Any]) -> str:
    """
    The distinct region / city texts (with how often each occurs) of this
    institute's people — learner profiles of its leads and of its learners, and
    answers to its location form fields — for ``bind_texts``. Needs ``:inst``.
    """
    ids = list(fids.region) + list(fids.city)
    params["geo_text_fids"] = ids
    params["geo_max_texts"] = MAX_TEXTS
    return f"""
WITH people AS (
    SELECT ar.user_id AS uid FROM audience_response ar
    JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :inst
    WHERE ar.user_id IS NOT NULL
    UNION
    SELECT sm.user_id FROM student_session_institute_group_mapping sm WHERE sm.institute_id = :inst
), v AS (
    SELECT s.region AS t FROM student s JOIN people p ON p.uid = s.user_id
    UNION ALL
    SELECT s.city FROM student s JOIN people p ON p.uid = s.user_id
    UNION ALL
    SELECT fv.value FROM custom_field_values fv
    JOIN audience_response ar ON ar.id = fv.source_id
    JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :inst
    WHERE fv.source_type = 'AUDIENCE_RESPONSE' AND fv.custom_field_id = ANY(CAST(:geo_text_fids AS text[]))
)
SELECT {text_key_sql('v.t')} AS k, COUNT(*) AS n
FROM v WHERE btrim(COALESCE(v.t, '')) <> ''
GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT :geo_max_texts
"""


def bind_texts(texts: Iterable[Any], params: Dict[str, Any]) -> Dict[str, int]:
    """
    Resolve typed region / city values and bind them as ``:geo_k`` (the text
    key), ``:geo_ts`` (a state it names or a PIN in it), ``:geo_c`` / ``:geo_cs``
    (a known city in it and that city's state). Returns how many resolved.
    """
    ks: List[str] = []
    ts: List[Optional[str]] = []
    cs: List[Optional[str]] = []
    css: List[Optional[str]] = []
    stats = {"texts": 0, "placed": 0}
    for raw in texts:
        if raw is None:
            continue
        k = str(raw)
        stats["texts"] += 1
        state = pin_state(k) or text_state(k)
        known = text_city(k)
        if state is None and known is None:
            continue
        stats["placed"] += 1
        ks.append(k)
        ts.append(state)
        cs.append(known[0] if known else None)
        css.append(known[1] if known else None)
    params.update(geo_k=ks, geo_ts=ts, geo_c=cs, geo_cs=css)
    bind_pins(params)
    return stats


def bind_pins(params: Dict[str, Any]) -> None:
    """The PIN prefix tables as ``:geo_p3k`` / ``:geo_p3v`` / ``:geo_p2k`` / ``:geo_p2v``."""
    params.update(geo_p3k=list(_PIN3), geo_p3v=list(_PIN3.values()),
                  geo_p2k=list(_PIN2), geo_p2v=list(_PIN2.values()))


#: This institute's lead-form fields (id, key, label) — to find the ones holding a PIN, state or city.
FORM_FIELDS_SQL = """
SELECT DISTINCT cf.id, cf.field_key, cf.field_name
FROM institute_custom_fields icf
JOIN custom_fields cf ON cf.id = icf.custom_field_id
WHERE icf.institute_id = :inst AND icf.type = 'AUDIENCE_FORM'
"""


def prepare(run: Any, inst: str) -> Optional[Tuple[FieldIds, Dict[str, Any]]]:
    """
    ``(location form fields, bound maps)`` for one report: ``run(sql, params)``
    returns rows or None (a failed query). None when a query fails.
    """
    found = run(FORM_FIELDS_SQL, {"inst": inst})
    if found is None:
        return None
    fids = field_ids((str(r.get("field_key") or ""), r.get("field_name"), [r["id"]]) for r in found if r.get("id"))
    params: Dict[str, Any] = {"inst": inst}
    texts = run(text_values_sql(fids, params), params)
    if texts is None:
        return None
    bound: Dict[str, Any] = {}
    bind_texts((r.get("k") for r in texts), bound)
    return fids, bound


def location_sql(alias: str, cols: Dict[str, str]) -> Tuple[str, str, str]:
    """
    ``(joins, state expr, city expr)`` over the raw columns of
    ``person_location_sql``, using the maps ``bind_texts`` bound — the same
    order as ``resolve``: the PIN's circle, a state named in the region, in the
    city text, then the state of a known city; the city only when its state is
    the one chosen.
    """
    texts = "CAST(:geo_k AS text[]), CAST(:geo_ts AS text[]), CAST(:geo_c AS text[]), CAST(:geo_cs AS text[])"
    joins = (f"\nLEFT JOIN unnest({texts}) AS {alias}r(k, ts, c, cs) ON {alias}r.k = {text_key_sql(cols['region'])}"
             f"\nLEFT JOIN unnest({texts}) AS {alias}c(k, ts, c, cs) ON {alias}c.k = {text_key_sql(cols['city'])}"
             f"\nLEFT JOIN LATERAL (\n"
             f"    SELECT CASE WHEN d ~ '^[1-8][0-9]{{5}}$' THEN d END AS d\n"
             f"    FROM (SELECT regexp_replace(COALESCE({cols['pin']}, ''), '[^0-9]', '', 'g') AS d) z\n"
             f") {alias}d ON true"
             f"\nLEFT JOIN unnest(CAST(:geo_p3k AS text[]), CAST(:geo_p3v AS text[])) AS {alias}p3(k, v) "
             f"ON {alias}p3.k = left({alias}d.d, 3)"
             f"\nLEFT JOIN unnest(CAST(:geo_p2k AS text[]), CAST(:geo_p2v AS text[])) AS {alias}p2(k, v) "
             f"ON {alias}p2.k = left({alias}d.d, 2)"
             f"\nLEFT JOIN LATERAL (\n"
             f"    SELECT z.st, CASE WHEN {alias}c.c IS NOT NULL AND {alias}c.cs = z.st THEN {alias}c.c\n"
             f"                      WHEN {alias}r.c IS NOT NULL AND {alias}r.cs = z.st THEN {alias}r.c END AS ct\n"
             f"    FROM (SELECT COALESCE(CASE WHEN {alias}p3.k IS NOT NULL THEN {alias}p3.v ELSE {alias}p2.v END,\n"
             f"                          {alias}r.ts, {alias}c.ts, {alias}c.cs, {alias}r.cs) AS st) z\n"
             f") {alias} ON true")
    return joins, f"{alias}.st", f"{alias}.ct"


DEFINITION_STATE = ("The person's state, worked out from their learner profile (PIN code, state / region, city) and, "
                    "when the profile has none, their latest lead-form answers to a PIN / state / city field: the "
                    "PIN's postal circle first, then a state named in the text, then the state of a known city "
                    "(close spellings count). (unknown) when none of these is filled in or recognised.")
DEFINITION_CITY = ("The person's city, from the same values as state, when it is a known Indian city (other "
                   "spellings and old names are merged, e.g. Poona → Pune, Ahmadnagar → Ahmednagar); (unknown) "
                   "otherwise.")

__all__ = ["STATES", "CITIES", "STATE_NAMES", "pin_state", "text_state", "text_city", "resolve", "field_role",
           "FieldIds", "field_ids", "person_location_sql", "text_key_sql", "text_values_sql", "bind_texts",
           "bind_pins", "location_sql", "prepare", "FORM_FIELDS_SQL", "MAX_TEXTS", "DEFINITION_STATE", "DEFINITION_CITY", "norm"]
