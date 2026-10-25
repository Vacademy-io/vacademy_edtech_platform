"""Contact routes published on an organisation's own pages, found by pattern matching, and how
useful each one is for a sales call.

Nothing here comes from the model. Kinds:
  published_email   - shown on the organisation's website
  institute_phone   - a number shown on the website
  whatsapp          - a WhatsApp link on the website
  contact_form      - a page with an enquiry form

Each route is then rated (rate_contact) from what is printed around it, so a helpline or a support
inbox is never presented as a way to reach a decision maker:
  direct   - printed next to a named person (or their own mailbox, or a leader's inbox like director@)
  likely   - a mobile / WhatsApp / personal mailbox not tied to a person: often the admissions desk
  general  - reception landline, general inbox (info@, admissions@), a large chain's central desk
  avoid    - toll-free or helpline (usually an IVR), fax, support / HR / careers inboxes, dead domains
Websites rarely print a decision maker's own number, and no mailbox is confirmed to exist: only the
email domain's mail server is checked (check_mail_domains, with an injected MX lookup).
"""

from __future__ import annotations

import math
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import unquote, urlparse

import phonenumbers

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}")
_EMAIL_NOISE = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", "@2x", "@3x", "example.", "sentry", "wixpress",
                "domain.com", "email.com", "yourname", "u003e")
GENERIC_LOCAL_PARTS = {
    "info", "contact", "contactus", "admissions", "admission", "enquiry", "enquiries", "inquiry", "hello", "support",
    "office", "admin", "help", "mail", "care", "connect", "team", "career", "careers", "hr", "jobs", "sales",
}
MAX_EACH = 8
TIERS = ("direct", "likely", "general", "avoid")

# Numbers written without a country code are read as local to the site's country: from its domain
# (.co.uk, .com.au, ...), else the run's country, else India.
_TLD_REGION = {
    "in": "IN", "uk": "GB", "au": "AU", "ae": "AE", "sg": "SG", "us": "US", "ca": "CA", "nz": "NZ", "za": "ZA",
    "my": "MY", "ph": "PH", "pk": "PK", "bd": "BD", "lk": "LK", "np": "NP", "ng": "NG", "ke": "KE", "sa": "SA",
    "qa": "QA", "om": "OM", "kw": "KW", "bh": "BH", "de": "DE", "fr": "FR", "ie": "IE", "id": "ID", "th": "TH",
    "vn": "VN", "eg": "EG", "gh": "GH", "ug": "UG", "tz": "TZ",
}
_COUNTRY_REGION = {
    "india": "IN", "united states": "US", "usa": "US", "us": "US", "america": "US", "united kingdom": "GB", "uk": "GB",
    "england": "GB", "australia": "AU", "canada": "CA", "united arab emirates": "AE", "uae": "AE", "dubai": "AE",
    "singapore": "SG", "new zealand": "NZ", "south africa": "ZA", "malaysia": "MY", "philippines": "PH",
    "pakistan": "PK", "bangladesh": "BD", "sri lanka": "LK", "nepal": "NP", "nigeria": "NG", "kenya": "KE",
    "saudi arabia": "SA", "qatar": "QA", "oman": "OM", "kuwait": "KW", "bahrain": "BH", "germany": "DE",
    "france": "FR", "ireland": "IE", "indonesia": "ID", "thailand": "TH", "vietnam": "VN", "egypt": "EG",
    "ghana": "GH", "uganda": "UG", "tanzania": "TZ",
}
DEFAULT_REGION = "IN"

# Words printed before a number. Matched against the label since the previous number only.
_FAX_RE = re.compile(r"\bfax\b", re.I)
_HELPLINE_RE = re.compile(
    r"toll[\s-]?free|help[\s-]?line|help[\s-]?desk|customer\s+(?:care|support|service)|\bsupport\b|call\s+cent|"
    r"\bivr\b|missed\s+call|grievance|complain|24\s*[x/×]\s*7", re.I)
_HR_RE = re.compile(r"\bhr\b|human\s+resource|career|recruit|\bjobs?\b|vacanc|placement|\bhire\b", re.I)
# Sample numbers printed by website templates ("98765 43210").
_PLACEHOLDER_NUMBERS = {"9876543210", "1234567890", "9876501234", "9999999999", "9898989898", "9000000000",
                        "8888888888", "7777777777", "0123456789", "9876598765"}
_DESK_RE = re.compile(r"admission|enquir|inquir|counsel|call\s+us|contact\s+us|reception|front\s+desk|office", re.I)
_PHONE_LIKE = re.compile(r"\+?\d[\d\s\-().]{5,}\d")
# A number printed with its trunk 0 and area code ("0744-3510300", "0731 4058393") is a landline.
_STD_PRINTED = re.compile(r"(?<![\d+])0\d{2,4}[\s-]+\d{6,8}(?!\d)")

FREE_MAIL = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "rediffmail.com", "hotmail.com",
    "outlook.com", "live.com", "icloud.com", "me.com", "ymail.com", "aol.com", "protonmail.com", "proton.me",
    "zoho.com", "zohomail.in", "msn.com", "hotmail.co.uk", "yahoo.co.uk",
}
# Mailbox words (split from the part before @) that never reach a buyer.
_AVOID_TOKENS = {
    "support", "care", "customercare", "helpdesk", "help", "hr", "career", "careers", "job", "jobs", "recruit",
    "recruitment", "recruiter", "hiring", "placement", "placements", "accounts", "account", "billing", "fees", "fee",
    "finance", "payment", "payments", "noreply", "donotreply", "feedback", "grievance", "grievances", "complaint",
    "complaints", "webmaster", "privacy", "legal", "compliance", "media", "press", "pr", "publicrelations", "abuse",
    "alumni", "exam", "exams", "examination", "result", "results", "library", "it", "techsupport", "security",
    "studentcare", "studentsupport", "parentcare", "student", "students", "vendor", "vendors", "grievancecell",
}
_LEADER_TOKENS = {
    "director", "principal", "founder", "cofounder", "ceo", "md", "chairman", "chairperson", "owner", "president",
    "dean", "headmaster", "headmistress", "management", "directorate", "trustee",
}
_GENERAL_TOKENS = {
    "info", "contact", "contactus", "admissions", "admission", "enquiry", "enquiries", "inquiry", "inquiries", "hello",
    "office", "admin", "mail", "connect", "team", "sales", "query", "queries", "reception", "frontdesk", "centre",
    "center", "studycenter", "studycentre", "branch", "campus", "academy", "school", "college", "institute", "classes",
    "coaching", "tutorials", "education", "edu", "learning", "official", "corporate", "general", "registrar", "desk",
}
_HONORIFICS = {"mr", "mrs", "ms", "miss", "dr", "er", "prof", "shri", "smt", "sri", "sir", "madam", "ma'am", "mam"}
_ORG_STOPWORDS = {"the", "and", "of", "for", "pvt", "ltd", "private", "limited", "india", "group"}


def phone_region(site_domain: str | None, country: str | None = None) -> str:
    tld = (site_domain or "").rsplit(".", 1)[-1].lower()
    return _TLD_REGION.get(tld) or _COUNTRY_REGION.get((country or "").strip().lower()) or DEFAULT_REGION


@dataclass(frozen=True)
class Contact:
    kind: str  # published_email | institute_phone | whatsapp | contact_form
    value: str
    url: str  # the page it was found on
    note: str = ""  # phones: mobile | landline | toll-free | shared-cost | virtual | phone
    context: str = ""  # the words printed around it, e.g. "Admission Counselor: 1800-102-2727"
    seen_on: int = 0  # how many of the pages read show it: a number on every page is the site's main line
    fax: bool = False  # only ever printed as a fax number
    mx: bool | None = None  # emails: whether the domain has a mail server (None: not checked)

    def as_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {"kind": self.kind, "value": self.value, "url": self.url, "note": self.note}
        if self.kind != "contact_form":
            item.update(context=self.context, seen_on=self.seen_on)
        if self.fax:
            item["fax"] = True
        if self.mx is not None:
            item["mx"] = self.mx
        return item


def _emails(text: str) -> list[str]:
    found = []
    for match in EMAIL_RE.findall(text):
        email = match.strip(".").lower()
        if not any(noise in email for noise in _EMAIL_NOISE):
            found.append(email)
    return found


_PHONE_TYPES = {
    phonenumbers.PhoneNumberType.MOBILE: "mobile",
    phonenumbers.PhoneNumberType.FIXED_LINE: "landline",
    phonenumbers.PhoneNumberType.TOLL_FREE: "toll-free",
    phonenumbers.PhoneNumberType.SHARED_COST: "shared-cost",
    phonenumbers.PhoneNumberType.UAN: "shared-cost",
    phonenumbers.PhoneNumberType.PREMIUM_RATE: "shared-cost",
    phonenumbers.PhoneNumberType.VOIP: "virtual",
}


def _phone_matches(text: str, region: str) -> list[tuple[str, str, int, int]]:
    """[(formatted number, type, start, end)] in the text."""
    found = []
    for match in phonenumbers.PhoneNumberMatcher(text, region, leniency=phonenumbers.Leniency.VALID):
        number = match.number
        label = _PHONE_TYPES.get(phonenumbers.number_type(number), "phone")
        found.append((phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.INTERNATIONAL), label,
                      match.start, match.end))
    return found


def _phones(text: str, region: str = DEFAULT_REGION) -> list[tuple[str, str]]:
    return [(number, label) for number, label, _, _ in _phone_matches(text, region)]


def _label_before(text: str, start: int) -> str:
    """The words printed just before a value, since the previous number: on its line, else on the
    line above ("Helpline" above "1800 ..."), so a fax label is never read as the next number's."""
    line_start = text.rfind("\n", 0, start) + 1
    before = _PHONE_LIKE.split(text[line_start:start])[-1]
    if not re.search(r"[A-Za-z]{2,}", before) and line_start > 0:
        above_start = text.rfind("\n", 0, line_start - 1) + 1
        above = _PHONE_LIKE.split(text[above_start:line_start - 1])[-1]
        before = above + " " + before
    return " ".join(before.split())[-60:]


def _after(text: str, end: int) -> str:
    line_end = text.find("\n", end)
    rest = text[end:line_end if line_end >= 0 else len(text)]
    return " ".join(_PHONE_LIKE.split(rest)[0].split())[:40]


def _occurrences(kind: str, value: str, text: str, region: str) -> list[tuple[str, bool]]:
    """[(context, printed as a fax number)] for each place the value appears in the text."""
    if kind == "published_email":
        spots = [(m.start(), m.end()) for m in re.finditer(re.escape(value), text, re.I)]
    elif kind in ("institute_phone", "whatsapp"):
        spots = [(s, e) for number, _, s, e in _phone_matches(text, region) if number == value]
    else:
        return []
    found = []
    for start, end in spots:
        label = _label_before(text, start)
        context = f"{label} {text[start:end].strip()} {_after(text, end)}".strip()
        found.append((" ".join(context.split())[:140], bool(_FAX_RE.search(label[-25:]))))
    return found


def _whatsapp(href: str, region: str = DEFAULT_REGION) -> str | None:
    parsed = urlparse(href)
    host = (parsed.hostname or "").lower()
    if host in ("wa.me", "api.whatsapp.com", "wa.link") or host.endswith(".whatsapp.com"):
        digits = re.sub(r"\D", "", parsed.path + " " + unquote(parsed.query))
        if not 10 <= len(digits) <= 15:
            return None
        # wa.me numbers should carry a country code; a bare 10-digit number is read as local.
        candidate = f"+{digits}" if len(digits) > 10 else digits
        try:
            number = phonenumbers.parse(candidate, region)
        except phonenumbers.NumberParseException:
            return None
        if phonenumbers.is_valid_number(number):
            return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.INTERNATIONAL)
    return None


def describe(contact: dict[str, Any], texts: list[str], region: str, link_label: str = "") -> dict[str, Any]:
    """Adds what the pages print around a contact: context, seen_on and fax. Re-runnable on saved
    leads with the stored page text (rescoring)."""
    contexts: list[str] = []
    seen_on, fax_only = 0, True
    for text in texts:
        found = _occurrences(contact["kind"], contact["value"], text, region)
        if found:
            seen_on += 1
        for context, fax in found:
            fax_only = fax_only and fax
            if not fax:
                contexts.append(context)
    item = {**contact, "seen_on": seen_on}
    item["context"] = contexts[0] if contexts else (link_label or contact.get("context") or "")
    item.pop("fax", None)
    if seen_on and fax_only:
        item["fax"] = True
    return item


def extract_contacts(pages: list[dict], site_domain: str | None, country: str | None = None) -> list[Contact]:
    """pages: [{"url", "text", "links": [(href, text)], "has_form", "page_type"}] in reading order.
    country: the run's country, for numbers written without a country code."""
    region = phone_region(site_domain, country)
    emails: OrderedDict[str, Contact] = OrderedDict()
    phones: OrderedDict[str, Contact] = OrderedDict()
    whatsapp: OrderedDict[str, Contact] = OrderedDict()
    labels: dict[str, str] = {}  # the text of a tel:, mailto: or WhatsApp link, e.g. "Call Director"
    forms: list[Contact] = []

    # Contact pages first: numbers there are the ones the organisation wants used.
    ordered = sorted(pages, key=lambda p: 0 if p.get("page_type") == "contact" else 1)
    for page in ordered:
        url = page["url"]
        links = page.get("links", [])
        mailto = [(unquote(h[7:].split("?")[0]), t) for h, t in links if h.lower().startswith("mailto:")]
        tel = [(unquote(h[4:]), t) for h, t in links if h.lower().startswith("tel:")]
        for address, text in mailto:
            for email in _emails(address):
                labels.setdefault(email, " ".join((text or "").split())[:60])
        for email in _emails(" ".join(a for a, _ in mailto) + "\n" + page.get("text", "")):
            if email not in emails:
                local, _, domain = email.partition("@")
                notes = ["generic inbox" if local in GENERIC_LOCAL_PARTS else "named inbox"]
                if site_domain and domain.endswith(site_domain):
                    notes.append("on the organisation's own domain")
                emails[email] = Contact("published_email", email, url, ", ".join(notes))
        for number, text in tel:
            for formatted, _ in _phones(number, region):
                labels.setdefault(formatted, " ".join((text or "").split())[:60])
        for number, label in _phones(" \n ".join(n for n, _ in tel) + "\n" + page.get("text", ""), region):
            if number not in phones:
                phones[number] = Contact("institute_phone", number, url, label)
        for href, text in links:
            number = _whatsapp(href, region)
            if number and number not in whatsapp:
                whatsapp[number] = Contact("whatsapp", number, url)
                labels.setdefault(number, " ".join((text or "").split())[:60])
        if page.get("has_form") and page.get("page_type") in ("contact", "admissions", "home"):
            forms.append(Contact("contact_form", url, url, f"enquiry form on the {page.get('page_type')} page"))

    texts = [p.get("text", "") for p in pages]

    def described(c: Contact) -> Contact:
        d = describe(c.as_dict(), texts, region, labels.get(c.value, ""))
        return Contact(c.kind, c.value, c.url, c.note, d["context"], d["seen_on"], bool(d.get("fax")))

    found_phones = [described(c) for c in phones.values()]
    # Fax numbers and helplines go last, so the cap keeps the numbers worth calling.
    found_phones.sort(key=lambda c: (c.fax, c.note in ("toll-free", "shared-cost")))
    return (
        [described(c) for c in emails.values()][:MAX_EACH]
        + found_phones[:MAX_EACH]
        + [described(c) for c in whatsapp.values()][:2]
        + forms[:2]
    )


# People named on the pages and the numbers / emails printed next to them.

def _name_pattern(name: str) -> re.Pattern | None:
    tokens = [t for t in re.split(r"[\s.,]+", name) if t and t.lower().strip("'") not in _HONORIFICS]
    if not tokens or (len(tokens) == 1 and len(tokens[0]) < 5):
        return None  # a lone short word ("Rao") would match too much
    return re.compile(r"(?<![A-Za-z])" + r"[\s.,]+".join(re.escape(t) for t in tokens) + r"(?![A-Za-z])", re.I)


def _nth_newline(text: str, start: int, n: int) -> int:
    pos = start
    for _ in range(n):
        pos = text.find("\n", pos + 1)
        if pos < 0:
            return len(text)
    return pos


def link_people(contacts: list[dict[str, Any]], people: list[dict[str, Any]], texts: list[str],
                region: str) -> list[dict[str, Any]]:
    """Ties a phone or email to a named person when the page prints it right next to their name
    (same line, or the next lines before another person's name). A number shown on most pages
    (the site's main line) is tied only when it is on the same line as the name."""
    links: dict[str, tuple[dict[str, Any], str, bool]] = {}
    patterns = [(p, pat) for p in people if (pat := _name_pattern(p.get("name") or ""))]
    for text in texts:
        # Sort on positions only: the model can name one person twice, and two equal spans
        # would otherwise fall through to comparing the person dicts (TypeError).
        spans = sorted(((m.start(), m.end(), person) for person, pat in patterns for m in pat.finditer(text)),
                       key=lambda s: (s[0], s[1]))
        for index, (start, end, person) in enumerate(spans):
            stop = spans[index + 1][0] if index + 1 < len(spans) else len(text)
            line_start = text.rfind("\n", 0, start) + 1
            back = max(line_start, start - 60, spans[index - 1][1] if index and spans[index - 1][1] <= start else 0)
            forward = min(stop, end + 160, _nth_newline(text, end, 4))
            line_end = min(forward, _nth_newline(text, end, 1))
            window = text[back:forward]
            quote = " ".join(window.split())[:160]
            for number, _, s, e in _phone_matches(window, region):
                links.setdefault(number, (person, quote, back + e <= line_end))
            for match in EMAIL_RE.finditer(window):
                links.setdefault(match.group(0).strip(".").lower(),
                                 (person, quote, back + match.end() <= line_end))
    many_pages = max(2, math.ceil(0.75 * len([t for t in texts if t])))
    linked = []
    for c in contacts:
        if c.get("found_by") or c.get("confirmed_by"):  # tied by a search result, not by these pages
            linked.append(c)
            continue
        c = {k: v for k, v in c.items() if k not in ("person", "person_quote", "person_match")}
        hit = links.get(c["value"].lower() if c["kind"] == "published_email" else c["value"])
        if hit and c["kind"] != "contact_form":
            person, quote, same_line = hit
            if same_line or c.get("seen_on", 0) < many_pages:
                c["person"] = {"name": person["name"], "role": person.get("role", "")}
                c["person_quote"] = quote
        linked.append(c)
    return linked


# Rating.

def _local_tokens(local: str) -> list[str]:
    return [t for t in re.split(r"[._\-+\d]+", local.lower()) if t]


def _name_tokens(name: str) -> list[str]:
    return [t for t in re.split(r"[\s.,'-]+", name.lower()) if len(t) >= 3 and t not in _HONORIFICS]


def email_person(email: str, people: list[dict[str, Any]], organisation: str = "") -> dict[str, Any] | None:
    """The named person whose own mailbox this looks like (rajesh.kumar@, rkumar@, rajeshk@)."""
    local = email.partition("@")[0].lower()
    tokens = _local_tokens(local)
    joined = "".join(tokens)
    skip = org_words(organisation) | _NOT_NAME_WORDS
    for person in people:
        names = [t for t in _name_tokens(re.sub(r"\([^)]*\)", " ", person.get("name") or "")) if t not in skip]
        if not names:
            continue
        first, last = names[0], names[-1]
        if any(t in names and len(t) >= 4 for t in tokens):
            return person
        if len(first) >= 5 and joined.startswith(first):
            return person
        if len(names) >= 2 and len(last) >= 4 and joined in (first[0] + last, first + last[0], first + last):
            return person
    return None


def org_words(name: str) -> set[str]:
    return {w for w in re.split(r"[^a-z0-9]+", name.lower()) if len(w) >= 3 and w not in _ORG_STOPWORDS}


_NOT_NAME_WORDS = {
    "managing", "director", "founder", "cofounder", "owner", "principal", "ceo", "head", "manager", "team", "admin",
    "chairman", "chairperson", "president", "office", "desk", "academy", "classes", "class", "institute", "coaching",
    "school", "college", "education", "educational", "centre", "center", "career", "careers", "tutorials", "learning",
    "study", "ias", "ras", "pcs", "official", "india", "group", "pvt", "ltd", "the", "and", "of", "sir", "madam",
}


def is_person_name(name: str, organisation: str = "") -> bool:
    """False for "(Managing Director)", "Samyak IAS RAS" (the organisation itself) and the like."""
    bare = re.sub(r"\([^)]*\)", " ", name)
    words = [w for w in re.findall(r"[a-z]+", bare.lower()) if len(w) >= 2 and w not in _HONORIFICS]
    other = org_words(organisation)
    return any(w not in _NOT_NAME_WORDS and w not in other for w in words)


def is_placeholder(number: str) -> bool:
    national = re.sub(r"\D", "", number)[-10:]
    return national in _PLACEHOLDER_NUMBERS or len(set(national)) <= 2 or "1234567" in national


def _number_region(number: str) -> str | None:
    try:
        return phonenumbers.region_code_for_number(phonenumbers.parse(number, None))
    except phonenumbers.NumberParseException:
        return None


TEMPLATE_LEFTOVER = "Only in a hidden link on the website, probably left over from its template"


def site_desk_line(c: dict[str, Any], pages_read: int | None = None) -> str | None:
    """Why a number from the organisation's own pages is its desk line, or None.

    A number the website labels as a desk or enquiry line ("Call us", "Speak with our admissions
    team", "Office", "Reception", "Counsellor") or shows on most pages is the front desk's, even
    when a web-search result prints a leader's name next to it (2026-10-25 review: one Instagram
    snippet turned WiNNERS Institute's admissions mobile into a "direct" line to its founder).
    Numbers found only in a search result (found_by) are not desk lines by this rule."""
    if c.get("found_by"):
        return None
    if c.get("kind") == "published_email":
        local = c["value"].lower().partition("@")[0]
        tokens = set(_local_tokens(local)) | {re.sub(r"[._-]", "", local)}
        return "it is a general inbox" if local in GENERIC_LOCAL_PARTS or tokens & _GENERAL_TOKENS else None
    if c.get("kind") not in ("institute_phone", "whatsapp"):
        return None
    if _DESK_RE.search(c.get("context") or ""):
        return "the website labels it as a desk or enquiry line"
    many = max(2, math.ceil(0.75 * pages_read)) if pages_read else 2
    if (c.get("seen_on") or 0) >= many:
        return "the website shows it on most pages"
    return None


def _same_name(a: str, b: str) -> bool:
    def key(name: str) -> str:
        bare = re.sub(r"\([^)]*\)", " ", name.lower())
        return " ".join(w for w in re.findall(r"[a-z]+", bare) if w not in _HONORIFICS)
    return bool(a and b) and key(a) == key(b)


def _is_leader(name: str, leaders: set[str]) -> bool:
    return name in leaders or any(_same_name(name, leader) for leader in leaders)


def _hidden(c: dict[str, Any]) -> bool:
    """Only in a link's code (mailto:, tel:), never shown on the pages read: websites built from a
    copied template can keep another business's email or number this way. Not for contacts found
    by the web lookup, or older leads whose pages were not checked."""
    if c.get("found_by") or c.get("seen_on") != 0:
        return False
    digits = re.sub(r"\D", "", c["value"])[-8:]
    label = c.get("context") or ""
    return c["value"].lower() not in label.lower() and (not digits or digits not in re.sub(r"\D", "", label))


def rate_contact(c: dict[str, Any], *, site_domain: str | None, organisation: str, leaders: set[str],
                 large_chain: bool, region: str | None = None) -> tuple[str, str]:
    """(tier, reason) for one contact route. leaders: names of people whose role can buy.
    region: the site's or run's country code, to spot numbers from another country."""
    kind = c["kind"]
    context = c.get("context") or ""
    person = c.get("person")
    if person:
        who = f"{person['name']} ({person.get('role', '')})"
        how = (f"{person['name']}'s own mailbox (the address matches their name)"
               if c.get("person_match") == "mailbox name" else f"Printed next to {who}")
        if c.get("found_by") or c.get("linked_by"):
            how += f", found by {c.get('found_by') or c.get('linked_by')}"
    if kind == "contact_form":
        return "general", "Enquiry form: answered by the front office"
    # A desk line stays a desk line when a search result names a leader next to it: the leader
    # becomes the person to ask for (merge_lookup stores them as ask_for). Contacts merged before
    # this rule (person + linked_by) are read the same way.
    ask_for = c.get("ask_for")
    if not ask_for and person and c.get("linked_by") and not c.get("found_by") and (
            c.get("desk_line") or site_desk_line(c)):
        ask_for, person = person, None
    ask = ""
    if ask_for and _is_leader(ask_for.get("name") or "", leaders):
        ask = f"ask for {ask_for['name']} ({ask_for.get('role', '')}); a web result shows them with this number"

    if kind == "published_email":
        email = c["value"].lower()
        local, _, domain = email.partition("@")
        tokens = set(_local_tokens(local)) | {local.replace(".", "").replace("-", "").replace("_", "")}
        if c.get("mx") is False:
            return "avoid", "Email domain has no mail server: messages will bounce"
        if tokens & _AVOID_TOKENS or local.startswith(("no-reply", "noreply", "donotreply", "do-not-reply")):
            return "avoid", "Support, HR or accounts inbox: not for sales"
        if re.search(r"design|develop|powered\s+by|website\s+by", context, re.I):
            return "avoid", "Website developer's email, not the organisation's"
        if person:
            if person["name"] in leaders:
                return "direct", how
            return "general", f"{how}; not a decision maker"
        if tokens & _LEADER_TOKENS:
            return "direct", f"A leader's inbox ({local}@)"
        if tokens & _GENERAL_TOKENS:
            if ask:
                return "general", f"General inbox / {ask.replace('this number', 'this address')}"
            return "general", "General inbox: read by the front office"
        own = bool(site_domain) and (domain == site_domain or domain.endswith("." + site_domain))
        if domain in FREE_MAIL:
            if any(w in local for w in org_words(organisation)):
                return "general", "The institute's own Gmail-type inbox: general, often read by the owner"
            if _hidden(c):
                return "avoid", f"{TEMPLATE_LEFTOVER}: another business's email"
            return "likely", "Personal mailbox (Gmail etc.): person not identified"
        if own:
            return "likely", f"Named mailbox ({local}@): person not identified"
        # A sister domain carries the organisation's name (wingsway.org for wingswaytraining.com).
        sister = any(w in domain for w in org_words(organisation) - _NOT_NAME_WORDS if len(w) >= 4)
        if _hidden(c) and not sister:
            return "avoid", f"{TEMPLATE_LEFTOVER}: an email on another domain"
        return "general", "Email on another domain (parent company or group)"

    # Phones and WhatsApp.
    phone_type = c.get("note") or ("mobile" if kind == "whatsapp" else "phone")
    if c.get("fax"):
        return "avoid", "Fax number"
    if is_placeholder(c["value"]):
        return "avoid", "Sample number from the website template, not a real line"
    if person and person["name"] in leaders and phone_type not in ("toll-free", "shared-cost"):
        return "direct", how
    if phone_type in ("toll-free", "shared-cost"):
        return "avoid", "Toll-free or shared-cost number: usually an IVR or call centre"
    if _HELPLINE_RE.search(context):
        return "avoid", "Helpline or support number: usually an IVR or call centre"
    if _HR_RE.search(context):
        return "avoid", "HR or careers number: not for sales"
    if person:
        return "general", f"{how}; not a decision maker"
    number_region = _number_region(c["value"])
    if region and number_region and number_region != region:
        if _hidden(c):
            return "avoid", f"{TEMPLATE_LEFTOVER}: a number in another country ({number_region})"
        return "general", f"A number in another country ({number_region}): a template or partner line"
    if phone_type == "virtual":
        return "general", "Virtual number: often forwards to a call centre"
    if large_chain:
        return "general", "Large chain: website numbers reach a central enquiry desk"
    if phone_type == "landline" or (phone_type == "phone" and _STD_PRINTED.search(context)):
        if ask:
            return "general", f"Desk landline / {ask}"
        return "general", "Landline: usually reception or the front office"
    if phone_type == "mobile":
        if ask:
            return "likely", f"Desk mobile / {ask}"
        if kind == "whatsapp":
            return "likely", "WhatsApp on the website: usually the admissions desk, sometimes the owner"
        if _DESK_RE.search(context) or c.get("seen_on", 0) >= 2:
            return "likely", "Mobile shown as the enquiry number: usually the admissions desk, sometimes the owner"
        return "likely", "Mobile: not linked to a named person"
    return "general", "Phone: line type unknown"


# Mail server check. The engine asked DNS-over-HTTPS from the laptop; the engine library does no
# network I/O, so the caller passes the lookup (domain -> True: has a mail server, False: none or
# the domain does not exist, None: the lookup failed).

MxLookup = Callable[[str], "bool | None"]


def mail_domain_ok(domain: str, lookup: MxLookup | None = None) -> bool | None:
    """True if the domain has a mail server (MX record), False if it has none or does not exist,
    None if unknown. A mailbox itself is never checked: that needs the mail server's cooperation
    and is unreliable. Free-mail domains are known to take mail."""
    domain = domain.lower().strip(".")
    if domain in FREE_MAIL:
        return True
    if lookup is None:
        return None
    return lookup(domain)


def check_mail_domains(contacts: list[dict[str, Any]], lookup: MxLookup | None = None) -> list[dict[str, Any]]:
    """Adds mx (True/False) to each email whose domain could be looked up. Without a lookup only
    free-mail domains are marked, and the contacts are otherwise returned unchanged."""
    out = []
    cache: dict[str, bool | None] = {}
    for c in contacts:
        if c["kind"] == "published_email" and "mx" not in c:
            domain = c["value"].partition("@")[2].lower().strip(".")
            if domain not in cache:
                cache[domain] = mail_domain_ok(domain, lookup)
            if cache[domain] is not None:
                c = {**c, "mx": cache[domain]}
        out.append(c)
    return out


def email_kind(email: str, organisation: str) -> str:
    """For an email list: Organisation inbox (info@, admissions@), Leader's inbox (director@),
    Institute's Gmail (named after the institute), Personal mailbox (another Gmail-type address)
    or Named mailbox (someone@the-institute's-domain)."""
    local, _, domain = email.lower().partition("@")
    tokens = set(_local_tokens(local)) | {local.replace(".", "").replace("-", "").replace("_", "")}
    if tokens & _LEADER_TOKENS:
        return "Leader's inbox"
    if tokens & _GENERAL_TOKENS or local in GENERIC_LOCAL_PARTS:
        return "Organisation inbox"
    if domain in FREE_MAIL:
        return "Institute's Gmail" if any(w in local for w in org_words(organisation)) else "Personal mailbox"
    return "Named mailbox"


def _list_worthy(email: str, site_domain: str | None, organisation: str) -> bool:
    """Not info@gmail.com (a generic name on a free-mail domain is nobody's inbox), and not an address on
    an unrelated company's domain (a website theme's demo address, the developer's): only the
    organisation's own domain, a sister domain carrying its name, or a named free mailbox."""
    local, _, domain = email.lower().partition("@")
    if domain in FREE_MAIL:
        return local not in GENERIC_LOCAL_PARTS and local not in _GENERAL_TOKENS
    if site_domain and (domain == site_domain or domain.endswith("." + site_domain)):
        return True
    return any(w in domain for w in org_words(organisation) - _NOT_NAME_WORDS if len(w) >= 4)


def list_emails(contacts: list[dict[str, Any]], *, site_domain: str | None, organisation: str,
                suppressed: set[str]) -> list[dict[str, Any]]:
    """The emails an email list may use: rated as on a lead (support, HR, careers, no-reply, template
    leftovers and domains without a mail server left out), minus suppressed addresses."""
    found = []
    for c in contacts:
        if c["kind"] != "published_email" or c["value"].lower() in suppressed:
            continue
        quality, note = rate_contact(c, site_domain=site_domain, organisation=organisation, leaders=set(),
                                     large_chain=False)
        if quality == "avoid" or not _list_worthy(c["value"], site_domain, organisation):
            continue
        found.append({"email": c["value"].lower(), "email_type": email_kind(c["value"], organisation),
                      "mx": c.get("mx"), "page_url": c["url"]})
    return found
