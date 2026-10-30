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
  avoid    - toll-free or helpline (usually an IVR), fax, support / HR / careers inboxes, dead domains,
             anything printed for job applications, security reports, complaints or paper submissions
             (unless the organisation's Google Maps listing shows the same number), a website template's
             sample address or number, an email on another organisation's domain (unless the domain
             or the mailbox carries its name, a named person of it is on the address, or the mailbox is
             a leader's title)
Websites rarely print a decision maker's own number, and no mailbox is confirmed to exist: only the
email domain's mail server is checked (check_mail_domains, with an injected MX lookup).

Outreach after delivery is automated (AI calls, WhatsApp, email), so who an address belongs to
matters as much as its tier: email_owner says whose mailbox an address is, send_rank orders
contacts of one tier so the organisation's own email and a mobile of its own country come first, and
reachable says whether a lead has a contact outreach can use (research looks further when it has not).
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
# A helpline, support line or IVR. Grievance and complaint lines are read by _COMPLAINTS_RE below, a
# purpose of the words around the number that the Google Maps listing can overrule (rate_contact).
# "Your browser does not support the audio element" is not a support line (2026-10-29 replay:
# nibmpomaker.com lost the number its Google Maps listing shows to that fallback text).
_HELPLINE_RE = re.compile(
    r"toll[\s-]?free|help[\s-]?line|help[\s-]?desk|customer\s+(?:care|support|service)|(?<!not )(?<!n't )\bsupport\b|"
    r"call\s+cent|\bivr\b|missed\s+call|24\s*[x/×]\s*7", re.I)
# What the words printed around an address or number say it is for, when that is not sales
# (2026-10-29 audit of "Leads for Vacademy": kangarookids.in's only email was its group's cybersecurity@
# inbox, "...security related incident can be reported on this mail id"; kumonglobal.com's was
# "Interested applicants can share their CVs at"; uniraj.ac.in's a conference's "Submission E-Mail").
# Kept narrow on purpose: "career courses", "ALLEN Career Institute", "job-oriented training",
# "placement assistance", "Police Recruitment coaching" and "Admissions" are what institutes sell, and
# used to trip the old HR rule (any "career", "job", "placement" or "recruit").
_JOBS_RE = re.compile(
    r"\bhr\b|human\s+resource|\brecruit(?:ment)?\s+(?:cell|team|department|dept|office)\b|\brecruiters?\b|"
    r"\brecruiting\b|placement\s+(?:cell|office|officer|department|dept|coordinator)|"
    r"training\s*(?:&|and)\s*placement|\bt\s*&\s*p\s+(?:cell|office|officer)\b|\bcareers?\s*[:|–—]|"
    r"\bcareers\s+(?:at|with)\b|\bjobs?\s*[:|–—]|(?<!seat )(?<!seats )\bvacanc(?:y|ies)\b|"
    r"\bjob\s+(?:openings?|applications?)\b|\bcurrent\s+openings?\b|\bwe(?:'re|\s+are)\s+hiring\b|\bnow\s+hiring\b|"
    r"curriculum\s+vitae|\bbio-?data\b|\bcvs\b|\bcvs?\s+(?:to|at)\b|"
    r"\b(?:your|their|his|her|updated|latest|detailed|complete)\s+(?:cv|resume|résumé)s?\b|"
    r"\b(?:send|share|mail|e-?mail|forward|submit|drop)\s+(?:us\s+)?(?:a\s+|the\s+)?(?:cv|resume|résumé)s?\b|"
    r"\bpost\s+applied\s+for\b|\bapply\s+for\s+(?:the\s+|a\s+)?(?:post|position|job|vacanc)|"
    r"\binterested\s+(?:applicants|candidates)\b(?!.{0,60}(?:admission|course|batch|class|enrol))|"
    r"\bapplicants?\s+(?:can|may|should)\s+(?:send|share|mail|e-?mail|forward|submit)", re.I)
_SECURITY_RE = re.compile(
    r"\b(?:cyber\s*)?security[\s-]+(?:related|incidents?|issues?|concerns?|breach\w*|vulnerabilit\w*|team|reports?)\b|"
    r"\bincidents?\b|\bvulnerabilit\w*|responsible\s+disclosure|bug\s+bounty|\bdata\s+breach\w*|\bphishing\b", re.I)
_COMPLAINTS_RE = re.compile(
    r"\bgrievances?\b|\bcomplain(?:t|ts|ed)?\b|\bredressal\b|anti-?ragging|\bombudsman\b", re.I)
# Feedback counts only as the label of a feedback channel ("Feedback e-mail:", "Send your feedback to",
# "For feedback"), and not when the same words offer help, enquiries or contact: a help line that
# mentions feedback is the general line (2026-10-29 replay: vibrantacademy.com lost its only number to
# "...or want to share feedback, our team is ready to assist you. 9116147816").
_FEEDBACK_RE = re.compile(
    r"\bfeedback\s*(?:e-?mail|mail|id\b|address|form|cell|desk|line|number|no\b|[:|/]|"
    r"(?:and|or|&)\s+suggestions?)|"
    r"\b(?:send|share|submit|give|post|write|mail|e-?mail)\s+(?:us\s+)?(?:your\s+|any\s+)?feedback\s+(?:to|at|on)\b|"
    r"\bfor\s+(?:your\s+|any\s+)?feedback\b", re.I)
_HELP_WORDS_RE = re.compile(
    r"\bassist|enquir|inquir|\bquer(?:y|ies)\b|\bquestions?\b|\bcontact\b|\bhelp\s+you\b|\badmissions?\b|"
    r"get\s+in\s+touch|reach\s+(?:us|out)", re.I)
_SUBMISSIONS_RE = re.compile(
    r"\bconferences?\b|\bsymposium\b|\bcall\s+for\s+papers\b|"
    r"\b(?:paper|abstract|manuscript|article)s?\s+submissions?\b|\bsubmissions?\s*(?:e-?mail|mail|id|address|portal|deadline)\b|"
    r"\bsubmit\s+(?:your\s+)?(?:full\s+)?(?:papers?|abstracts?|manuscripts?|articles?)\b|\babstracts?\s+(?:to|at|by|deadline)\b",
    re.I)
_NOT_FOR_SALES = (
    ("job applications", _JOBS_RE),
    ("reporting security incidents", _SECURITY_RE),
    ("complaints or feedback", _COMPLAINTS_RE),
    ("conference or paper submissions", _SUBMISSIONS_RE),
)
# "Designed & developed by XYZ Infotech, xyz@...": the web agency's credit line in the footer. Not any
# "design" or "develop", which threw away design schools' and "Skill Development" institutes' inboxes.
_DEVELOPER_RE = re.compile(
    r"\b(?:designed|developed|maintained|hosted|created|crafted|built)\s+(?:(?:and|&)\s+\w+\s+)?by\b|"
    r"\b(?:design|development)\s+by\b|powered\s+by|website\s+by|\bweb\s*(?:site\s*)?(?:design|develop)\w*\s*(?:by|:|&|and)\b",
    re.I)
# The same credit line before a number, matched narrower: "Study material designed by IIT alumni, call ..."
# or "XYZ Classes powered by ABC Group" print the organisation's own number.
_SITE_CREDIT_RE = re.compile(
    r"\bdesign(?:ed)?\s*(?:&|and|/)\s*develop\w*\s+by\b|\bweb\s*(?:site\s*)?(?:design|develop)\w*\s*(?:by|:|&|and)\b|"
    r"\bwebsite\s+(?:designed|developed|created|built|maintained|by)\b|"
    r"\b(?:developed|maintained|hosted|powered)\s+by\s+[\w&.\- ]{0,30}?\b(?:infotech|infosystems?|technologies|"
    r"solutions|softech|software|web|digital|it\s+services)\b", re.I)
# Addresses a template or site builder prints until someone replaces them (2026-10-29: bharadwajinstitute.com
# showed contact@mysite.com; quantumcoaching.in "Signed in as: filler@godaddy.com").
_TEMPLATE_EMAIL_DOMAIN = re.compile(
    r"^(?:(?:my|your)-?(?:site|domain|website|company|business|email|mail)|example|sample|test|sitename|website|"
    r"company)\.[a-z.]{2,10}$|^example\.|(?:^|\.)(?:godaddy|secureserver|wix|wixpress|squarespace|weebly|webflow|jimdo|"
    r"strikingly|site123|zyro|hostinger)\.(?:com|net|io)$")
_TEMPLATE_LOCALS = {"filler", "test", "testing", "tester", "sample", "dummy", "youremail", "yourmail", "yourname",
                    "your", "email", "username", "name", "someone", "johndoe", "janedoe", "user"}
_SIGNED_IN_RE = re.compile(r"\b(?:signed|logged)\s+in\s+as\b", re.I)
# Sample numbers printed by website templates ("98765 43210").
_PLACEHOLDER_NUMBERS = {"9876543210", "1234567890", "9876501234", "9999999999", "9898989898", "9000000000",
                        "8888888888", "7777777777", "0123456789", "9876598765", "9988776655", "1122334455"}
_SAMPLE_RUNS = ("1234567", "2345678", "3456789", "98765432", "87654321", "76543210")
# "(888) 4567890": the US-style sample a template prints, read as an Indian mobile (2026-10-29:
# artisticschool.biz "Phone: (888) 4567890" was rated a likely +91 88845 67890). Indian area codes keep
# their trunk 0 in brackets ("(079) 26578452", "(022) 2204 1707"), or follow the country code.
_US_STYLE = re.compile(r"\(\s*([1-9]\d{2})\s*\)\s*(\d{3})[\s.-]?(\d{4})(?!\d)")
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
    "cybersecurity", "infosec", "cv", "resume", "resumes", "conference", "submission", "submissions",
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
    # What an organisation teaches or what kind it is, never which one: defence@gmail.com does not carry
    # "Maharana Pratap Defence Academy"'s name (2026-10-29 replay: it was sent instead of the founder's
    # mdadoulatfouji@gmail.com). Institute families ("IIT Delhi", "IIM Indore") are kinds too.
    "defence", "defense", "army", "military", "sainik", "nda", "science", "sciences", "commerce", "arts", "computer",
    "computers", "english", "maths", "math", "mathematics", "physics", "chemistry", "biology", "medical",
    "engineering", "management", "technology", "technical", "skill", "skills", "training", "tuition", "tuitions",
    "tutor", "tutors", "tutorial", "studies", "language", "languages", "institution", "institutions", "university",
    "vidyalaya", "mahavidyalaya", "international", "global", "public", "national", "world", "online", "kids",
    "preschool", "foundation", "trust", "society", "iit", "iim", "nit", "iiit", "aiims",
}


def is_person_name(name: str, organisation: str = "") -> bool:
    """False for "(Managing Director)", "Samyak IAS RAS" (the organisation itself) and the like."""
    bare = re.sub(r"\([^)]*\)", " ", name)
    words = [w for w in re.findall(r"[a-z]+", bare.lower()) if len(w) >= 2 and w not in _HONORIFICS]
    other = org_words(organisation)
    return any(w not in _NOT_NAME_WORDS and w not in other for w in words)


def is_placeholder(number: str) -> bool:
    national = re.sub(r"\D", "", number)[-10:]
    return national in _PLACEHOLDER_NUMBERS or len(set(national)) <= 2 or any(run in national for run in _SAMPLE_RUNS)


def _us_style_sample(c: dict[str, Any], region: str | None) -> bool:
    """On an Indian site, a number the page prints as "(888) 4567890": a template's US sample, not a line."""
    if region != "IN":
        return False
    national = re.sub(r"\D", "", c["value"])[-10:]
    context = c.get("context") or ""
    for match in _US_STYLE.finditer(context):
        if re.search(r"\+?\d{1,3}[\s-]*$", context[:match.start()]):
            continue  # "+91 (141) 2706587": the country code, then the area code
        if "".join(match.groups()) == national:
            return True
    return False


def not_for_sales(context: str) -> str | None:
    """What the words printed around an address or number say it is for, when that is not sales
    ("job applications", "reporting security incidents", ...), else None. Email addresses in the
    words are left out, so "hr-college.edu" or "designacademy.in" is not read as a label."""
    text = EMAIL_RE.sub(" ", context or "")
    purpose = next((purpose for purpose, pattern in _NOT_FOR_SALES if pattern.search(text)), None)
    if purpose is None and _FEEDBACK_RE.search(text) and not _HELP_WORDS_RE.search(text):
        return "complaints or feedback"
    return purpose


def _template_email(local: str, domain: str, context: str) -> bool:
    joined = re.sub(r"[._-]", "", local)
    return bool(_TEMPLATE_EMAIL_DOMAIN.search(domain) or joined in _TEMPLATE_LOCALS or re.fullmatch(r"x{3,}", joined)
                or _SIGNED_IN_RE.search(context))


def _number_region(number: str) -> str | None:
    try:
        return phonenumbers.region_code_for_number(phonenumbers.parse(number, None))
    except phonenumbers.NumberParseException:
        return None


TEMPLATE_LEFTOVER = "Only in a hidden link on the website, probably left over from its template"
# research.py adds the phone on a candidate's Google Maps listing with this found_by, and marks a
# website number with the same last 10 digits maps_confirmed.
MAPS_FOUND_BY = "google_maps"


def maps_listed(c: dict[str, Any]) -> bool:
    """The number is on the organisation's Google Maps listing (added from it, or confirmed by it)."""
    return bool(c.get("maps_confirmed") or c.get("found_by") == MAPS_FOUND_BY)


def site_desk_line(c: dict[str, Any], pages_read: int | None = None) -> str | None:
    """Why a number from the organisation's own pages is its desk line, or None.

    A number the website labels as a desk or enquiry line ("Call us", "Speak with our admissions
    team", "Office", "Reception", "Counsellor") or shows on most pages is the front desk's, even
    when a web-search result prints a leader's name next to it (2026-10-25 review: one Instagram
    snippet turned WiNNERS Institute's admissions mobile into a "direct" line to its founder).
    The number on the organisation's Google Maps listing (added by research, or a website number
    the listing also shows) is its public desk line too: a lookup naming a leader next to it makes
    the leader who to ask for, never a direct line (2026-10-29). Other numbers found only in a
    search result (found_by) are not desk lines by this rule."""
    if c.get("kind") in ("institute_phone", "whatsapp") and maps_listed(c):
        return "it is the number on the organisation's Google Maps listing"
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


# Whose mailbox an address is. Outreach mails it with no person checking first, so an address on the
# organisation's own domain beats an unnamed Gmail that may be anyone's (2026-10-29 audit: 30 delivered
# leads were sent such a Gmail, e.g. iguruji.in@gmail.com for aadharinstitute.com, while
# aadharinstitute@gmail.com was on the same page).
OWNER_RANK = {"own": 0, "sister": 1, "org_free": 1, "org_named": 1, "person": 2, "unknown": 2, "free": 3, "other": 4}
# Owners whose address is the organisation's own mailbox: with a leader's own mailbox (rated direct),
# what makes an email a reachable contact (reachable).
ORG_OWNED = ("own", "sister", "org_free", "org_named")


def _first_label(domain: str) -> str:
    domain = domain.lower().strip(".")
    return (domain[4:] if domain.startswith("www.") else domain).split(".")[0]


def _org_acronym(organisation: str) -> str:
    """"Delhi Public School" -> "dps"; empty for names of fewer than three words."""
    words = [w for w in re.findall(r"[a-z]+", re.sub(r"\([^)]*\)", " ", organisation.lower())) if w not in _ORG_STOPWORDS]
    return "".join(w[0] for w in words) if len(words) >= 3 else ""


def carries_org_name(text: str, organisation: str) -> bool:
    """Whether a mailbox or domain carries the organisation's own name (not "academy", "defence" or
    another word for what it teaches or what kind it is), or starts with its initials."""
    text = text.lower()
    if any(w in text for w in org_words(organisation) - _NOT_NAME_WORDS if len(w) >= 4):
        return True
    acronym = _org_acronym(organisation)
    return len(acronym) >= 3 and re.sub(r"[^a-z0-9]", "", text).startswith(acronym)


def named_after_org(local: str, organisation: str, site_domain: str | None) -> bool:
    """A mailbox named after the organisation on a domain that is not its own (evolvv@techvito.in for
    Evolvv at evolvv.in, aicpe@bizindia.org for AICPE at aicpeindia.org, 2026-10-29 replay: both were
    avoided as another organisation's address): the mailbox carries a word of the organisation's name
    (as carries_org_name reads it: not "academy" or "defence") that its own website's domain carries
    too, or starts with its initials as the domain does; and it is not only a general mailbox word the
    name happens to use ("connect@" for "Connect Classes"). The domain check keeps a place in the name
    out: hostel.nagpur@maharshikarve.org is not "Cummins College Of Engineering For Women, Nagpur"'s
    (cumminscollege.edu.in) own mailbox."""
    label = _first_label(site_domain) if site_domain else ""
    tokens = set(_local_tokens(local)) or {local}
    if not label or tokens <= (_GENERAL_TOKENS | GENERIC_LOCAL_PARTS):
        return False
    local = local.lower()
    if any(w in local and w in label for w in org_words(organisation) - _NOT_NAME_WORDS if len(w) >= 4):
        return True
    acronym = _org_acronym(organisation)
    return len(acronym) >= 3 and re.sub(r"[^a-z0-9]", "", local).startswith(acronym) and label.startswith(acronym)


def _has_org_word(local: str, organisation: str) -> bool:
    """A Gmail-type mailbox named with one of the organisation's own words (three letters or more), not
    a word for what it teaches or what kind it is: what makes it the institute's own inbox for rating."""
    return any(w in local for w in org_words(organisation) - _NOT_NAME_WORDS)


def _initialisms(organisation: str) -> set[str]:
    """Three-letter initialisms the name is written with: "IMS Indore", "GFE Business", "ALS IAS"."""
    return {w.lower() for w in re.findall(r"\b[A-Z]{3}\b", organisation)} - _NOT_NAME_WORDS - _ORG_STOPWORDS


def sister_domain(domain: str, site_domain: str | None, organisation: str) -> bool:
    """A domain carrying the organisation's name or starting with its initials, as carries_org_name
    reads a mailbox (podar.org for podareducation.org, iisdt.in for the "Indian Institute of Skill
    Development Training (IISDT)", bischool.in for "Bangalore International School"), the site's own
    name on another ending (samvedschool.in for samvedschool.com), or a three-letter initialism of the
    name that starts the organisation's own website too (imsindia.com for "IMS Indore" at imsindore.com,
    gfegroup.org for "GFE Business" at gfebusiness.org). 2026-10-29 replay: bischool.in, cisb.org.in,
    imsindia.com, gfegroup.org and alsias.net were avoided as another organisation's."""
    label = _first_label(domain)
    site = _first_label(site_domain) if site_domain else ""
    if len(label) >= 4 and label == site:
        return True
    if carries_org_name(domain, organisation):
        return True
    return bool(site) and any(label.startswith(w) and site.startswith(w) for w in _initialisms(organisation))


# Government mail domains are issued to government offices only: on a government institution's own
# website such an address is the institution's own mailbox.
_GOVERNMENT_MAIL = re.compile(r"(?:^|\.)(?:gov|nic)\.in$")
_GOVERNMENT_NAME = re.compile(r"\b(?:government|govt|rajkiya)\b", re.I)


def government_mail(domain: str, site_domain: str | None, organisation: str) -> bool:
    """A government address (*.gov.in, *.nic.in) on a government institution's site (its own domain is
    a government one, or its name says it is government-run): not another organisation's."""
    if not _GOVERNMENT_MAIL.search(domain.lower()):
        return False
    return bool(site_domain and _GOVERNMENT_MAIL.search(site_domain.lower())) or bool(_GOVERNMENT_NAME.search(organisation))


def _leader_title(local: str) -> bool:
    """The mailbox is named after a leader's title (principal@, director.admissions@, dean-bjmc-ahm@)."""
    tokens = set(_local_tokens(local)) | {re.sub(r"[._-]", "", local)}
    return bool(tokens & _LEADER_TOKENS)


def email_owner(email: str, *, site_domain: str | None, organisation: str,
                person: dict[str, Any] | None = None) -> str:
    """Whose mailbox an address is (OWNER_RANK, best first):
      own      - on the organisation's own domain
      sister   - on a domain carrying its name (sister_domain), or a government address on a
                 government institution's site (government_mail)
      org_free - a Gmail-type address carrying its name (aadharinstitute@gmail.com)
      org_named - a mailbox named after it on another domain (evolvv@techvito.in for Evolvv)
      person   - tied to a named person of the organisation (printed next to them, or their name), or
                 named after a leader's title on another domain (principal@lsr.du.ac.in, the parent
                 university's domain, on lsr.edu.in)
      unknown  - on another domain when the organisation's own domain is not known
      free     - another Gmail-type address: whose it is is unknown
      other    - another organisation's domain (info@iitgroup.in on foreignlanguagestraining.com)"""
    local, _, domain = email.lower().partition("@")
    if site_domain and (domain == site_domain or domain.endswith("." + site_domain)):
        return "own"
    if domain in FREE_MAIL:
        # Rated the institute's own Gmail (_has_org_word) is owned as one too (2026-10-29 replay:
        # tcsacademylko@gmail.com, named with "TCS", lost to another Gmail once "academy" stopped counting).
        if carries_org_name(local, organisation) or _has_org_word(local, organisation):
            return "org_free"
        return "person" if person else "free"
    if sister_domain(domain, site_domain, organisation) or government_mail(domain, site_domain, organisation):
        return "sister"
    if named_after_org(local, organisation, site_domain):
        return "org_named"
    if person or _leader_title(local):
        return "person"
    return "other" if site_domain else "unknown"


def _line_type(value: str, region: str | None) -> str:
    """mobile | landline | toll-free | shared-cost | virtual | phone (unknown), as extraction notes it."""
    try:
        return _PHONE_TYPES.get(phonenumbers.number_type(phonenumbers.parse(value, region or DEFAULT_REGION)), "phone")
    except phonenumbers.NumberParseException:
        return "phone"


def is_home_number(c: dict[str, Any], region: str | None = None) -> bool:
    """Whether a phone contact is a number of the lead's own country (region; a number written without
    a country code is read as one). An unreadable number is not called foreign."""
    home = region or DEFAULT_REGION
    try:
        number = phonenumbers.parse(c.get("value") or "", home)
    except phonenumbers.NumberParseException:
        return True
    return phonenumbers.region_code_for_number(number) in (None, "ZZ", home)


def is_mobile(c: dict[str, Any], region: str | None = None) -> bool:
    """Whether a phone contact is a mobile for this lead (WhatsApp and a call both work): a WhatsApp
    link, a number typed as mobile when it was read, or, for one without a type (a Google Maps
    listing), the number's own type. Only a number of the lead's own country (region) counts: outreach
    calls from there (2026-10-29 replay: talentresourze.com's US "+1 (347) 353-1469" counted as a
    mobile on an Indian lead)."""
    home = region or DEFAULT_REGION
    try:
        number = phonenumbers.parse(c.get("value") or "", home)
    except phonenumbers.NumberParseException:
        number = None
    if number is not None and not is_home_number(c, home):
        return False
    if c.get("kind") == "whatsapp" or c.get("note") == "mobile":
        return True
    if c.get("note") in ("landline", "toll-free", "shared-cost", "virtual") or number is None:
        return False
    return phonenumbers.number_type(number) in (phonenumbers.PhoneNumberType.MOBILE,
                                                phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE)


def send_rank(c: dict[str, Any], region: str | None = None) -> int:
    """Within one tier and kind, which contact to use first (0 = first): an email the organisation owns
    (its "owner", set by rating) before an unnamed Gmail; a number of the lead's own country before a
    foreign one (2026-10-29 replay: mygreatlearning.com was sent "+1 512-647-2647" over its Bengaluru
    landline, both "general"), then a mobile before a landline, and within each one Google Maps also
    lists first."""
    if c.get("kind") == "published_email":
        return OWNER_RANK.get(c.get("owner") or "unknown", 2)
    if c.get("kind") in ("institute_phone", "whatsapp"):
        return ((0 if is_home_number(c, region) else 4) + (0 if is_mobile(c, region) else 2)
                + (0 if maps_listed(c) else 1))
    return 0


def reachable(c: dict[str, Any]) -> bool:
    """A contact automated outreach can use for this organisation (rated, not avoided, not a form): a
    phone or WhatsApp, or an email the organisation owns (ORG_OWNED: its own domain, a sister domain, a
    Gmail or another domain's mailbox named after it) or a leader's own mailbox (rated direct). An
    unnamed Gmail may be anyone's: usable, but not proof the organisation can be reached (2026-10-29)."""
    if c.get("kind") == "contact_form" or c.get("quality") in (None, "avoid"):
        return False
    if c.get("kind") in ("institute_phone", "whatsapp"):
        return True
    return c.get("kind") == "published_email" and (c.get("owner") in ORG_OWNED or c.get("quality") == "direct")


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
    # this rule (person + linked_by) are read the same way, the Google Maps listing's number included.
    ask_for = c.get("ask_for")
    if not ask_for and person and c.get("linked_by") and (not c.get("found_by") or maps_listed(c)) and (
            c.get("desk_line") or site_desk_line(c)):
        ask_for, person = person, None
    ask = ""
    if ask_for and _is_leader(ask_for.get("name") or "", leaders):
        ask = f"ask for {ask_for['name']} ({ask_for.get('role', '')}); a web result shows them with this number"

    if kind == "published_email":
        email = c["value"].lower()
        local, _, domain = email.partition("@")
        tokens = set(_local_tokens(local)) | {local.replace(".", "").replace("-", "").replace("_", "")}
        if _template_email(local, domain, context):
            return "avoid", "Placeholder from the website template"
        if c.get("mx") is False:
            return "avoid", "Email domain has no mail server: messages will bounce"
        # A leader's own mailbox reaches the buyer whatever the line around it asks people to send.
        leaders_box = bool(person and person["name"] in leaders) or bool(tokens & _LEADER_TOKENS)
        purpose = None if leaders_box else not_for_sales(context)
        if purpose:
            return "avoid", f"Printed for {purpose}: not for sales"
        if tokens & _AVOID_TOKENS or local.startswith(("no-reply", "noreply", "donotreply", "do-not-reply")):
            return "avoid", "Support, HR or accounts inbox: not for sales"
        if _DEVELOPER_RE.search(EMAIL_RE.sub(" ", context)):
            return "avoid", "Website developer's email, not the organisation's"
        owner = email_owner(email, site_domain=site_domain, organisation=organisation, person=person)
        # An address on an unrelated domain is a group office's, a partner's or a template's: kept only
        # when the domain or the mailbox carries the organisation's name, a named person of it is on the
        # address, or the mailbox is a leader's title (2026-10-29: info@iitgroup.in was delivered for
        # foreignlanguagestraining.com; the replay then lost principal@lsr.du.ac.in for lsr.edu.in and
        # dean-bjmc-ahm@gujarat.gov.in for bjmcabd.edu.in to this rule).
        if owner == "other":
            return "avoid", "Email on another organisation's domain"
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
            if _has_org_word(local, organisation):
                return "general", "The institute's own Gmail-type inbox: general, often read by the owner"
            if _hidden(c):
                return "avoid", f"{TEMPLATE_LEFTOVER}: another business's email"
            return "likely", "Personal mailbox (Gmail etc.): person not identified"
        if own:
            return "likely", f"Named mailbox ({local}@): person not identified"
        # A sister domain carries the organisation's name (wingsway.org for wingswaytraining.com).
        if owner == "sister":
            if government_mail(domain, site_domain, organisation):
                return "general", "Email on a government domain: the institution is government-run"
            return "general", "Email on a sister domain carrying the organisation's name"
        if _hidden(c):
            return "avoid", f"{TEMPLATE_LEFTOVER}: an email on another domain"
        if owner == "org_named":
            return "general", f"Email on another domain, named after the organisation ({local}@)"
        return "general", "Email on another domain (parent company or group)"

    # Phones and WhatsApp. A number added without a type (a Google Maps listing) is typed from itself.
    phone_type = c.get("note") or ("mobile" if kind == "whatsapp" else _line_type(c["value"], region))
    if c.get("fax"):
        return "avoid", "Fax number"
    if is_placeholder(c["value"]):
        return "avoid", "Sample number from the website template, not a real line"
    if _us_style_sample(c, region):
        return "avoid", "Sample number from the website template (printed like a US number), not a real line"
    # The number the organisation's Google Maps listing shows is its business line: what the website
    # prints around it (feedback, careers, a web agency's credit) does not make it another line. A
    # helpline, toll-free, fax or template sample number stays avoided even when Google lists it
    # (2026-10-29 replay: vibrantacademy.com lost the only number, the one Google lists, to "share feedback").
    listed = maps_listed(c)
    # A search result's words are not a footer: only the pages' own credit line counts here.
    if not c.get("found_by") and not listed and _SITE_CREDIT_RE.search(EMAIL_RE.sub(" ", context)):
        return "avoid", "Website developer's number, not the organisation's"
    if person and person["name"] in leaders and phone_type not in ("toll-free", "shared-cost"):
        return "direct", how
    if phone_type in ("toll-free", "shared-cost"):
        return "avoid", "Toll-free or shared-cost number: usually an IVR or call centre"
    if _HELPLINE_RE.search(context):
        return "avoid", "Helpline or support number: usually an IVR or call centre"
    purpose = None if listed else not_for_sales(context)
    if purpose == "job applications":
        return "avoid", "HR or careers number: not for sales"
    if purpose:
        return "avoid", f"Printed for {purpose}: not for sales"
    if person:
        return "general", f"{how}; not a decision maker"
    number_region = _number_region(c["value"])
    if region and number_region and number_region != region:
        if _hidden(c):
            return "avoid", f"{TEMPLATE_LEFTOVER}: a number in another country ({number_region})"
        return "general", f"A number in another country ({number_region}): a template or partner line"
    if phone_type == "virtual":
        return "general", "Virtual number: often forwards to a call centre"
    # A Maps listing is one place's own: its mobile reaches that centre, even when the website has a
    # toll-free line or names many branches (2026-10-29).
    if large_chain and not (phone_type == "mobile" and maps_listed(c)):
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
        if maps_listed(c):
            return "likely", "Mobile on the Google Maps listing: usually the front desk, sometimes the owner"
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
        return "Institute's Gmail" if _has_org_word(local, organisation) else "Personal mailbox"
    return "Named mailbox"


def _list_worthy(email: str, site_domain: str | None, organisation: str) -> bool:
    """Not info@gmail.com (a generic name on a free-mail domain is nobody's inbox), and not an address on
    an unrelated company's domain (a website theme's demo address, the developer's): only the
    organisation's own domain, a sister domain carrying its name, a mailbox named after it, or a named
    free mailbox."""
    local, _, domain = email.lower().partition("@")
    if domain in FREE_MAIL:
        return local not in GENERIC_LOCAL_PARTS and local not in _GENERAL_TOKENS
    if site_domain and (domain == site_domain or domain.endswith("." + site_domain)):
        return True
    return (sister_domain(domain, site_domain, organisation) or government_mail(domain, site_domain, organisation)
            or named_after_org(local, organisation, site_domain))


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
