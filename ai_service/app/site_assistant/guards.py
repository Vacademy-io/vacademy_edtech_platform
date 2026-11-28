"""Checks that run without the model, and the post-check every answer passes.

Pre-model (no LLM call, never billed):
  * text validation (empty / too long);
  * distress words → a fixed caring reply;
  * blatant prompt-extraction / jailbreak attempts → a fixed short refusal.

Post-check (the answer as it streams):
  * a link survives only if it came from a tool result, a card or the site
    itself — anything the model made up is reduced to its text;
  * a price survives only if that amount appeared in a tool result;
  * markdown images and raw HTML are removed;
  * the visitor's own email addresses / phone numbers are never echoed;
  * the "[[unanswered]]" marker the model adds when it has no source is taken
    out and turned into answered=false.

Streaming and post-checking are reconciled by holding back the tail of the
buffer that could still be the start of a link, an amount or a marker.
"""
from __future__ import annotations

import re
from typing import Iterable, List, Optional, Set
from urllib.parse import urlsplit

from .settings import MAX_TEXT_CHARS

# ── language ──────────────────────────────────────────────────────────────

_DEVANAGARI = re.compile(r"[\u0900-\u097F]")


def language_of(text: str) -> str:
    return "hi" if _DEVANAGARI.search(text or "") else "en"


# ── input validation ──────────────────────────────────────────────────────

def clean_text(text: object) -> Optional[str]:
    """The visitor's message, whitespace-normalised, or None when empty / too long."""
    if not isinstance(text, str):
        return None
    t = "".join(ch for ch in text if ch == "\n" or ch == "\t" or ord(ch) >= 32).strip()
    t = re.sub(r"[ \t]+", " ", t)
    if not t or len(t) > MAX_TEXT_CHARS:
        return None
    return t


# ── distress ──────────────────────────────────────────────────────────────

_DISTRESS_RE = re.compile(
    r"(kill\s+my\s*self|suicid|want\s+to\s+die|end\s+(my|it\s+all)\s*life|end\s+it\s+all|self[\s-]?harm|"
    r"hurt\s+my\s*self|no\s+reason\s+to\s+live|"
    r"आत्महत्या|मर\s+जाना\s+चाहत|जीना\s+नहीं\s+चाहत|खुद\s+को\s+नुकसान)",
    re.IGNORECASE,
)

DISTRESS_REPLY = {
    "en": ("I'm really sorry you're going through this, and I'm glad you said something. "
           "Please reach out to someone you trust today. In India you can call **Tele-MANAS on 14416** "
           "(free, any time). If you are in danger right now, please call your local emergency number."),
    "hi": ("मुझे बहुत दुख है कि आप इससे गुज़र रहे हैं, और अच्छा किया कि आपने बताया। "
           "कृपया आज ही किसी भरोसेमंद व्यक्ति से बात करें। भारत में आप **Tele-MANAS 14416** पर कॉल कर सकते हैं "
           "(मुफ़्त, किसी भी समय)। अगर आप अभी खतरे में हैं, तो तुरंत आपातकालीन नंबर पर कॉल करें।"),
}


def is_distress(text: str) -> bool:
    return bool(_DISTRESS_RE.search(text or ""))


# ── abuse / prompt extraction ─────────────────────────────────────────────

_INJECTION_RE = re.compile(
    r"(ignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)?\s*(instructions|rules|prompts?)|"
    r"disregard\s+(all\s+|your\s+|the\s+)?(previous\s+|prior\s+)?(instructions|rules)|"
    r"(reveal|show|print|repeat|output|tell\s+me)\s+(me\s+)?(your|the)\s+(system\s+|hidden\s+|initial\s+)?(prompt|instructions)|"
    r"system\s+prompt|developer\s+mode|jail\s?break|\bDAN\b\s+mode|act\s+as\s+(an?\s+)?unrestricted|"
    r"pretend\s+(that\s+)?you\s+(have\s+)?no\s+(rules|restrictions))",
    re.IGNORECASE,
)

ABUSE_REPLY = {
    "en": "I can't help with that. I'm here to answer questions about our courses, classes and this website.",
    "hi": "मैं इसमें मदद नहीं कर सकता। मैं हमारे कोर्स, क्लास और इस वेबसाइट से जुड़े सवालों के जवाब देने के लिए हूँ।",
}


def is_injection_attempt(text: str) -> bool:
    return bool(_INJECTION_RE.search(text or ""))


# ── sensitive advice (answered, but framed) ───────────────────────────────

_MEDICAL_RE = re.compile(
    r"\b(pregnan\w*|trimester|miscarriage|medicine|medication|dosage|dose|tablet|symptom\w*|disease|diagnos\w*|"
    r"treatment|cure|doctor|blood\s+pressure|diabetes|thyroid|pcos|pcod|depress\w*|anxiety|ayurved\w*\s+remed\w*|"
    r"herb\w*\s+for)\b|गर्भ|दवा|बीमारी|इलाज",
    re.IGNORECASE,
)
_LEGAL_FIN_RE = re.compile(
    r"\b(lawsuit|sue|legal\s+advice|lawyer|court|invest\w*|stock\s+tip|mutual\s+fund|tax\s+saving|loan\s+advice)\b",
    re.IGNORECASE,
)

MEDICAL_NOTE = {"en": "_This is general information, not medical advice. Please consult a qualified doctor._",
                "hi": "_यह सामान्य जानकारी है, चिकित्सा सलाह नहीं। कृपया किसी योग्य डॉक्टर से सलाह लें।_"}
LEGAL_FIN_NOTE = {"en": "_This is general information, not professional advice. Please consult a qualified professional._",
                  "hi": "_यह सामान्य जानकारी है, पेशेवर सलाह नहीं। कृपया किसी योग्य विशेषज्ञ से सलाह लें।_"}
_FRAMED_RE = re.compile(r"(not\s+(medical|professional|legal|financial)\s+advice|consult\s+(a|your)\s+"
                        r"(qualified\s+)?(doctor|professional|lawyer|advisor|expert)|चिकित्सा\s+सलाह\s+नहीं|डॉक्टर\s+से)",
                        re.IGNORECASE)


def sensitive_kind(text: str) -> Optional[str]:
    if _MEDICAL_RE.search(text or ""):
        return "medical"
    if _LEGAL_FIN_RE.search(text or ""):
        return "legal_financial"
    return None


def framing_note(kind: Optional[str], answer: str, lang: str) -> Optional[str]:
    """The disclaimer to append when the answer did not frame itself."""
    if not kind or _FRAMED_RE.search(answer or ""):
        return None
    table = MEDICAL_NOTE if kind == "medical" else LEGAL_FIN_NOTE
    return table.get(lang, table["en"])


# ── visitor PII ───────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s-]{7,}\d)")


def visitor_pii(texts: Iterable[str]) -> Set[str]:
    """Emails and phone-number digit strings the visitor typed."""
    out: Set[str] = set()
    for t in texts:
        for m in _EMAIL_RE.findall(t or ""):
            out.add(m.lower())
        for m in _PHONE_RE.findall(t or ""):
            digits = re.sub(r"\D", "", m)
            if len(digits) >= 8:
                out.add(digits)
    return out


# ── answer post-check ─────────────────────────────────────────────────────

UNANSWERED_MARKER = "[[unanswered]]"
_MARKER_RE = re.compile(r"\[\[\s*unanswered\s*\]\]", re.IGNORECASE)
_DONT_KNOW_RE = re.compile(
    r"(I\s+don['’]t\s+have\s+(that|this|those|any)\s+(detail|information|info)|I\s+couldn['’]t\s+find|"
    r"I\s+(do\s+not|don['’]t)\s+know|isn['’]t\s+(something\s+)?I\s+can\s+find|"
    r"मेरे\s+पास\s+(यह|इसकी)\s+जानकारी\s+नहीं)",
    re.IGNORECASE,
)
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)\s]*)(?:\s+\"[^\"]*\")?\)")
_URL_RE = re.compile(r"(?:https?|ftp|javascript|data):[^\s<>()\[\]\"']+", re.IGNORECASE)
_HTML_RE = re.compile(r"</?[A-Za-z][^>]*>")
_AMOUNT_RE = re.compile(r"(₹|Rs\.?|INR|USD|US\$|\$|€|£)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:/-|rupees|INR\b)",
                        re.IGNORECASE)
_TRAILING_PUNCT = ".,;:!?)'\""


def _norm_url(u: str) -> str:
    return u.rstrip(_TRAILING_PUNCT).rstrip("/").lower()


def _norm_amount(raw: str) -> str:
    s = raw.replace(",", "")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def amounts_in(text: str) -> Set[str]:
    """Every number in a tool result, normalised (so '4,999' and '4999.0' match)."""
    return {_norm_amount(m) for m in re.findall(r"\d[\d,]*(?:\.\d+)?", text or "")}


def urls_in(text: str) -> Set[str]:
    return {_norm_url(u) for u in re.findall(r"https://[^\s<>()\[\]\"']+", text or "")}


def relative_paths_in(text: str) -> Set[str]:
    return {p.rstrip(_TRAILING_PUNCT).rstrip("/") or "/" for p in re.findall(r"(?<![\w:/])(/[A-Za-z0-9][^\s\"'<>()\[\]]*)", text or "")}


class AnswerPolicy:
    """What an answer may contain: the links, paths and amounts tools returned."""

    def __init__(self, *, site_hosts: Iterable[str] = (), pii: Iterable[str] = ()):
        self.urls: Set[str] = set()
        self.paths: Set[str] = set()
        # Links a card shown with this answer already carries (as its button):
        # dropped from the text, which only says what to tap.
        self.card_urls: Set[str] = set()
        self.amounts: Set[str] = set()
        self.hosts: Set[str] = {h.lower() for h in site_hosts if h}
        self.pii: Set[str] = set(pii)

    def learn(self, text: str) -> None:
        """Absorb a tool result / card so its links and figures become allowed."""
        self.urls |= urls_in(text)
        self.paths |= relative_paths_in(text)
        self.amounts |= amounts_in(text)

    def carded(self, card_json: str) -> None:
        self.card_urls |= urls_in(card_json)
        self.card_urls |= relative_paths_in(card_json)

    def on_card(self, url: str) -> bool:
        u = url.rstrip(_TRAILING_PUNCT)
        if u.startswith("/") and not u.startswith("//"):
            return (u.rstrip("/") or "/") in self.card_urls
        return _norm_url(u) in self.card_urls

    def url_allowed(self, url: str) -> bool:
        u = url.rstrip(_TRAILING_PUNCT)
        if u.startswith("/") and not u.startswith("//"):
            return (u.rstrip("/") or "/") in self.paths
        if not u.lower().startswith("https://"):
            return False
        if _norm_url(u) in self.urls:
            return True
        try:
            host = (urlsplit(u).hostname or "").lower()
        except ValueError:
            return False
        return bool(host) and host in self.hosts

    def amount_allowed(self, raw_number: str) -> bool:
        return _norm_amount(raw_number) in self.amounts

    def _scrub_pii(self, text: str) -> str:
        if not self.pii:
            return text

        def email_sub(m: re.Match) -> str:
            return "your email" if m.group(0).lower() in self.pii else m.group(0)

        def phone_sub(m: re.Match) -> str:
            return "your number" if re.sub(r"\D", "", m.group(0)) in self.pii else m.group(0)

        text = _EMAIL_RE.sub(email_sub, text)
        return _PHONE_RE.sub(phone_sub, text)

    def sanitize(self, text: str) -> str:
        t = _MARKER_RE.sub("", text)
        t = _MD_IMAGE_RE.sub("", t)

        def link_sub(m: re.Match) -> str:
            label, href = m.group(1), m.group(2)
            return m.group(0) if self.url_allowed(href) and not self.on_card(href) else label

        t = _MD_LINK_RE.sub(link_sub, t)
        t = _HTML_RE.sub("", t)

        def url_sub(m: re.Match) -> str:
            url = m.group(0)
            trail = ""
            while url and url[-1] in _TRAILING_PUNCT:
                trail = url[-1] + trail
                url = url[:-1]
            return (url + trail) if self.url_allowed(url) and not self.on_card(url) else trail

        # Bare URLs (a markdown link's href was handled above and is kept as "(…)").
        parts = re.split(r"(\]\([^)]*\))", t)
        t = "".join(p if p.startswith("](") else _URL_RE.sub(url_sub, p) for p in parts)

        def amount_sub(m: re.Match) -> str:
            number = m.group(2) or m.group(3) or ""
            return m.group(0) if self.amount_allowed(number) else "the price shown on the course page"

        t = _AMOUNT_RE.sub(amount_sub, t)
        return self._scrub_pii(t)


def says_unanswered(text: str) -> bool:
    return bool(_MARKER_RE.search(text or "") or _DONT_KNOW_RE.search(text or ""))


_CUR = r"(?:₹|Rs\.?|INR|USD|US\$|\$|€|£)"
_HOLD_TAIL_RE = re.compile(
    rf"(?:{_CUR}\s?)?\+?\d[\d,.\-]*(?:[ \-]\+?\d[\d,.\-]*)*\s*$|(?:{_CUR}|\+)\s*$", re.IGNORECASE)


def _bracket_open(head: str) -> int:
    """Index of a '[' whose markdown link / marker is not finished yet, else -1."""
    i = head.rfind("[")
    if i == -1:
        return -1
    seg = head[i:]
    j = seg.find("]")
    if j == -1:
        return i - 1 if i > 0 and head[i - 1] == "[" else i
    if seg[j:j + 2] == "](":
        return -1 if seg.find(")", j) != -1 else i
    return -1


class StreamSanitizer:
    """Feeds model tokens through AnswerPolicy.sanitize without splitting a
    link, an amount, a phone number or the unanswered marker across chunks."""

    def __init__(self, policy: AnswerPolicy, max_words: int = 220):
        self.policy = policy
        self.buffer = ""
        self.raw = ""
        self.emitted: List[str] = []
        self.max_words = max_words
        self.words = 0
        self.truncated = False

    def _safe_cut(self) -> int:
        buf = self.buffer
        cut = max(buf.rfind(" "), buf.rfind("\n"))
        if cut <= 0:
            return 0
        head = buf[:cut]
        # an unfinished markdown link / marker: hold from its '['
        open_b = _bracket_open(head)
        if open_b != -1:
            return open_b
        # an amount / phone number that may continue in the next chunk
        m = _HOLD_TAIL_RE.search(head)
        if m:
            return m.start()
        return cut + 1

    def _emit(self, text: str) -> str:
        if self.truncated or not text:
            return ""
        out = self.policy.sanitize(text)
        n = len(out.split())
        if self.words + n > self.max_words:
            keep = self.max_words - self.words
            out = " ".join(out.split()[:max(keep, 0)]) + "…"
            self.truncated = True
        self.words += n
        self.emitted.append(out)
        return out

    def push(self, chunk: str) -> str:
        self.raw += chunk
        self.buffer += chunk
        cut = self._safe_cut()
        if cut <= 0:
            return ""
        head, self.buffer = self.buffer[:cut], self.buffer[cut:]
        return self._emit(head)

    def finish(self) -> str:
        rest, self.buffer = self.buffer, ""
        return self._emit(rest)

    @property
    def text(self) -> str:
        return "".join(self.emitted).strip()


def split_reply(text: str, size: int = 40) -> List[str]:
    """A canned reply cut into token-sized pieces (same event shape as the model)."""
    words = re.split(r"(\s+)", text)
    out, cur = [], ""
    for w in words:
        cur += w
        if len(cur) >= size:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


def words_for_search(text: str) -> List[str]:
    stop = {"the", "a", "an", "is", "are", "do", "you", "your", "have", "has", "of", "for", "to", "in", "on",
            "and", "or", "what", "which", "how", "can", "i", "me", "my", "we", "it", "this", "that", "any",
            "there", "with", "about", "tell", "please", "kya", "hai", "ka", "ki", "ke", "me", "mein"}
    words = [w for w in re.findall(r"[\w\u0900-\u097F]{3,}", (text or "").lower()) if w not in stop]
    seen: List[str] = []
    for w in words:
        if w not in seen:
            seen.append(w)
    return seen[:6]


__all__ = [
    "language_of", "clean_text", "is_distress", "DISTRESS_REPLY", "is_injection_attempt", "ABUSE_REPLY",
    "sensitive_kind", "framing_note", "visitor_pii", "AnswerPolicy", "StreamSanitizer", "says_unanswered",
    "UNANSWERED_MARKER", "split_reply", "words_for_search", "amounts_in", "urls_in",
]
