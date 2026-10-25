"""What an organisation's website runs on, and how big the organisation is. No AI.

The model only reads visible text, so it misses the platform a site is built on: WiNNERS Institute
runs its courses on Appx (live.winnersinstitute.in loads its images from appx-content-v2.classx.co.in)
and the engine never saw it. Here platforms come only from concrete markers in the page code:

  - a vendor's domain in a script, stylesheet, iframe, image, form action or inline-script URL
    (``host`` equal to or under the vendor domain, so "graphy.com" never matches "geography.com"),
  - a vendor-specific asset, attribute or cookie name in the code (``appx-version-id``, ``_hsq``),
  - the page's ``<meta name="generator">``,
  - "powered by <vendor>" in the visible text,
  - for payment and course-store links, an ``<a href>`` to the vendor's hosted page (rzp.io/...,
    <school>.classplusapp.com).

A bare word in visible text never counts ("graphy" in "geography", "Inwati" for WATI). Where a
vendor's own asset names were not verified, only its domain is a marker.

Pages are page records: {"url", "text", "links": [(href, text)], "platform_hints": [...]} from
pagefetch.parse_page, optionally with the raw "html" (then the hints are re-derived from it).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class Vendor:
    key: str
    name: str
    kind: str  # lms | crm | whatsapp | chat | payments | website
    competitor: bool  # competes with Vacademy's LMS / CRM: a "switch" pitch, never auto-delivered
    hosts: tuple[str, ...] = ()  # the vendor's domains (asset, widget and API hosts)
    host_prefixes: tuple[str, ...] = ()  # a host whose first label starts with this ("appx-content-v2.")
    tokens: tuple[str, ...] = ()  # vendor-specific names in the page code (attributes, assets, cookies)
    generator: tuple[str, ...] = ()  # words in <meta name="generator">
    powered: tuple[str, ...] = ()  # names after "powered by" in the visible text
    link_hosts: tuple[str, ...] = ()  # <a href> hosts (or sub-domains) that show the site uses the vendor


VENDORS: tuple[Vendor, ...] = (
    # Course apps and LMS platforms (competitors of Vacademy's LMS).
    Vendor("appx", "Appx", "lms", True, hosts=("classx.co.in", "appx.co.in"), host_prefixes=("appx-", "appx."),
           tokens=("appx-version-id", "appxcontent"), powered=("appx",)),
    Vendor("classplus", "Classplus", "lms", True, hosts=("classplusapp.com", "classplus.co"),
           powered=("classplus",), link_hosts=("classplusapp.com",)),
    Vendor("teachmint", "Teachmint", "lms", True, hosts=("teachmint.com",), powered=("teachmint",),
           link_hosts=("teachmint.com",)),
    Vendor("graphy", "Graphy", "lms", True, hosts=("graphy.com",), tokens=("graphyapp",), powered=("graphy",),
           link_hosts=("graphy.com",)),
    Vendor("edmingle", "Edmingle", "lms", True, hosts=("edmingle.com",), powered=("edmingle",),
           link_hosts=("edmingle.com",)),
    Vendor("spayee", "Spayee", "lms", True, hosts=("spayee.com",), powered=("spayee",), link_hosts=("spayee.com",)),
    Vendor("learnyst", "Learnyst", "lms", True, hosts=("learnyst.com",), powered=("learnyst",),
           link_hosts=("learnyst.com",)),
    Vendor("thinkific", "Thinkific", "lms", True, hosts=("thinkific.com",), powered=("thinkific",),
           link_hosts=("thinkific.com",)),
    Vendor("teachable", "Teachable", "lms", True, hosts=("teachable.com", "teachablecdn.com"), powered=("teachable",),
           link_hosts=("teachable.com",)),
    Vendor("kajabi", "Kajabi", "lms", True, hosts=("kajabi.com", "kajabi-cdn.com", "mykajabi.com"), powered=("kajabi",),
           link_hosts=("mykajabi.com",)),
    Vendor("tagmango", "TagMango", "lms", True, hosts=("tagmango.com",), powered=("tagmango",),
           link_hosts=("tagmango.com",)),
    Vendor("exly", "Exly", "lms", True, hosts=("exlyapp.com",), powered=("exly",), link_hosts=("exlyapp.com",)),
    Vendor("learnworlds", "LearnWorlds", "lms", True, hosts=("learnworlds.com", "mylearnworlds.com"),
           powered=("learnworlds",), link_hosts=("mylearnworlds.com",)),
    # CRMs and admission CRMs (competitors of Vacademy's CRM).
    Vendor("leadsquared", "LeadSquared", "crm", True, hosts=("leadsquared.com", "mxradon.com"),
           powered=("leadsquared",)),
    Vendor("meritto", "Meritto (NoPaperForms)", "crm", True, hosts=("nopaperforms.com", "meritto.com"),
           powered=("nopaperforms", "meritto")),
    Vendor("extraaedge", "ExtraaEdge", "crm", True, hosts=("extraaedge.com",), powered=("extraaedge",)),
    Vendor("zoho", "Zoho", "crm", True,
           hosts=("salesiq.zoho.com", "salesiq.zoho.in", "salesiq.zohopublic.com", "salesiq.zohopublic.in",
                  "zohopublic.com", "zohopublic.in", "crm.zoho.com", "crm.zoho.in", "zcrm.zoho.com"),
           tokens=("$zoho.salesiq",)),
    Vendor("hubspot", "HubSpot", "crm", True,
           hosts=("hubspot.com", "hubspot.net", "hs-scripts.com", "hsforms.net", "hsforms.com", "hs-analytics.net",
                  "hscollectedforms.net", "hs-banner.com", "hubspotusercontent-na1.net"),
           tokens=("hs-script-loader", "_hsq"), powered=("hubspot",)),
    Vendor("freshworks", "Freshworks", "crm", True,
           hosts=("freshworks.com", "myfreshworks.com", "freshchat.com", "freshdesk.com", "freshsales.io"),
           powered=("freshworks", "freshchat", "freshdesk")),
    Vendor("salesforce", "Salesforce", "crm", True,
           hosts=("salesforce.com", "force.com", "pardot.com", "salesforce-sites.com", "salesforceliveagent.com"),
           powered=("salesforce",)),
    # WhatsApp and chat tools (not competitors: Vacademy works alongside them).
    Vendor("wati", "WATI", "whatsapp", False, hosts=("wati.io",), powered=("wati",)),
    Vendor("interakt", "Interakt", "whatsapp", False, hosts=("interakt.ai", "interakt.shop"), powered=("interakt",)),
    Vendor("aisensy", "AiSensy", "whatsapp", False, hosts=("aisensy.com",), powered=("aisensy",)),
    Vendor("gallabox", "Gallabox", "whatsapp", False, hosts=("gallabox.com",), powered=("gallabox",)),
    Vendor("tawk", "Tawk.to", "chat", False, hosts=("tawk.to",), tokens=("tawk_api",)),
    # Payments.
    Vendor("razorpay", "Razorpay", "payments", False, hosts=("razorpay.com",),
           link_hosts=("rzp.io", "razorpay.me", "pages.razorpay.com")),
    Vendor("instamojo", "Instamojo", "payments", False, hosts=("instamojo.com",),
           link_hosts=("imjo.in", "instamojo.com")),
    Vendor("cashfree", "Cashfree", "payments", False, hosts=("cashfree.com",), link_hosts=("payments.cashfree.com",)),
    # Website builders and frameworks.
    Vendor("wordpress", "WordPress", "website", False, hosts=("wp.com",), tokens=("wp-content", "wp-includes"),
           generator=("wordpress",)),
    Vendor("wix", "Wix", "website", False, hosts=("wixstatic.com", "parastorage.com", "wixsite.com"),
           generator=("wix.com",)),
    Vendor("shopify", "Shopify", "website", False, hosts=("myshopify.com", "shopify.com"), tokens=("shopify.theme",),
           generator=("shopify",)),
    Vendor("webflow", "Webflow", "website", False, hosts=("webflow.com", "website-files.com", "webflow.io"),
           tokens=("data-wf-site", "data-wf-page"), generator=("webflow",)),
    Vendor("nextjs", "Next.js", "website", False, tokens=("_next/static", "__next_data__"), generator=("next.js",)),
)
VENDORS_BY_KEY = {v.key: v for v in VENDORS}

# Names searched for in the page code (attribute values, inline scripts) by pagefetch.parse_page.
CODE_TOKENS: tuple[str, ...] = tuple(dict.fromkeys(t for v in VENDORS for t in v.tokens))


def _token_re(token: str) -> re.Pattern:
    """A token as a whole name: 'graphyapp' does not match inside 'geographyapp'."""
    return re.compile(r"(?<![a-z0-9])" + re.escape(token.lower()) + r"(?![a-z0-9])")


_TOKEN_RES = {t: _token_re(t) for t in CODE_TOKENS}


def tokens_in(code: str) -> list[str]:
    """The vendor tokens found in a piece of page code (lower-cased)."""
    lowered = code.lower()
    return [t for t, pattern in _TOKEN_RES.items() if pattern.search(lowered)]


def _under(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def _host_matches(vendor: Vendor, host: str) -> bool:
    if any(_under(host, d) for d in vendor.hosts):
        return True
    first = host.split(".", 1)[0] + "."
    return any(first.startswith(p) for p in vendor.host_prefixes)


_POWERED = {
    v.key: re.compile(r"\b(?:powered|built|made|hosted|developed)\s+(?:by|with|on|using)\s+(?:the\s+)?(?:"
                      + "|".join(re.escape(p) for p in v.powered) + r")(?:\.\w+)?\b", re.I)
    for v in VENDORS if v.powered
}


def _hint_host(hint: str) -> tuple[str, str] | None:
    """('script', 'cdn.example.com') from 'script:cdn.example.com/x/y'; None for non-host hints."""
    kind, _, value = hint.partition(":")
    if kind not in ("script", "link", "iframe", "img", "meta", "form", "js", "subdomain", "media"):
        return None
    host = value.split("/", 1)[0].split(":", 1)[0].lower().strip(".")
    return (kind, host) if host else None


_SOURCE_WORDS = {"script": "script", "link": "stylesheet/link", "iframe": "iframe", "img": "assets", "meta": "assets",
                 "form": "form", "js": "inline script", "subdomain": "link", "media": "assets"}


def _page_hints(page: dict[str, Any]) -> list[str]:
    hints = list(page.get("platform_hints") or page.get("platform_hints_json") or [])
    if page.get("html"):
        from .pagefetch import platform_hints_from_html  # parse lazily: pagefetch imports this module

        hints += platform_hints_from_html(page["html"], page.get("final_url") or page.get("url") or "")
    return list(dict.fromkeys(hints))


def _page_host(page: dict[str, Any]) -> str:
    return (urlparse(page.get("final_url") or page.get("url") or "").hostname or "").lower()


def detect_platforms(pages: list[dict]) -> list[dict]:
    """[{"key", "name", "kind", "competitor", "evidence", "url"}], one per platform found, in the
    order of VENDORS (course platforms and CRMs first). evidence says where the marker was, e.g.
    "live.example.in → Appx assets (appx-content-v2.classx.co.in)"."""
    found: dict[str, dict[str, Any]] = {}

    def add(vendor: Vendor, evidence: str, url: str) -> None:
        if vendor.key not in found:
            found[vendor.key] = {"key": vendor.key, "name": vendor.name, "kind": vendor.kind,
                                 "competitor": vendor.competitor, "evidence": evidence, "url": url}

    for page in pages:
        url = page.get("final_url") or page.get("url") or ""
        where = _page_host(page) or url
        hints = _page_hints(page)
        hosts = [h for h in (_hint_host(x) for x in hints) if h]
        markers = {x.partition(":")[2] for x in hints if x.startswith("marker:")}
        generators = [x.partition(":")[2].lower() for x in hints if x.startswith("generator:")]
        paths = " ".join(x.lower() for x in hints if x.startswith(("script:", "link:")))
        for vendor in VENDORS:
            if vendor.key in found:
                continue
            hit = next(((kind, host) for kind, host in hosts if _host_matches(vendor, host)), None)
            if hit:
                add(vendor, f"{where} → {vendor.name} {_SOURCE_WORDS.get(hit[0], hit[0])} ({hit[1]})", url)
                continue
            token = next((t for t in vendor.tokens if t in markers or _TOKEN_RES[t].search(paths)), None)
            if token:
                add(vendor, f"{where} → {vendor.name} marker in the page code ({token})", url)
                continue
            generator = next((g for g in generators if any(w in g for w in vendor.generator)), None)
            if generator:
                add(vendor, f"{where} → meta generator \"{generator}\"", url)
                continue
            if vendor.link_hosts:
                link = next((href for href, _ in page.get("links") or []
                             if _link_host_matches(vendor, href, where)), None)
                if link:
                    add(vendor, f"{where} → links to {vendor.name} ({urlparse(link).hostname})", url)
                    continue
            pattern = _POWERED.get(vendor.key)
            if pattern:
                match = pattern.search(page.get("text") or "")
                if match:
                    add(vendor, f"{where} → \"{' '.join(match.group(0).split())}\"", url)
    order = {v.key: i for i, v in enumerate(VENDORS)}
    return sorted(found.values(), key=lambda p: order[p["key"]])


def _link_host_matches(vendor: Vendor, href: str, page_host: str) -> bool:
    """An <a href> to the vendor's hosted pages: a sub-domain of a course platform (the institute's
    own store, e.g. winners.classplusapp.com) or a payment link (rzp.io/l/...), never the vendor's
    own homepage (which a page may just mention)."""
    host = (urlparse(href).hostname or "").lower()
    if not host or host == page_host:
        return False
    for domain in vendor.link_hosts:
        if vendor.kind == "payments" and _under(host, domain):
            return True
        if host.endswith("." + domain) and not host.startswith(("www.", "blog.", "help.", "support.", "docs.")):
            return True
    return False


# ---------------------------------------------------------------------------------------- size

# Tier thresholds (v1, to be tuned with sales). Enterprise: a national-scale brand that does not buy
# self-serve; large: a strong regional brand; mid: an established institute; small: a local
# institute; micro: a single tutor or home tuition.
ENTERPRISE = {"youtube_subscribers": 1_000_000, "app_downloads": 1_000_000, "students": 100_000, "branches": 25}
LARGE = {"youtube_subscribers": 100_000, "app_downloads": 100_000, "students": 20_000, "branches": 8}
MID = {"youtube_subscribers": 10_000, "app_downloads": 10_000, "students": 2_000, "branches": 3}
SIZE_FIELDS = ("youtube_subscribers", "app_downloads", "students", "branches")

_MULTIPLIERS = {
    "k": 1_000, "thousand": 1_000, "m": 1_000_000, "mn": 1_000_000, "million": 1_000_000,
    "l": 100_000, "lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000,
    "cr": 10_000_000, "crore": 10_000_000, "crores": 10_000_000,
}
# 6M+, 40Lac+, 1,00,000+, 2.5 lakh, 30k+, 12 (the unit must touch the number or follow one space;
# a lone "L" counts only as "10L+").
_NUMBER = (r"(?<![\w.,])(?P<num>\d{1,3}(?:,\d{2,3})+(?![\d,])|\d+(?:\.\d+)?(?!\d|[.,]\d))\s?"
           r"(?P<unit>k|K|thousand|M|Mn|mn|million|Million|lakhs?|Lakhs?|LAKHS?|lacs?|Lacs?|LACS?|L(?=\s*\+)|"
           r"crores?|Crores?|CRORES?|cr|Cr|CR)?(?![a-zA-Z])\s*\+?")
_FILLER = r"(?:[A-Za-z&'’]+\s+){0,3}?"
_FIELD_WORDS = {
    "youtube_subscribers": r"(?:youtube\s+)?subscribers?|subs\b",
    "app_downloads": r"(?:app\s+)?(?:downloads?|installs?)",
    "students": r"students?|learners?|aspirants?|enrol(?:l)?ments?|alumni",
    "selections": r"selections?|selected\s+students|results?\s+produced",
    "branches": r"branch(?:es)?|cent(?:re|er)s|campus(?:es)?|study\s+cent(?:re|er)s|locations",
}
_BEFORE = {f: re.compile(_NUMBER + r"\s*" + _FILLER + r"(?:" + w + r")\b", re.I) for f, w in _FIELD_WORDS.items()}
# "Students: 5,000+" or a stat card's label above its number; a figure merely following the word on
# the same line ("Subscribers 40Lac+ App Downloads") belongs to the next label, so it is not read.
_AFTER = {f: re.compile(r"\b(?:" + w + r")\b[ \t]*[:\-–][ \t]*" + _NUMBER, re.I) for f, w in _FIELD_WORDS.items()}
_ALL_FIELD_WORDS = "|".join(_FIELD_WORDS.values())
_BELOW = {f: re.compile(r"\b(?:" + w + r")\b[ \t]*\n\s*" + _NUMBER + r"(?![+\s]*" + _FILLER + r"(?:"
                        + _ALL_FIELD_WORDS + r")\b)", re.I)
          for f, w in _FIELD_WORDS.items()}
# The smallest figure worth reporting per field ("5 star rated by students" is not a size).
_MINIMUM = {"youtube_subscribers": 100, "app_downloads": 100, "students": 20, "selections": 20, "branches": 2}
_SINGLE = {"branches"}  # counted things: "12 branches" (no lakhs of branches)
_MICRO = re.compile(r"\bhome\s+tuitions?\b|\bhome\s+tutor(?:s|ing)?\b|\bprivate\s+tutor\b|\bpersonal\s+tutor\b|"
                    r"\bindividual\s+tutor\b|\bfreelance\s+(?:tutor|teacher)\b|\bi\s+am\s+a\s+(?:tutor|teacher)\b|"
                    r"\bi\s+teach\b|\bmy\s+(?:students|classes)\b", re.I)


def parse_count(number: str, unit: str | None) -> int | None:
    """'6', 'M' -> 6,000,000; '1,00,000' -> 100,000; '40', 'Lac' -> 4,000,000."""
    try:
        value = float(number.replace(",", ""))
    except ValueError:
        return None
    return int(round(value * _MULTIPLIERS.get((unit or "").lower(), 1)))


def _quote(text: str, start: int, end: int) -> str:
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    line = text[line_start:line_end if line_end >= 0 else len(text)]
    if len(line) <= 160:
        return " ".join(line.split())
    return " ".join(text[max(line_start, start - 40):end + 40].split())


def _plausible(field: str, value: int, raw: str, unit: str | None) -> bool:
    if value < _MINIMUM.get(field, 1):
        return False
    if field in _SINGLE:
        return value <= 2_000 and not unit
    if not unit and "," not in raw and len(raw.split(".")[0]) >= 8:
        return False  # a phone number, an id
    if not unit and 1900 <= value <= 2100 and "," not in raw:
        return False  # "since 2017 students..."
    return value < 1_000_000_000


def size_signals(pages: list[dict], social: dict) -> dict:
    """Numbers the organisation states about itself, with quotes:
    {"youtube_subscribers", "app_downloads", "students", "selections", "branches": int | None,
     "tier": "micro|small|mid|large|enterprise" | None, "evidence": [{"field", "value", "quote", "url"}],
     "micro_hint": quote | None}.

    Takes the largest figure per field across the pages. social may add counts the caller knows
    (e.g. {"youtube": {"url": ..., "subscribers": 6100000}} or {"youtube_subscribers": 6100000}).
    Results ("30k+ Total Selections") count as students for the tier only: an institute with 30,000
    selections has at least that many students."""
    best: dict[str, int] = {}
    evidence: list[dict[str, Any]] = []
    micro_hint: str | None = None
    for page in pages:
        text = page.get("text") or ""
        url = page.get("final_url") or page.get("url") or ""
        for field in _FIELD_WORDS:
            for pattern in (_BEFORE[field], _AFTER[field], _BELOW[field]):
                for m in pattern.finditer(text):
                    if pattern is _BEFORE[field] and "\n" in m.group(0).strip() and re.search(
                            r"[:\-–]\s*$", text[text.rfind("\n", 0, m.start()) + 1:m.start()]):
                        continue  # "Students: 500" above "Centres: 4": 500 is the students' figure
                    value = parse_count(m.group("num"), m.group("unit"))
                    if value is None or not _plausible(field, value, m.group("num"), m.group("unit")):
                        continue
                    if field == "youtube_subscribers" and not re.search(r"youtube|subscriber", m.group(0), re.I):
                        continue
                    quote = _quote(text, m.start(), m.end())
                    if all((e["field"], e["value"], e["url"]) != (field, value, url) for e in evidence):
                        evidence.append({"field": field, "value": value, "quote": quote, "url": url})
                    best[field] = max(best.get(field, 0), value)
        if micro_hint is None:
            m = _MICRO.search(text)
            if m:
                micro_hint = _quote(text, m.start(), m.end())
    for key, value in (social or {}).items():
        count = None
        if key == "youtube" and isinstance(value, dict):
            count = value.get("subscribers")
        elif key in SIZE_FIELDS:
            count = value
        field = "youtube_subscribers" if key == "youtube" else key
        if isinstance(count, int) and not isinstance(count, bool) and count > 0:
            best[field] = max(best.get(field, 0), count)
            evidence.append({"field": field, "value": count, "quote": f"{field.replace('_', ' ')}: {count}",
                             "url": value.get("url", "") if isinstance(value, dict) else ""})

    result: dict[str, Any] = {f: best.get(f) for f in (*SIZE_FIELDS, "selections")}
    result["tier"] = size_tier(result, micro_hint)
    result["evidence"] = evidence
    result["micro_hint"] = micro_hint
    return result


def size_tier(counts: dict[str, Any], micro_hint: str | None = None) -> str | None:
    """enterprise / large / mid / small from the counts (thresholds above); micro for a single tutor
    or home tuition with no mid-size figures; None when nothing is known."""
    values = {f: counts.get(f) or 0 for f in SIZE_FIELDS}
    values["students"] = max(values["students"], counts.get("selections") or 0)
    if any(values[f] >= ENTERPRISE[f] for f in SIZE_FIELDS):
        return "enterprise"
    if any(values[f] >= LARGE[f] for f in SIZE_FIELDS):
        return "large"
    if any(values[f] >= MID[f] for f in SIZE_FIELDS):
        return "mid"
    if micro_hint:
        return "micro"
    return "small" if any(values.values()) else None
