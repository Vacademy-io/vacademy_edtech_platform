"""Cards the widget renders natively (SPEC §4.4).

Every card is a JSON object ``{"type": <card type>, ...fields}`` (``type`` because
the contact_form card has its own ``kind`` field, SALES|SUPPORT). Builders take
Catalogue API / tool data and produce the stored shape; ``normalize`` is the
last gate before a card is stored or streamed: unknown kinds are dropped,
strings are capped, and every href must be https or site-relative — anything
else (javascript:, data:, protocol-relative, http:) is removed.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

KINDS = ("course", "course_list", "compare", "path", "page_link", "live_class_list", "notice",
         "contact_info", "contact_form")
FIELD_TYPES = ("text", "email", "phone", "number", "dropdown", "textarea", "date", "checkbox")
_MAX_ITEMS = 6
_CURRENCY = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "AED": "AED ", "SGD": "S$", "AUD": "A$", "CAD": "C$"}


def safe_href(value: Any) -> Optional[str]:
    """An https URL or a site-relative path; everything else is refused."""
    if not isinstance(value, str):
        return None
    href = value.strip()
    if not href or any(c.isspace() or ord(c) < 32 for c in href) or "\\" in href:
        return None
    if href.startswith("/") and not href.startswith("//"):
        return href[:1000]
    if href.lower().startswith("https://") and len(href) > len("https://"):
        return href[:1000]
    return None


def _t(value: Any, cap: int = 200) -> Optional[str]:
    if value is None or isinstance(value, (dict, list)):
        return None
    s = " ".join(str(value).split())
    return s[:cap] if s else None


def _strs(values: Any, cap: int = 40, limit: int = 8) -> List[str]:
    out: List[str] = []
    for v in values if isinstance(values, list) else []:
        if isinstance(v, dict):
            v = v.get("label") or v.get("name") or v.get("chip") or v.get("key") or v.get("code")
        s = _t(v, cap)
        if s and s not in out:
            out.append(s)
        if len(out) >= limit:
            break
    return out


# ── prices ────────────────────────────────────────────────────────────────

def format_amount(amount: Any, currency: Optional[str]) -> Optional[str]:
    try:
        value = float(amount)
    except (TypeError, ValueError):
        return None
    cur = (currency or "INR").upper()
    symbol = _CURRENCY.get(cur, f"{cur} ")
    whole = abs(value - round(value)) < 0.005
    if cur == "INR" and whole:
        n = str(int(round(value)))
        if len(n) > 3:
            head, tail = n[:-3], n[-3:]
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            if head:
                groups.insert(0, head)
            n = ",".join(groups + [tail])
        return f"{symbol}{n}"
    return f"{symbol}{value:,.0f}" if whole else f"{symbol}{value:,.2f}"


def price_label(course: Dict[str, Any]) -> Optional[str]:
    """What the site itself would show for this course's price; None when hidden."""
    if not course.get("price_visible"):
        return None
    price = course.get("price")
    if not isinstance(price, dict):
        return None
    if price.get("is_free"):
        return "Free"
    if price.get("varies") and price.get("min_amount") is not None:
        label = format_amount(price.get("min_amount"), price.get("currency"))
        return f"From {label}" if label else None
    return format_amount(price.get("amount"), price.get("currency"))


# ── builders ──────────────────────────────────────────────────────────────

def course_card(c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(c, dict) or not c.get("title"):
        return None
    card: Dict[str, Any] = {
        "type": "course",
        "id": _t(c.get("id"), 64),
        "title": _t(c.get("title")),
        "subtitle": _t(c.get("subtitle"), 300),
        "image_url": safe_href(c.get("image_url")),
        "price_label": price_label(c),
        "url": safe_href(c.get("url")),
        "badges": _strs(c.get("badges")),
        "languages": _strs(c.get("languages")),
        "format_labels": _strs(c.get("formats")),
        "availability": _t(c.get("availability"), 40),
    }
    cs = c.get("coming_soon")
    if isinstance(cs, dict) and cs.get("notify_campaign_id"):
        card["notify_campaign_id"] = _t(cs.get("notify_campaign_id"), 64)
    return card


def course_list_card(courses: List[Dict[str, Any]], more_url: Optional[str] = None) -> Optional[Dict[str, Any]]:
    items = [x for x in (course_card(c) for c in courses or []) if x][:4]
    if not items:
        return None
    card: Dict[str, Any] = {"type": "course_list", "items": items}
    if safe_href(more_url):
        card["more_url"] = safe_href(more_url)
    return card


def _duration(c: Dict[str, Any]) -> Optional[str]:
    m = c.get("duration_minutes")
    if not isinstance(m, (int, float)) or m <= 0:
        return None
    return f"{int(m)} min" if m < 120 else f"{round(m / 60, 1):g} h"


def compare_card(courses: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    cs = [c for c in courses if isinstance(c, dict) and c.get("title")][:3]
    if len(cs) < 2:
        return None
    rows = [
        {"label": "Price", "values": [price_label(c) or "See course page" for c in cs]},
        {"label": "Format", "values": [", ".join(_strs(c.get("formats"))) or "—" for c in cs]},
        {"label": "Language", "values": [", ".join(_strs(c.get("languages"))) or "—" for c in cs]},
        {"label": "Level", "values": [_t(c.get("level"), 60) or "—" for c in cs]},
        {"label": "Duration", "values": [_duration(c) or "—" for c in cs]},
        {"label": "Availability", "values": [_t(c.get("availability"), 40) or "—" for c in cs]},
    ]
    return {"type": "compare", "rows": rows, "courses": [x for x in (course_card(c) for c in cs) if x]}


def path_card(path: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    steps = []
    for s in path.get("steps") or []:
        course = s.get("course") if isinstance(s, dict) else None
        if not isinstance(course, dict) or not course.get("title"):
            continue
        steps.append({"position": int(s.get("position") or len(steps) + 1), "title": _t(course.get("title")),
                      "url": safe_href(course.get("url")), "price_label": price_label(course)})
    if not steps:
        return None
    return {"type": "path", "name": _t(path.get("name")) or "Learning path", "steps": steps[:12]}


def page_link_card(title: Any, href: Any, section_id: Any = None, snippet: Any = None) -> Optional[Dict[str, Any]]:
    h = safe_href(href)
    t = _t(title, 120)
    if not h or not t:
        return None
    card: Dict[str, Any] = {"type": "page_link", "title": t, "href": h}
    if _t(section_id, 128):
        card["section_id"] = _t(section_id, 128)
    if _t(snippet, 240):
        card["snippet"] = _t(snippet, 240)
    return card


def live_class_card(sessions: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    items = []
    for s in sessions or []:
        if not isinstance(s, dict) or not s.get("title"):
            continue
        reg = safe_href(s.get("registration_url"))
        if s.get("is_paid"):
            label = format_amount(s.get("price"), s.get("currency")) if s.get("price") is not None else "Paid"
        else:
            label = "Free"
        items.append({"title": _t(s.get("title")), "starts_at": _t(s.get("starts_at"), 40),
                      "ends_at": _t(s.get("ends_at"), 40), "timezone": _t(s.get("timezone"), 64),
                      "is_paid": bool(s.get("is_paid")), "price_label": label, "registration_url": reg})
    if not items:
        return None
    return {"type": "live_class_list", "items": items[:_MAX_ITEMS]}


def notice_card(n: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not n.get("title"):
        return None
    card = {"type": "notice", "title": _t(n.get("title")), "body": _t(n.get("body"), 600)}
    if n.get("ends_at"):
        card["ends_at"] = _t(n.get("ends_at"), 40)
    return card


def contact_info_card(*, email=None, phone=None, whatsapp=None, address=None, login_url=None) -> Optional[Dict[str, Any]]:
    card: Dict[str, Any] = {"type": "contact_info"}
    for k, v, cap in (("email", email, 200), ("phone", phone, 40), ("whatsapp", whatsapp, 40), ("address", address, 300)):
        if _t(v, cap):
            card[k] = _t(v, cap)
    if safe_href(login_url):
        card["login_url"] = safe_href(login_url)
    return card if len(card) > 1 else None


def contact_form_card(*, kind: str, reason: str, campaign_id: Optional[str], fields: List[Dict[str, Any]],
                      consent_text: str) -> Dict[str, Any]:
    return {"type": "contact_form", "kind": kind, "reason": _t(reason, 200) or "",
            "campaign_id": campaign_id, "fields": fields, "consent_text": _t(consent_text, 500) or ""}


# ── final gate ────────────────────────────────────────────────────────────

_HREF_KEYS = ("url", "href", "image_url", "registration_url", "login_url", "more_url")


def _scrub(node: Any, depth: int = 0) -> Any:
    if depth > 6:
        return None
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in _HREF_KEYS:
                v = safe_href(v) if v is not None else None
            else:
                v = _scrub(v, depth + 1)
            out[k] = v
        return out
    if isinstance(node, list):
        return [_scrub(v, depth + 1) for v in node[:20]]
    if isinstance(node, str):
        return node[:1000]
    return node


def normalize(card: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(card, dict) or card.get("type") not in KINDS:
        return None
    return _scrub(card)


def summary_for_model(card: Dict[str, Any]) -> str:
    """One line describing a card that was shown, for conversation history."""
    kind = card.get("type")
    if kind == "course":
        return f"[card: course {card.get('title')}]"
    if kind == "course_list":
        return "[card: courses " + "; ".join(i.get("title") or "" for i in card.get("items", [])) + "]"
    if kind == "compare":
        return "[card: comparison of " + " vs ".join(c.get("title") or "" for c in card.get("courses", [])) + "]"
    if kind == "path":
        return f"[card: learning path {card.get('name')}]"
    if kind == "page_link":
        return f"[card: link to {card.get('title')}]"
    if kind == "live_class_list":
        return "[card: live classes " + "; ".join(i.get("title") or "" for i in card.get("items", [])) + "]"
    if kind == "notice":
        return f"[card: notice {card.get('title')}]"
    if kind == "contact_info":
        return "[card: contact details]"
    if kind == "contact_form":
        return "[card: contact form shown]"
    return "[card]"
