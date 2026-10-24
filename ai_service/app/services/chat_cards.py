"""
Cards: structured things a learner-chatbot tool can SHOW, next to the text the
model reads.

A tool returns either a plain string (the model reads it) or a ToolOutput with
a `card`. The orchestrator stores the card as its own chat message
(message_type="card", metadata.card) and the learner app renders it by `kind`.
`content` carries a markdown fallback, so older app builds and the admin
transcript viewer still show something readable.

Kinds (keep in sync with frontend-learner-dashboard-app
src/components/chatbot/cards/):

    link_list  {title?, items: [{title, subtitle?, href?, icon?, badge?}]}
    progress   {title?, items: [{title, percent, subtitle?, href?}]}
    steps      {title?, items: [{title, body}]}         worked solution, revealed step by step
    flashcards {title?, items: [{front, back}]}         flip cards

Links are either in-app routes ("/study-library/...") or https URLs. Anything
else is dropped here, before it is stored — the app never sees a javascript:
or protocol-relative href.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple, Union

CARD_KINDS = ("link_list", "progress", "steps", "flashcards")
CARD_ICONS = ("course", "slide", "video", "pdf", "quiz", "question", "live", "assessment", "link")
_MAX_ITEMS = 10
_MAX_TEXT = 200


@dataclass
class ToolOutput:
    """What a tool hands back: `text` for the model, optional `card` for the learner."""

    text: str
    card: Optional[Dict[str, Any]] = None


def _clean_text(value: Any, limit: int = _MAX_TEXT) -> Optional[str]:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text[:limit] if text else None


def safe_href(value: Any) -> Optional[str]:
    """An in-app route or an https URL; everything else is refused."""
    if not isinstance(value, str):
        return None
    href = value.strip()
    if href.startswith("/") and not href.startswith("//"):
        return href[:1000]
    if href.startswith("?"):
        # Query-only: the same page with extra params (e.g. ?openQueries=1).
        return href[:1000]
    if href.lower().startswith("https://"):
        return href[:1000]
    return None


def _clean_items(items: Any, *, progress: bool) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for raw in items if isinstance(items, list) else []:
        if not isinstance(raw, dict):
            continue
        title = _clean_text(raw.get("title"))
        if not title:
            continue
        item: Dict[str, Any] = {"title": title}
        subtitle = _clean_text(raw.get("subtitle"))
        if subtitle:
            item["subtitle"] = subtitle
        href = safe_href(raw.get("href"))
        if href:
            item["href"] = href
        if progress:
            try:
                item["percent"] = max(0.0, min(100.0, round(float(raw.get("percent") or 0), 1)))
            except (TypeError, ValueError):
                item["percent"] = 0.0
        else:
            icon = raw.get("icon")
            if icon in CARD_ICONS:
                item["icon"] = icon
            badge = _clean_text(raw.get("badge"), 40)
            if badge:
                item["badge"] = badge
        out.append(item)
        if len(out) >= _MAX_ITEMS:
            break
    return out


def _clean_pairs(items: Any, a: str, b: str, limit_a: int, limit_b: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for raw in items if isinstance(items, list) else []:
        if not isinstance(raw, dict):
            continue
        first = str(raw.get(a) or "").strip()[:limit_a]
        second = str(raw.get(b) or "").strip()[:limit_b]
        if first and second:
            out.append({a: first, b: second})
        if len(out) >= _MAX_ITEMS:
            break
    return out


def normalize_card(card: Any) -> Optional[Dict[str, Any]]:
    """The card in its stored shape, or None when there is nothing valid to show."""
    if not isinstance(card, dict) or card.get("kind") not in CARD_KINDS:
        return None
    kind = card["kind"]
    if kind == "steps":
        # Bodies keep their markdown/LaTeX (rendered like a reply), so no whitespace folding.
        items = _clean_pairs(card.get("items"), "title", "body", _MAX_TEXT, 1500)
    elif kind == "flashcards":
        items = _clean_pairs(card.get("items"), "front", "back", 300, 600)
    else:
        items = _clean_items(card.get("items"), progress=(kind == "progress"))
    if not items:
        return None
    normalized: Dict[str, Any] = {"kind": kind, "items": items}
    title = _clean_text(card.get("title"))
    if title:
        normalized["title"] = title
    return normalized


def split_tool_output(output: Union[str, ToolOutput, None]) -> Tuple[str, Optional[Dict[str, Any]]]:
    """(text for the model, validated card or None) from whatever a tool returned."""
    if isinstance(output, ToolOutput):
        return output.text or "", normalize_card(output.card)
    return ("" if output is None else str(output)), None


def card_fallback_markdown(card: Dict[str, Any]) -> str:
    """Readable markdown for clients that don't render cards."""
    lines: List[str] = []
    if card.get("title"):
        lines.append(f"**{card['title']}**")
    if card.get("kind") == "steps":
        for n, item in enumerate(card.get("items", []), 1):
            lines.append(f"{n}. **{item['title']}** — {item['body']}")
        return "\n".join(lines)
    if card.get("kind") == "flashcards":
        for item in card.get("items", []):
            lines.append(f"- **{item['front']}** — {item['back']}")
        return "\n".join(lines)
    for item in card.get("items", []):
        label = item["title"]
        if item.get("href", "").startswith("https://"):
            label = f"[{label}]({item['href']})"
        extra = []
        if card.get("kind") == "progress":
            extra.append(f"{item.get('percent', 0):g}%")
        if item.get("subtitle"):
            extra.append(item["subtitle"])
        if item.get("badge"):
            extra.append(item["badge"])
        lines.append(f"- {label}" + (f" — {' · '.join(extra)}" if extra else ""))
    return "\n".join(lines)


def card_summary_for_model(card: Dict[str, Any]) -> str:
    """One compact line per item, for putting a shown card back into history."""
    kind = card.get("kind")
    if kind == "steps":
        return "[Shown to the student as step-by-step cards: " + " | ".join(
            f"{i['title']}: {i['body'][:200]}" for i in card.get("items", [])) + "]"
    if kind == "flashcards":
        return "[Shown to the student as flashcards: " + " | ".join(
            f"{i['front']} → {i['back'][:120]}" for i in card.get("items", [])) + "]"
    titles = []
    for item in card.get("items", []):
        if kind == "progress":
            titles.append(f"{item['title']} ({item.get('percent', 0):g}%)")
        else:
            titles.append(item["title"])
    head = card.get("title") or ("links" if kind == "link_list" else "progress")
    return f"[Shown to the student as a card — {head}: " + "; ".join(titles) + "]"


__all__ = [
    "ToolOutput",
    "CARD_KINDS",
    "CARD_ICONS",
    "normalize_card",
    "split_tool_output",
    "card_fallback_markdown",
    "card_summary_for_model",
    "safe_href",
]
