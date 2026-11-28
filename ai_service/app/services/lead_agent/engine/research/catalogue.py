"""Buying signals and the fixed rules that turn them into product scores.

This is the EDUCATION catalogue used for Vacademy's own products (briefs with product keys only);
an agent with an offer uses the universal signals here plus its own (engine/offer.py).
It is a STARTER catalogue drawn from the spec's examples. The product team should replace
the descriptions and weights with Vacademy's approved feature catalogue (spec section 01).
Platform port: these product scores are one input of scoring.score_lead (reported as `products`);
the delivery decision is scoring.gate, not these numbers.
Scores are computed here, never by the model: the model only reports which signals a page
shows, with a quote, and unverifiable signals are dropped before scoring.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..schemas import PRODUCT_NAMES


@dataclass(frozen=True)
class SignalType:
    label: str
    description: str  # sent to the model so it knows what counts
    direct: bool = False  # an explicit request for a solution, vs an indirect hint


SIGNALS: dict[str, SignalType] = {
    "explicit_software_need": SignalType(
        "Looking for software",
        "The organisation says it is looking for or evaluating software, an app, an LMS or a CRM, or has published a "
        "tender, RFP or requirement for one.",
        True,
    ),
    "admissions_open": SignalType("Admissions open", "Admissions, enrolment or a new batch is currently open or starting soon."),
    "enquiry_forms": SignalType("Enquiry forms", "The site collects enquiries: enquiry, callback, counselling or demo-class forms."),
    "high_call_volume": SignalType(
        "Phone-led enquiries", "The site pushes prospects to call or WhatsApp: several numbers, call-now buttons or helplines."
    ),
    # Hiring counts only for the roles a run is looking for (its hiring_roles, which come from the
    # product analysis, the person's choice or the request); other hiring is kept but never scored.
    # direct=True marks a buying signal (action now); the rest are fit signals.
    "hiring": SignalType("Hiring", "Hiring for one of the roles this search is about.", True),
    "hiring_other": SignalType("Hiring (other roles)", "Hiring for roles this search is not about; does not count."),
    # Found by keyword search only: the organisation's own post or page uses one of the run's need
    # phrases ("looking for LMS", "learning software") about itself. Weaker than an explicit request.
    "keyword_need": SignalType(
        "Keyword match", "The organisation's own post or page uses one of the search keywords about its own needs or work."
    ),
    "hiring_faculty": SignalType("Hiring faculty", "Hiring teachers, faculty or academic staff."),
    "multiple_branches": SignalType("Multiple branches", "Operates more than one centre, branch or campus."),
    "new_centre": SignalType("New centre", "Opening or recently opened a new centre, branch, office or location.", True),
    "online_courses": SignalType("Online courses", "Offers online, hybrid or recorded classes, or courses through an app."),
    "test_series": SignalType("Test series", "Offers online tests, mock tests or a test series."),
    "large_scale": SignalType("Large student base", "States a large number of students, batches or results."),
    "own_app_or_portal": SignalType("Has app/portal", "Already has its own student app, portal or LMS (a competitor or upgrade opportunity)."),
}

# Points per signal, per product. Scores saturate at SATURATION points (= 100).
# "hiring" is hiring for the roles the run is looking for, so it counts for every product.
WEIGHTS: dict[str, dict[str, int]] = {
    "crm": {"explicit_software_need": 4, "hiring": 3, "keyword_need": 2, "admissions_open": 2, "enquiry_forms": 2,
            "high_call_volume": 1,
            "multiple_branches": 2, "new_centre": 1, "large_scale": 1},
    # Hiring callers is the clearest sign of calling volume an AI caller can absorb.
    "ai_calling": {"explicit_software_need": 4, "hiring": 4, "keyword_need": 2, "high_call_volume": 2, "admissions_open": 2,
                   "enquiry_forms": 1, "multiple_branches": 1, "large_scale": 1},
    "lms": {"explicit_software_need": 4, "online_courses": 3, "hiring": 3, "keyword_need": 2, "test_series": 2,
            "multiple_branches": 1,
            "hiring_faculty": 1, "large_scale": 1, "new_centre": 1, "own_app_or_portal": 1},
    # Complete Vacademy (LMS + CRM + AI calling in one): v1, TO BE TUNED WITH SALES (2026-10-25 review).
    # The engine's weights gave a typical coaching site 12 points out of 100 for the product Vacademy
    # sells most. A coaching institute that runs online courses or test series and takes admissions
    # enquiries needs the whole suite, so those fit signals carry real weight here; buying signals
    # (hiring for the run's roles, an explicit request) still weigh most. Saturates at 12 points
    # instead of 8 because it has more signals to collect: online courses + test series + admissions
    # + enquiry form = 9 points = 75; admissions + enquiry form alone = 33.
    "complete_vacademy": {"explicit_software_need": 4, "hiring": 3, "online_courses": 3, "keyword_need": 2,
                          "test_series": 2, "admissions_open": 2, "enquiry_forms": 2, "multiple_branches": 2,
                          "new_centre": 2, "high_call_volume": 1, "large_scale": 1, "own_app_or_portal": 1,
                          "hiring_faculty": 1},
    # Tutezy: no approved rules yet, so it is reported as not assessed rather than guessed.
}
SATURATION = 8
# Products whose score saturates at a different number of points (v1, to be tuned with sales).
SATURATION_BY_PRODUCT: dict[str, int] = {"complete_vacademy": 12}

# Hiring keys a saved lead may hold: the current two and those used before roles came from the run.
HIRING_SIGNALS = ("hiring", "hiring_other", "hiring_counsellors", "hiring_telecallers", "hiring_sales")

# Starting suggestions only, for runs that name no roles (requests from before hiring roles existed).
# The guided form fills roles from the product analysis and the person can change them.
SUGGESTED_ROLES = {
    "ai_calling": ["telecaller"],
    "crm": ["sales executive"],
    "lms": ["admission counsellor"],
    "complete_vacademy": ["telecaller", "sales executive", "admission counsellor"],
}

# Words that do not tell roles apart ("sales executive" and "sales manager" are both sales roles).
_ROLE_FILLER = frozenset({
    "a", "an", "and", "the", "for", "of", "in", "at", "with", "hiring", "hire", "job", "jobs", "vacancy", "vacancies",
    "required", "requirement", "wanted", "urgent", "urgently", "opening", "openings", "post", "position", "role",
    "executive", "officer", "manager", "associate", "staff", "specialist", "assistant", "intern", "trainee",
    "senior", "junior", "head", "lead", "fresher", "freshers", "female", "male", "candidate", "candidates",
})


def _role_words(text: str) -> list[str]:
    t = text.lower()
    t = re.sub(r"tele[\s-]*call\w*", "telecaller", t)
    t = re.sub(r"tele[\s-]*sales", "telesales", t)
    t = re.sub(r"counsel\w*", "counsellor", t)
    words = re.findall(r"[a-z]+", t)
    return [w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w for w in words]


def role_from_phrase(phrase: str) -> str:
    """'hiring telecaller' -> 'telecaller'; 'admission counsellor vacancy' -> 'admission counsellor'."""
    text = re.split(r"\s+(?:for|in|at|with)\s+", phrase.strip(), maxsplit=1)[0]
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z&/-]*", text)
             if w.lower() not in {"hiring", "hire", "job", "jobs", "vacancy", "vacancies", "required", "wanted", "urgent", "urgently"}]
    return " ".join(words)[:60]


def matching_role(roles: list[str], *texts: str | None) -> str | None:
    """The run's role that a job post is for: the role's main word (its last distinctive word, e.g.
    'counsellor' in 'admission counsellor') must appear in the job title, or failing that the quote."""
    keyed = [(role, [w for w in _role_words(role) if w not in _ROLE_FILLER]) for role in roles]
    for text in texts:
        words = set(_role_words(text or ""))
        for role, terms in keyed:
            if terms and terms[-1] in words:
                return role
    return None


def suggested_roles(products: list[str]) -> list[str]:
    return list(dict.fromkeys(role for p in products for role in SUGGESTED_ROLES.get(p, [])))


def matching_keyword(keywords: list[str], text: str | None) -> str | None:
    """The run keyword whose distinctive words all appear in the text ('looking for LMS' needs 'lms')."""
    words = set(_role_words(text or ""))
    for keyword in keywords:
        terms = [w for w in _role_words(keyword) if len(w) > 2 and w not in _KEYWORD_FILLER]
        if terms and all(t in words for t in terms):
            return keyword
    return None


# Intent words carry the meaning of a need phrase but are too common to require in a quote.
_KEYWORD_FILLER = frozenset({"looking", "for", "need", "needs", "want", "wanted", "require", "required", "best",
                             "the", "and", "with", "our", "your", "software", "tool", "app", "platform", "system"})


def keyword_label(keyword: str) -> str:
    return f'Mentions "{keyword}"'


def hiring_label(role: str | None) -> str:
    return f"Hiring {role}" if role else SIGNALS["hiring_other"].label


def relevant_signals(products: list[str]) -> set[str]:
    """Signals that count towards at least one of the products (all of them if none has rules)."""
    keys = {key for product in products for key, weight in WEIGHTS.get(product, {}).items() if weight > 0}
    return keys or set(SIGNALS)


# The model sometimes records a signal while saying it is absent ("No statement found...").
_ABSENCE = re.compile(
    r"^\s*(no|none|not|nothing)\b|\b(not (found|mentioned|stated|shown|visible)|no (evidence|statement|mention|indication))\b",
    re.IGNORECASE,
)
# "Looking for software" needs the quote itself to show intent to acquire and a software term;
# promoting their own app or test series is a different signal.
_INTENT = re.compile(
    r"\b(looking for|seeking|searching for|need(s|ed)?|require(s|d)?|requirement|evaluat\w*|want(s|ed)? to (buy|adopt|implement)|"
    r"invit\w* (proposals|quotations|vendors)|rfp|tender|vendor)\b",
    re.IGNORECASE,
)
_SOFTWARE = re.compile(r"\b(software|app|application|platform|lms|crm|erp|system|portal|tool|solution)\b", re.IGNORECASE)


def signal_holds(key: str, observation: str, quote: str, offer=None) -> bool:
    """Fixed checks on a quoted signal before it may count towards a score. offer (engine/offer.py)
    says what an explicit request must name; without one, a software word."""
    if _ABSENCE.search(observation or ""):
        return False
    if key == "explicit_software_need":
        return bool(_INTENT.search(quote)) and (offer.need_holds(quote) if offer else bool(_SOFTWARE.search(quote)))
    return True


@dataclass(frozen=True)
class ProductScore:
    key: str
    name: str
    score: int | None  # None = not assessed (no rules configured)
    matched: list[str]

    @property
    def why(self) -> str:
        if self.score is None:
            return "Not assessed: no approved scoring rules for this product yet."
        return "; ".join(self.matched) if self.matched else "No supporting signals found on the website."


def score_products(products: list[str], signal_keys: set[str]) -> list[ProductScore]:
    scores = []
    for key in products:
        weights = WEIGHTS.get(key)
        if not weights:
            scores.append(ProductScore(key, PRODUCT_NAMES.get(key, key), None, []))
            continue
        hits = sorted((k for k in signal_keys if k in weights), key=lambda k: -weights[k])
        points = sum(weights[k] for k in hits)
        saturation = SATURATION_BY_PRODUCT.get(key, SATURATION)
        scores.append(ProductScore(
            key, PRODUCT_NAMES.get(key, key), min(100, round(points * 100 / saturation)), [SIGNALS[k].label for k in hits]
        ))
    return sorted(scores, key=lambda s: -1 if s.score is None else s.score, reverse=True)
