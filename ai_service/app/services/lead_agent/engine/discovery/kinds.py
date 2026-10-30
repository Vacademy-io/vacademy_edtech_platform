"""Kinds of organisation a Google Maps category clearly shows, for the Maps lane's free pre-check.

A listing whose category belongs to a kind the brief does not target at all ("Furniture store" for a
garment brief, "Physiotherapist" or "Bank" for coaching institutes) is skipped before its website is
fetched and researched. Prod, 5 agents, 2026-10-30: 81 of 1,660 Maps leads were rejected as "Not the
kind of organisation the brief targets", each after a page fetch and an AI extraction.

Conservative on purpose. The research fit check already rejects some organisations the brief does
target (Delhi University colleges for "Colleges and universities", EuroKids and Kidzee for "K-12
schools and playschools", a financial-markets training institute for "Coaching institutes and
edtech"; 2026-10-30 audit), and this check must not copy that. A listing is KEPT when:
  * its category is not one this table knows (most categories; "Corporate office", "Consultant");
  * its category or its name shows a kind one of the brief's industries belongs to (a "Medical
    college" is a college; "XYZ Academy" listed as a "Stock broker" may still teach);
  * any industry of the brief cannot be placed in this table, or could be any kind of business
    ("Consumer services", "E-commerce and D2C brands", "Corporate training teams": every company has
    one): nothing can then be called another kind.
The caller checks first that the listing does not show one of the brief's industries
(scoring.maps_kind), and keeps it when it does.
"""

from __future__ import annotations

import re
from typing import Any

# Kind -> words (regular expressions, whole words, any case) of Google Maps categories and industry
# names. Role words ("store", "shop", "company", "manufacturer", "dealer", "agency", "service",
# "centre") are left out: "Furniture store" is furniture, "Garment manufacturer" is clothing.
KINDS: dict[str, tuple[str, ...]] = {
    "education": (
        r"educat\w*", r"schools?", r"colleges?", r"universit(?:y|ies)", r"academ(?:y|ies|ic)", r"coaching",
        r"tutors?", r"tutoring", r"tutorials?", r"tuitions?", r"training", r"trainers?", r"learning", r"e-?learning",
        r"ed-?tech", r"pre-?schools?", r"play-?\s?schools?", r"kindergartens?", r"montessori", r"creches?",
        r"classes", r"courses?", r"test[\s-]?prep\w*", r"exams?", r"examinations?", r"assessments?", r"k-?12",
        r"institutes?", r"institutions?", r"study", r"students?"),
    "health": (
        r"hospitals?", r"clinics?", r"doctors?", r"dentists?", r"dental", r"physiotherap\w*", r"pharmac(?:y|ies|ists?)",
        r"chemists?", r"diagnostics?", r"pathology", r"nursing\s+homes?", r"health\s?care", r"health", r"medical",
        r"ayurved\w*", r"homeopath\w*", r"opticians?", r"eye\s+care", r"surgeons?", r"p(?:a)?ediatricians?",
        r"gyn(?:a)?ecologists?", r"orthop(?:a)?edic\w*", r"cardiologists?", r"dermatologists?", r"psychiatrists?",
        r"therapists?", r"veterinar\w*"),
    "finance": (
        r"banks?", r"banking", r"atms?", r"financ\w*", r"loans?", r"lend\w*", r"nbfcs?", r"bfsi", r"insurance",
        r"invest\w*", r"stock\s?brokers?", r"mutual\s+funds?", r"micro-?finance", r"credit", r"accountants?",
        r"accounting", r"tax", r"wealth"),
    "real_estate": (
        r"real[\s-]?estate", r"propert(?:y|ies)", r"realtors?", r"realty", r"builders?", r"construction",
        r"housing", r"apartments?", r"condominiums?", r"estate\s+agents?"),
    "automotive": (
        r"cars?", r"automobiles?", r"automotive", r"auto", r"motor\w*", r"vehicles?", r"tyres?", r"tires?",
        r"two[\s-]?wheelers?", r"bikes?", r"motorcycles?", r"scooters?", r"trucks?", r"tractors?", r"dealerships?"),
    "food": (
        r"restaurants?", r"caf[eé]s?", r"coffee", r"bakery", r"bakeries", r"sweets?", r"caterers?", r"catering",
        r"food", r"pizza\w*", r"dhabas?", r"bars?", r"pubs?", r"juice", r"ice\s+cream", r"tea", r"canteens?",
        r"tiffin", r"biryani"),
    "lodging_travel": (
        r"hotels?", r"resorts?", r"lodges?", r"lodging", r"guest\s?houses?", r"homestays?", r"hostels?", r"inns?",
        r"motels?", r"travel\w*", r"tours?", r"tourist", r"holidays?", r"airlines?"),
    "beauty": (
        r"beauty", r"salons?", r"spas?", r"parlou?rs?", r"barbers?", r"hair\w*", r"make-?up", r"cosmetic\w*",
        r"nails?", r"tattoo\w*"),
    "fitness": (r"gyms?", r"gymnasium", r"fitness", r"yoga", r"crossfit", r"health\s+club", r"zumba", r"aerobics",
                r"pilates"),
    "apparel_textile": (
        r"cloth\w*", r"garments?", r"apparels?", r"fashion\w*", r"textiles?", r"fabrics?", r"tailor\w*",
        r"boutiques?", r"sarees?", r"saris?", r"hosiery", r"knit\w*", r"uniforms?", r"workwear", r"embroider\w*",
        r"handlooms?", r"weav\w*", r"linen", r"denim", r"yarns?", r"furnishings?", r"dyeing", r"stitch\w*",
        r"lingerie", r"kurtis?", r"(?:sports|mens|womens|kids|ethnic\s|inner|night)wear"),
    "furniture_interiors": (r"furniture", r"interiors?", r"interior\s+design\w*", r"decor\w*", r"mattress\w*",
                            r"modular\s+kitchens?", r"carpenters?", r"sofas?"),
    "retail": (
        r"supermarkets?", r"hypermarkets?", r"department\s+stores?", r"grocer\w*", r"kirana", r"general\s+stores?",
        r"convenience\s+stores?", r"shopping\s+malls?", r"malls?", r"variety\s+stores?", r"gift\s+shops?",
        r"book\s?stores?", r"book\s?shops?", r"stationery", r"stationers?", r"jewel\w*", r"footwear",
        r"shoe\s+stores?", r"toy\s+stores?", r"mobile\s+phone\s+(?:shops?|stores?)"),
    "software": (r"software", r"it\s+(?:company|companies|services?|solutions?)", r"information\s+technology",
                 r"app\s+develop\w*", r"computer\s+(?:consultants?|support)", r"web\s+hosting", r"saas"),
    "marketing_web": (
        r"marketing", r"advertis\w*", r"seo", r"search\s+engine\s+optimi[sz]ation", r"web\s?(?:site\s+)?design\w*",
        r"web\s+develop\w*", r"graphic\s+design\w*", r"branding", r"public\s+relations", r"social\s+media",
        r"printing", r"printers?"),
    "staffing": (r"employment\s+agenc(?:y|ies)", r"recruit\w*", r"staffing", r"placement\s+(?:agenc(?:y|ies)|consult\w*)",
                 r"manpower", r"head\s?hunt\w*"),
    "government_religion": (
        r"government", r"govt", r"municipal\w*", r"police", r"post\s+office", r"courts?", r"courthouse",
        r"temples?", r"churche?s?", r"mosques?", r"masjid", r"gurd?waras?", r"places?\s+of\s+worship", r"religious"),
    "logistics": (r"logistics", r"couriers?", r"transport\w*", r"freight", r"cargo", r"warehous\w*",
                  r"packers?", r"movers?"),
    "legal": (r"lawyers?", r"advocates?", r"attorneys?", r"law\s+firms?", r"legal", r"notary"),
}
_KIND_RES = {kind: re.compile(r"\b(?:" + "|".join(words) + r")\b", re.I) for kind, words in KINDS.items()}

# Industries that can be any kind of business: a garment maker, a hospital or a bank can be a "D2C
# brand", a "consumer service" or have a "corporate training team".
_BROAD = re.compile(
    r"\b(?:consumers?|d2c|dtc|direct[\s-]to[\s-]consumer|e-?commerce|online\s+sellers?|smes?|msmes?|start-?ups?|"
    r"businesses|enterprises|corporates?|corporations?|employers?|any|all)\b", re.I)
# An education industry run online ("Online academies", "Edtech platforms") is often listed on Google
# Maps as a "Software company".
_ONLINE = re.compile(r"\b(?:ed-?tech|online|e-?learning|platforms?|apps?|digital|software|virtual)\b", re.I)


def kinds_of(text: str | None) -> set[str]:
    """The kinds in this table that a category, name or industry shows ('Medical college' -> health and
    education); empty when it shows none."""
    if not text:
        return set()
    return {kind for kind, pattern in _KIND_RES.items() if pattern.search(text)}


def brief_kinds(industries: list[dict[str, Any]] | None) -> set[str] | None:
    """The kinds the brief's industries belong to, or None when one of them cannot be placed (no kind
    in the table, or one that can be any business): then no listing can be called another kind."""
    out: set[str] = set()
    for industry in industries or []:
        text = f"{industry.get('name') or ''} {industry.get('search_term') or ''}".strip()
        found = kinds_of(text)
        if not text or not found or _BROAD.search(text):
            return None
        if "education" in found and _ONLINE.search(text):
            found.add("software")
        out |= found
    return out or None


def other_kind(category: str | None, name: str | None, industries: list[dict[str, Any]] | None) -> str | None:
    """The kind a Google Maps listing clearly is when the brief targets nothing of that kind (e.g.
    "furniture_interiors" for a "Furniture store" on a garment brief), else None (keep the listing).

    None when: the category is not in the table, the brief's kinds cannot all be placed (brief_kinds),
    or the category or the listing's name shows a kind the brief targets."""
    shown = kinds_of(category)
    if not shown:
        return None
    wanted = brief_kinds(industries)
    if wanted is None or shown & wanted or kinds_of(name) & wanted:
        return None
    return sorted(shown)[0]


__all__ = ["KINDS", "kinds_of", "brief_kinds", "other_kind"]
