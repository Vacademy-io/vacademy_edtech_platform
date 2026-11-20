"""The product's tour catalogue and facts file, fetched from the product's URLs.

Both are cached for 5 minutes per URL; when a refresh fails the last good
copy keeps serving (a stage-page deploy hiccup must not take the guide down).
The cache is per process and read-only, so several replicas each holding one
is harmless.

Only ``id``, ``title``, ``about``, ``audiences`` of tours and the
``audiences`` / ``topics`` lists ever reach the prompt (``prompt_view``):
step selectors stay on the client. Step ``say`` lines are read only by the
narration endpoint.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from .settings import FETCH_TTL_SECONDS, LANGS

logger = logging.getLogger(__name__)

FETCH_TIMEOUT = 10.0
MAX_CATALOG_BYTES = 2 * 1024 * 1024
MAX_KNOWLEDGE_BYTES = 1024 * 1024

# url -> (fetched_at monotonic, value). A failed refresh keeps the old value and
# is retried after RETRY_SECONDS rather than on every request.
_cache: Dict[str, Tuple[float, Any]] = {}
_failed_at: Dict[str, float] = {}
_locks: Dict[str, asyncio.Lock] = {}
RETRY_SECONDS = 30.0


def clear_cache() -> None:
    _cache.clear()
    _failed_at.clear()
    _locks.clear()


async def _http_get(url: str, max_bytes: int) -> bytes:
    """The body of `url` (replaceable in tests). Raises on any failure."""
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=False) as client:
        resp = await client.get(url, headers={"Accept": "application/json, text/markdown, text/plain"})
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}")
    if len(resp.content) > max_bytes:
        raise RuntimeError("too large")
    return resp.content


async def _cached(url: str, max_bytes: int, parse) -> Any:
    now = time.monotonic()
    hit = _cache.get(url)
    if hit and now - hit[0] < FETCH_TTL_SECONDS:
        return hit[1]
    if hit and now - _failed_at.get(url, -1e9) < RETRY_SECONDS:
        return hit[1]
    lock = _locks.setdefault(url, asyncio.Lock())
    async with lock:
        hit = _cache.get(url)
        if hit and time.monotonic() - hit[0] < FETCH_TTL_SECONDS:
            return hit[1]
        try:
            value = parse(await _http_get(url, max_bytes))
        except Exception as exc:  # noqa: BLE001
            _failed_at[url] = time.monotonic()
            if hit:
                logger.warning("demo-guide: refresh of %s failed (%s); serving the last good copy", url, exc)
                return hit[1]
            logger.error("demo-guide: could not fetch %s: %s", url, exc)
            return None
        _cache[url] = (time.monotonic(), value)
        _failed_at.pop(url, None)
        return value


def _parse_catalog(body: bytes) -> Dict[str, Any]:
    data = json.loads(body.decode("utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("tours"), list):
        raise ValueError("not a tour catalogue")
    return data


async def load_catalog(url: str) -> Optional[Dict[str, Any]]:
    """The catalogue JSON, or None when it was never fetched successfully."""
    return await _cached(url, MAX_CATALOG_BYTES, _parse_catalog)


async def load_knowledge(url: Optional[str]) -> str:
    """The facts file (markdown text); empty when there is none or it never loaded."""
    if not url:
        return ""
    text = await _cached(url, MAX_KNOWLEDGE_BYTES, lambda b: b.decode("utf-8", errors="replace"))
    return text or ""


# ── reading the catalogue ─────────────────────────────────────────────────

def text_in(value: Any, lang: str) -> str:
    """A visitor-facing string: {en,hi,kn,fr} with a fallback to en (or a plain string)."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in (lang, "en"):
            v = value.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return ""


def text_and_lang(value: Any, lang: str) -> Tuple[str, str]:
    """(text, language the text is actually in): a missing language falls back to en."""
    if isinstance(value, dict):
        v = value.get(lang)
        if isinstance(v, str) and v.strip():
            return v.strip(), lang
        v = value.get("en")
        return (v.strip(), "en") if isinstance(v, str) and v.strip() else ("", "en")
    if isinstance(value, str) and value.strip():
        return value.strip(), "en"       # an untranslated plain string is English
    return "", "en"


def _clip(v: Any, cap: int) -> str:
    return " ".join(str(v or "").split())[:cap]


def tours(catalog: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [t for t in ((catalog or {}).get("tours") or []) if isinstance(t, dict) and isinstance(t.get("id"), str)]


def tour(catalog: Optional[Dict[str, Any]], tour_id: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(tour_id, str):
        return None
    return next((t for t in tours(catalog) if t["id"] == tour_id.strip()), None)


def tour_title(catalog: Optional[Dict[str, Any]], tour_id: Any, lang: str = "en") -> str:
    t = tour(catalog, tour_id)
    return (text_in(t.get("title"), lang) if t else "") or str(tour_id or "")


def audiences(catalog: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [a for a in ((catalog or {}).get("audiences") or []) if isinstance(a, dict) and isinstance(a.get("id"), str)]


def next_tours(catalog: Optional[Dict[str, Any]], after: str, seen: List[str], audience: Any, lang: str,
               limit: int = 4) -> List[Dict[str, str]]:
    """Choices to show when a tour ends and the guide offered none: the tour's own
    ``next`` ids first, then its neighbours in catalogue order (authors keep related
    tours together), leaving out tours already played and tours for another audience."""
    all_tours = tours(catalog)
    by_id = {t["id"]: t for t in all_tours}
    here = next((i for i, t in enumerate(all_tours) if t["id"] == after), 0)
    order = [by_id[i] for i in ((by_id.get(after) or {}).get("next") or []) if isinstance(i, str) and i in by_id]
    order += sorted(all_tours, key=lambda t: abs(all_tours.index(t) - here))
    aud = str(audience or "").strip().lower()
    out: List[Dict[str, str]] = []
    for t in order:
        fits = not t.get("audiences") or not aud or aud in t["audiences"]
        label = _clip(text_in(t.get("title"), lang), 60)
        if t["id"] == after or t["id"] in seen or not fits or not label or any(o["id"] == t["id"] for o in out):
            continue
        out.append({"id": t["id"][:40], "label": label})
        if len(out) >= limit:
            break
    return out


def screens(catalog: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Screens the guide may open while it answers: [{route, label}], routes starting with '/'."""
    out = []
    for s in ((catalog or {}).get("screens") or [])[:150]:
        if isinstance(s, dict) and isinstance(s.get("route"), str) and s["route"].startswith("/") \
                and "//" not in s["route"] and len(s["route"]) <= 120:
            out.append({"route": s["route"], "label": _clip(text_in(s.get("label"), "en"), 90)})
    return out


def screen(catalog: Optional[Dict[str, Any]], route: Any) -> Optional[Dict[str, str]]:
    if not isinstance(route, str):
        return None
    return next((s for s in screens(catalog) if s["route"] == route.strip()), None)


def step_say(catalog: Optional[Dict[str, Any]], tour_id: str, step: int, lang: str) -> Optional[Tuple[str, str]]:
    """(text, text language) of that tour step's `say` line; None for an unknown
    tour, an out-of-range step or a step that says nothing."""
    t = tour(catalog, tour_id)
    steps = t.get("steps") if t else None
    if not isinstance(steps, list) or not 0 <= step < len(steps) or not isinstance(steps[step], dict):
        return None
    text, text_lang = text_and_lang(steps[step].get("say"), lang if lang in LANGS else "en")
    return (text[:1000], text_lang) if text else None


def prompt_view(catalog: Optional[Dict[str, Any]], lang: str) -> Dict[str, Any]:
    """What the model may know of the catalogue. Never step selectors or step text."""
    out_tours = []
    for t in tours(catalog)[:80]:
        out_tours.append({
            "id": t["id"][:80],
            "title": _clip(text_in(t.get("title"), "en"), 120),
            "about": _clip(t.get("about") if isinstance(t.get("about"), str) else text_in(t.get("about"), "en"), 220),
            "audiences": [str(a)[:40] for a in (t.get("audiences") or []) if isinstance(a, str)][:10],
        })
    out_aud = [{"id": a["id"][:40], "label": _clip(text_in(a.get("label"), lang), 80)} for a in audiences(catalog)[:10]]
    out_topics = []
    for tp in ((catalog or {}).get("topics") or [])[:20]:
        if isinstance(tp, dict) and isinstance(tp.get("id"), str):
            out_topics.append({"id": tp["id"][:40], "tour": str(tp.get("tour") or "")[:80],
                               "label": _clip(text_in(tp.get("label"), lang), 80)})
    return {"product": _clip((catalog or {}).get("product"), 60), "audiences": out_aud, "topics": out_topics,
            "tours": out_tours, "screens": screens(catalog)}
