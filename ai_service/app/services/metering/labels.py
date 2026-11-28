"""History-row labels (d_credits §3.1), rendered on the server.

    render_label(catalog_row, event_row) -> str

Templates use `{placeholder}` and `{a|b}` (first non-empty wins). Formatting is
a plain regex substitution, never str.format, so a template or a value cannot
reach attributes. Templates are split into segments at " — ", " · " and " – ";
a segment whose placeholders are ALL missing is dropped with its separator,
and missing placeholders inside a kept segment vanish without leaving double
spaces. Values are single-line and capped.

Placeholders: label, actor_name, actor_role_label, subject_name, minutes,
seconds, model_short, use_case_label, plus any key of event.context
(course_name, video_title, flow_name, agent_name, assessment_name, ...).
Legacy / unknown rows fall back to the ledger description, then the label.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Dict, Mapping, Optional

_PLACEHOLDER = re.compile(r"\{([^{}]*)\}")
_NAME = re.compile(r"^[A-Za-z0-9_]{1,64}$")
_SEPARATORS = re.compile(r"(\s+[—·–]\s+)")
_VALUE_MAX = 80
_LABEL_MAX = 200

ROLE_LABELS = {
    "ADMIN": "admin",
    "TEACHER": "teacher",
    "STAFF": "staff",
    "PARENT": "parent",
    "LEARNER": "student",
    "API_KEY": "API key",
    "PUBLIC": "visitor",
}


def _get(obj: Any, key: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, Mapping):
        return obj.get(key)
    return getattr(obj, key, None)


def _clean(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        d = Decimal(str(value))
        if d <= 0:
            return None
        if d == d.to_integral_value():
            return str(int(d))
        return f"{d.quantize(Decimal('0.1')).normalize():f}"
    s = " ".join(str(value).split())
    if not s:
        return None
    return s if len(s) <= _VALUE_MAX else s[: _VALUE_MAX - 1].rstrip() + "…"


def _as_number(value: Any) -> Any:
    """NUMERIC columns arrive as Decimal, float or a numeric string."""
    if value is None or isinstance(value, bool):
        return None
    try:
        d = Decimal(str(value).strip())
        return d if d.is_finite() else None
    except Exception:  # noqa: BLE001
        return None


def _short_model(model_id: Any) -> Optional[str]:
    if not model_id:
        return None
    return str(model_id).split("/")[-1].split(":")[0] or None


def label_values(catalog_row: Any, event_row: Any) -> Dict[str, str]:
    """The placeholder values for one event (missing ones absent)."""
    context = _get(event_row, "context")
    if not isinstance(context, Mapping):
        context = {}
    base_label = _get(catalog_row, "label") or None
    raw: Dict[str, Any] = {}
    for k, v in context.items():
        if isinstance(k, str) and not isinstance(v, (dict, list)):
            raw[k] = v
    raw.update({
        "label": base_label,
        "use_case_label": base_label,
        "actor_name": _get(event_row, "actor_display_name") or _get(event_row, "actor_name"),
        "subject_name": _get(event_row, "subject_display_name") or _get(event_row, "subject_name"),
        "actor_role_label": ROLE_LABELS.get(str(_get(event_row, "actor_role_class") or "").upper()),
        "minutes": _as_number(_get(event_row, "minutes")),
        "seconds": _as_number(_get(event_row, "seconds")),
        "model_short": _short_model(_get(event_row, "model_id")),
    })
    out: Dict[str, str] = {}
    for k, v in raw.items():
        c = _clean(v)
        if c:
            out[k] = c
    return out


def _render_segment(segment: str, values: Dict[str, str]):
    """(rendered text, had_placeholders, any_value_found)."""
    found = False
    had = False

    def _sub(m: "re.Match[str]") -> str:
        nonlocal found, had
        had = True
        for name in m.group(1).split("|"):
            name = name.strip()
            if not _NAME.match(name) or name.startswith("_"):
                continue
            v = values.get(name)
            if v:
                found = True
                return v
        return ""

    text = _PLACEHOLDER.sub(_sub, segment).replace("{", "").replace("}", "")
    return " ".join(text.split()), had, found


def render_template(template: str, values: Dict[str, str]) -> str:
    parts = _SEPARATORS.split(template)
    # parts alternates: segment, separator, segment, ...
    kept = []
    pending_sep = None
    for i, part in enumerate(parts):
        if i % 2 == 1:
            pending_sep = part
            continue
        text, had, found = _render_segment(part, values)
        if not text or (had and not found):
            continue
        if kept and pending_sep is not None:
            kept.append(" " + pending_sep.strip() + " ")
        kept.append(text)
        pending_sep = None
    return "".join(kept).strip()


def render_label(catalog_row: Any, event_row: Any) -> str:
    """The one-line History label for an event. Never raises."""
    try:
        use_case = str(_get(event_row, "use_case") or "")
        description = _get(event_row, "description") or _get(_get(event_row, "context") or {}, "description")
        base_label = _get(catalog_row, "label")
        if catalog_row is None or use_case in ("", "unknown"):
            fallback = _clean_long(description) or _clean_long(base_label) or "AI usage"
            return fallback
        template = _get(catalog_row, "label_template") or "{label}"
        rendered = render_template(str(template), label_values(catalog_row, event_row))
        return (rendered or _clean_long(base_label) or _clean_long(description) or "AI usage")[:_LABEL_MAX]
    except Exception:  # noqa: BLE001
        return "AI usage"


def _clean_long(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = " ".join(str(value).split())
    return s[:_LABEL_MAX] or None


__all__ = ["render_label", "render_template", "label_values", "ROLE_LABELS"]
