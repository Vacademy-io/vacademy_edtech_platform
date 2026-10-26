"""Website identity helpers and the sites that are never an organisation's own website."""

from __future__ import annotations

import re
from urllib.parse import urlparse

import tldextract

# Bundled public-suffix list only: never fetched over the network. Private suffixes are included so
# sites on free hosting count separately ('a.web.app' and 'b.web.app' are two organisations).
_extract = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True)

# Directories, listings, marketplaces, social media, job boards, news and search sites. A result
# on one of these is about organisations, not from one, so it is never a research target.
EXCLUDED_DOMAINS = frozenset({
    # education directories and listings
    "justdial.com", "sulekha.com", "shiksha.com", "collegedunia.com", "collegedekho.com", "careers360.com",
    "getmyuni.com", "edumetrics.in", "urbanpro.com", "superprof.co.in", "yet5.com", "edufever.com",
    "eduvidya.com", "indiastudychannel.com", "schoolmykids.com", "edustoke.com", "zollege.in",
    "coachingselect.com", "studyguideindia.com", "indiaeducation.net", "targetstudy.com", "eduwar.com",
    "jagranjosh.com", "embibe.com", "toppr.com", "vedantu.com",
    # business directories and marketplaces
    "indiamart.com", "tradeindia.com", "yellowpages.in", "asklaila.com", "grotal.com", "zaubacorp.com",
    "tofler.in", "mouthshut.com", "trustpilot.com", "magicbricks.com", "99acres.com", "nobroker.in",
    # jobs
    "naukri.com", "indeed.com", "glassdoor.com", "glassdoor.co.in", "ambitionbox.com", "foundit.in",
    "apna.co", "workindia.in", "internshala.com", "shine.com", "timesjobs.com", "monsterindia.com",
    "freshersworld.com", "jobhai.com", "hirect.in", "iimjobs.com", "hirist.tech", "cutshort.io", "wellfound.com",
    "jooble.org", "careerjet.co.in", "simplyhired.co.in", "schooljobsinindia.com", "teacheron.com",
    "collegebatch.com", "quikr.com", "olx.in", "naukrigulf.com", "kitjob.in",
    # social, video, Q&A, encyclopedias, blogs
    "linkedin.com", "facebook.com", "instagram.com", "youtube.com", "twitter.com", "x.com", "threads.net",
    "pinterest.com", "quora.com", "reddit.com", "wikipedia.org", "medium.com", "blogspot.com",
    "wordpress.com", "telegram.me", "t.me", "whatsapp.com",
    # search, maps, app stores
    "google.com", "google.co.in", "bing.com", "microsoft.com", "apple.com", "yahoo.com", "duckduckgo.com",
    # news
    "indiatimes.com", "hindustantimes.com", "indianexpress.com", "thehindu.com", "ndtv.com",
    "deccanherald.com", "news18.com", "livemint.com", "economictimes.com", "thebetterindia.com",
    "business-standard.com", "moneycontrol.com", "financialexpress.com", "businesstoday.in", "timesofindia.com",
    "zeebiz.com", "theprint.in", "firstpost.com", "yourstory.com", "inc42.com", "entrackr.com", "outlookindia.com",
    "freepressjournal.in", "dainikbhaskar.com", "bhaskar.com", "patrika.com", "naidunia.com", "reuters.com",
    "bloomberg.com", "forbesindia.com", "khaleejtimes.com", "gulfnews.com", "thenationalnews.com", "arabianbusiness.com",
    "zawya.com", "bbc.co.uk", "bbc.com", "theguardian.com", "abc.net.au", "smh.com.au",
    # press releases
    "prnewswire.com", "businesswire.com", "globenewswire.com", "einpresswire.com", "pib.gov.in", "newswire.com",
})


def registered_domain(url: str) -> str | None:
    """'https://www.allen.ac.in/bengaluru/' -> 'allen.ac.in'."""
    host = urlparse(url if "://" in url else f"https://{url}").hostname
    if not host:
        return None
    domain = _extract(host).top_domain_under_public_suffix
    return domain.lower() if domain else None


def homepage(url: str) -> str | None:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    return f"{parsed.scheme}://{parsed.hostname}/"


def is_excluded(domain: str | None) -> bool:
    """Excluded sites and their subdomains (e.g. 'someone.blogspot.com')."""
    if domain is None:
        return True
    return domain in EXCLUDED_DOMAINS or any(domain.endswith("." + d) for d in EXCLUDED_DOMAINS)


# 'shine', 'naukri', 'indeed'...: a signal whose 'organisation' is only one of these names is the portal itself.
_PORTAL_BRANDS = frozenset(d.split(".")[0] for d in EXCLUDED_DOMAINS)
_NAME_FILLER = frozenset({"com", "in", "co", "www", "jobs", "job", "portal", "india", "careers"})


def is_portal_name(name: str) -> bool:
    """'Shine.com', 'Naukri jobs', 'Indeed India' -> True; 'Drishti IAS' -> False."""
    words = [w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in _NAME_FILLER]
    return bool(words) and all(w in _PORTAL_BRANDS for w in words)
