"""The one door from the orchestration to the engine library (`engine/`).

Every engine function the orchestration uses is reached through this module, by
name, at call time. That keeps the engine (built in parallel, pure functions,
spec §3) swappable in one place, and lets tests replace any step with a fake
(`monkeypatch.setattr(engine_api, "score_lead", fake)`).

Engine modules used: schemas, config, offer, planning, profiles, discovery.{pipeline,
domains, exclusions, sources}, research.{extract, contacts, lead, contact_search,
maps_listing, social}, pagefetch, fingerprint, scoring.
"""
from __future__ import annotations

import importlib
from typing import Any, Dict, List, Optional


def _m(name: str):
    return importlib.import_module(f"{__package__}.engine.{name}")


# ---- schemas / config ------------------------------------------------------
def schema(name: str):
    """A pydantic model from engine.schemas (ResearchPlan, AccountExtraction, ...)."""
    return getattr(_m("schemas"), name)


def config():
    return _m("config").DEFAULT_CONFIG


def product_names() -> Dict[str, str]:
    return dict(_m("schemas").PRODUCT_NAMES)


# ---- offer (what the agent sells) -------------------------------------------
def resolve_offer(brief: Optional[dict]):
    """engine.offer.Offer from a brief: its own offer, or Vacademy's product keys."""
    return _m("offer").resolve_offer(brief)


def offer_dict(brief: Optional[dict]) -> dict:
    """brief["offer"] as stored, or derived from an older brief's product keys."""
    return _m("offer").offer_dict(brief)


def custom_keys() -> tuple:
    return tuple(_m("offer").CUSTOM_KEYS)


# ---- planning / profiles ---------------------------------------------------
def build_plan_prompt(request_text: str, seed_count: int, guided: dict):
    return _m("planning").build_plan_prompt(request_text, seed_count, config(), guided)


def finalise_plan(plan, guided: dict) -> dict:
    return _m("planning").finalise_plan(plan, config(), guided)


def planning_error():
    return getattr(_m("planning"), "PlanningError", ValueError)


def guided_from_brief(brief: dict, markets: List[dict], lead_count: int) -> dict:
    return _m("planning").guided_from_brief(brief, markets, lead_count)


def request_text_from_brief(brief: dict) -> str:
    return _m("planning").request_text_from_brief(brief)


def engine_sources(brief_sources: Optional[List[str]]) -> List[str]:
    return _m("planning").engine_sources(brief_sources)


def search_places(guided: dict) -> List[str]:
    return _m("planning").search_places(guided)


def match_places(guided: dict) -> Optional[List[str]]:
    return _m("planning").match_places(guided)


def guided_industries(guided: dict) -> List[dict]:
    return _m("planning").guided_industries(guided)


def leave_out(guided: dict) -> List[str]:
    return _m("planning").leave_out(guided)


def build_profile_prompt(products: List[str], brief: Optional[str], page_text: Optional[str],
                         name: Optional[str] = None, seller: Optional[str] = None):
    return _m("profiles").build_profile_prompt(products, brief, page_text, name, seller)


# ---- discovery -------------------------------------------------------------
def discover(**kwargs):
    return _m("discovery.pipeline").discover(**kwargs)


def role_from_phrase(phrase: str) -> str:
    """'hiring telecaller' -> 'telecaller' (engine.research.catalogue)."""
    return _m("research.catalogue").role_from_phrase(phrase)


def name_key(name: str) -> str:
    """An organisation name without generic words, for telling the same organisation apart."""
    return _m("discovery.pipeline")._name_key(name)


def org_key(name: str, places=()) -> str:
    """name_key without a ' - ' / ' | ' tail or the words of the organisation's own places."""
    return _m("discovery.pipeline").org_key(name, places)


def place_keys(location: Optional[str]) -> set:
    """The particular places in a location or address, one spelling each ('India', 'Remote' -> none)."""
    return _m("discovery.pipeline").place_keys(location)


def signal_queries(sources, industries, places, per_industry, hiring_roles, turn: int = 0):
    return _m("discovery.sources").signal_queries(sources, industries, places, per_industry, hiring_roles, turn)


def keyword_queries(keywords, industries, places, channels, limit, turn: int = 0):
    return _m("discovery.sources").keyword_queries(keywords, industries, places, channels, limit, turn)


def default_keyword_channels() -> List[str]:
    return list(_m("discovery.sources").DEFAULT_KEYWORD_CHANNELS)


def registered_domain(url: str) -> Optional[str]:
    return _m("discovery.domains").registered_domain(url)


def homepage(url: str) -> Optional[str]:
    return _m("discovery.domains").homepage(url)


def is_excluded(domain: Optional[str]) -> bool:
    return _m("discovery.domains").is_excluded(domain)


def left_out(text: str, phrases: Optional[List[str]]) -> Optional[str]:
    return _m("discovery.exclusions").left_out(text, phrases)


# ---- pages -----------------------------------------------------------------
def parse_page(url: str, final_url: str, html: str, status_code: Optional[int]) -> dict:
    return _m("pagefetch").parse_page(url, final_url, html, status_code)


def choose_pages(home: dict, max_pages: int = 3) -> List[tuple]:
    return _m("pagefetch").choose_pages(home, max_pages)


def contact_pages(pages: List[dict]) -> List[dict]:
    return _m("pagefetch").contact_pages(pages)


def extraction_pages(pages: List[dict]) -> list:
    return _m("pagefetch").extraction_pages(pages)


def parse_profile(reply, *, products=None, note=None, name=None) -> dict:
    return _m("profiles").parse_profile(reply, products=products, note=note, name=name)


# ---- research --------------------------------------------------------------
def page_text(id: int, url: str, page_type: str, title: str, text: str):
    return _m("research.extract").PageText(id, url, page_type, title, text)


def build_extraction_prompt(**kwargs):
    return _m("research.extract").build_extraction_prompt(**kwargs)


def extract_contacts(pages: List[dict], site_domain: Optional[str], country: Optional[str]):
    return _m("research.contacts").extract_contacts(pages, site_domain, country)


def check_mail_domains(contacts: List[dict], lookup=None) -> List[dict]:
    return _m("research.contacts").check_mail_domains(contacts, lookup)


def mail_domain_ok(domain: str, lookup=None):
    return _m("research.contacts").mail_domain_ok(domain, lookup)


def is_mobile(contact: dict, region: Optional[str]) -> bool:
    """A phone contact that is a mobile of the lead's own country (engine.research.contacts.is_mobile)."""
    return _m("research.contacts").is_mobile(contact, region)


def is_home_number(contact: dict, region: Optional[str]) -> bool:
    """A phone contact that is a number of the lead's own country (engine.research.contacts)."""
    return _m("research.contacts").is_home_number(contact, region)


def reachable(contact: dict) -> bool:
    """A rated contact outreach can use for this organisation (engine.research.contacts.reachable)."""
    return _m("research.contacts").reachable(contact)


def build_lead(**kwargs) -> dict:
    return _m("research.lead").build_lead(**kwargs)


def apply_rules(lead: dict, products, buyer_roles, hiring_roles=None) -> dict:
    return _m("research.lead").apply_rules(lead, products, buyer_roles, hiring_roles)


def run_hiring_roles(products, hiring_roles):
    return _m("research.lead").run_hiring_roles(products, hiring_roles)


def lookup_contacts(lead: dict, **kwargs) -> dict:
    return _m("research.contact_search").lookup_contacts(lead, **kwargs)


def merge_lookup(lead: dict, found: dict) -> dict:
    return _m("research.contact_search").merge_lookup(lead, found)


def lookup_results() -> int:
    return int(getattr(_m("research.contact_search"), "LOOKUP_RESULTS", 8))


def hunt_queries(organisation: str, city: Optional[str], social: bool = False) -> List[str]:
    """The contact hunt's searches, one per round (engine.research.contact_search)."""
    return _m("research.contact_search").hunt_queries(organisation, city, social)


def hunt_contacts(results: list, *, organisation: str, site_domain: Optional[str], city: Optional[str],
                  country: Optional[str]) -> List[dict]:
    """The organisation's own phones / emails printed next to its name in one hunt search's results."""
    return _m("research.contact_search").hunt_contacts(results, organisation=organisation, site_domain=site_domain,
                                                       city=city, country=country)


def hunt_found_by() -> str:
    return _m("research.contact_search").HUNT_FOUND_BY


# ---- Google Maps listings (research) ------------------------------------------
def maps_query(organisation: str, city: Optional[str]) -> str:
    return _m("research.maps_listing").maps_query(organisation, city)


def pick_listing(places: List[dict], *, organisation: str, domain: Optional[str],
                 city: Optional[str]) -> Optional[dict]:
    """The listing of a Maps search that is this organisation's (engine.research.maps_listing)."""
    return _m("research.maps_listing").pick_listing(places, organisation=organisation, domain=domain, city=city)


def listing_city(address: Optional[str], known: Optional[str] = None) -> Optional[str]:
    return _m("research.maps_listing").listing_city(address, known)


def maps_kind(category: Optional[str], name: Optional[str], industries: Optional[List[dict]]) -> Optional[str]:
    """The brief's industry a Maps listing's category or name shows (engine.scoring.maps_kind), or None."""
    return _m("scoring").maps_kind(category, name, industries)


def social_links(pages: List[dict]) -> dict:
    return _m("research.social").social_links(pages)


def detect_platforms(pages: List[dict], offer=None) -> List[dict]:
    """Platforms the pages run on; with an offer, its own competitors are looked for too and
    "competitor" says whether each one competes with the offer."""
    if offer is None:
        return _m("fingerprint").detect_platforms(pages)
    return offer.mark_competitors(_m("fingerprint").detect_platforms(pages, offer.extra_vendors()))


def size_signals(pages: List[dict], social: dict) -> dict:
    return _m("fingerprint").size_signals(pages, social)


def score_lead(lead: dict, brief: dict, platforms: List[dict], size: dict) -> dict:
    return _m("scoring").score_lead(lead, brief, platforms, size)


def gate(scored: dict, lead: dict, gate_cfg: dict):
    return _m("scoring").gate(scored, lead, gate_cfg)


def flag_words(flag: str) -> str:
    """A score flag in plain words, as the gate's reasons show it."""
    return _m("scoring").flag_words(flag)


def invalid_output() -> type:
    try:
        return _m("errors").InvalidOutput
    except Exception:  # noqa: BLE001
        from .llm import InvalidOutput
        return InvalidOutput


def search_failed() -> type:
    from .search import SearchFailed
    return SearchFailed


__all__ = [n for n in dir() if not n.startswith("_")]


def available() -> Dict[str, Any]:
    """Which engine modules import (for the README's health check / tests)."""
    out: Dict[str, Any] = {}
    for name in ("schemas", "planning", "profiles", "discovery.pipeline", "research.lead", "research.contact_search",
                 "research.maps_listing", "pagefetch", "fingerprint", "scoring"):
        try:
            _m(name)
            out[name] = True
        except Exception as exc:  # noqa: BLE001
            out[name] = f"{type(exc).__name__}: {exc}"[:200]
    return out
