"""
What a site's other languages have to cover — a Python port of the builder's
string collector, so ``website(action='strings')`` lists exactly the texts the
dashboard's Translations panel and the public site do.

Ported from (keep in step; ``tests/test_site_strings.py`` pins both sides to
one golden file that the admin's ``site-strings-sync.test.ts`` checks too):

* the key classifier of ``catalogue-i18n.ts`` (shared by the admin builder and
  the learner renderer): NON_TEXT_KEYS, OPAQUE_KEYS, the suffix rule,
  looksLikeData, visitTranslatableStrings, renderTextEntries;
* the collector of the admin's ``-components/i18n/site-strings.ts``:
  collectSiteStringEntries (header, pages, footer, the settings the site
  translates).

MODEL (catalogue-i18n.ts): a site is authored in ONE base language; every other
language is a dictionary in ``globalSettings.i18n.strings[locale]`` keyed by the
EXACT base text. Pure: no I/O, no model.
"""
from __future__ import annotations

import math
import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

Key = Union[str, int, None]
Path = List[Union[str, int]]

# ── which strings are text (catalogue-i18n.ts) ───────────────────────────

#: Keys whose string values are never prose: ids, links, colours, enums…
NON_TEXT_KEYS = frozenset(k.lower() for k in (
    "id", "type", "variant", "layout", "align", "alignment", "size", "scale", "position", "icon",
    "font", "route", "url", "href", "link", "target", "src", "image", "logo", "avatar", "video",
    "poster", "email", "phone", "whatsapp", "color", "action", "code", "slug", "tag", "tags",
    "currency", "css", "html_css", "prompt", "preset", "shape", "pattern", "mode", "sort", "field",
    "fields", "source", "status", "format", "locale", "lang", "width", "height", "fit", "ratio",
    "aspect", "easing", "direction", "orientation", "kind", "param", "op", "key", "ref", "columns",
    "gap", "radius", "platform", "display", "tile", "anchor", "date", "compactness", "audience",
    "provider", "transition", "padding", "margin", "version", "category", "tone", "speed", "weight",
    "iconname", "audiencename", "gateaudiencename", "libraryname", "productpagename",
    "types", "anchorprefix",
    "levels",
    "prefix", "exclude",
    "titlenative", "order", "formats",
))

#: List key → keys that are copy (not data) inside that list's items.
TEXT_KEYS_IN_ITEMS_OF: Dict[str, frozenset] = {
    "announcements": frozenset({"tag"}),
    "blocks": frozenset({"tag"}),
}

#: Text keys whose NAME looks like data but whose value is visitor-facing copy.
TEXT_KEY_EXCEPTIONS = frozenset(k.lower() for k in ("ctalabelpattern", "categoriesheading"))

#: Maps whose every value is visitor-facing copy, whatever its key.
TEXT_MAP_KEYS = frozenset({"formatlabels", "ctalabels", "sortlabels", "descriptions"})

#: Keys whose whole VALUE is configuration, nested strings included.
OPAQUE_KEYS = frozenset(k.lower() for k in (
    "style", "styles", "showcondition", "visiblewhen", "animation", "motion", "slots", "slot", "render",
    "theme", "decorations", "decoration",
))

#: camelCase / snake_case endings that mark a non-text key (JS regex, case-sensitive, anchored at the end).
NON_TEXT_SUFFIX = re.compile(
    r"(Id|Ids|Url|URL|Uri|Href|Route|Routes|Color|Colour|Code|Src|Slug|Slugs|Key|Css|Class|ClassName|Image|Images"
    r"|Logo|Icon|Font|Mode|Type|Style|Layout|Align|Position|Width|Widths|Height|Size|Variant|Target|Action|Email"
    r"|Phone|Date|Time|Pattern|Preset|Shape|Animation|Ratio|Fit|Format|Currency|Locale|Lang|Tag|Tags|Param|Path"
    r"|Sort|Tone|Speed|Scale|Radius|Effect|Fr|Fields|Value|Weight|Family|Platform|Category|Anchor|Display|Padding"
    r"|Margin|Gap|Columns)\Z"
    r"|_(id|ids|url|uri|href|route|color|colour|code|src|slug|slugs|key|css|class|image|logo|icon|font|mode|type"
    r"|style|layout|align|date|time|currency|locale|lang|tag|tags|path|sort|value|fields|category)\Z"
)

# JavaScript whitespace (String.prototype.trim and regex `\s`): Python's
# str.isspace differs (it adds U+001C–U+001F and U+0085, and lacks U+FEFF).
_JS_WS = "\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_JS_TRIM = "".join(
    chr(c) for c in (9, 10, 11, 12, 13, 32, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF)
)
# JS `\d` is ASCII only; `\w` is [A-Za-z0-9_]; `/i` folds ASCII only — spelled out so Python agrees.
_NUMERIC_RE = re.compile(r"^[0-9" + _JS_WS + r".,:;%+\-–—/×x*₹$€£¥()]+\Z")
_PLACEHOLDER_ONLY_RE = re.compile(r"^(\{\{?[" + _JS_WS + r"]*[A-Za-z0-9_.]+[" + _JS_WS + r"]*\}?\})+\Z")
_DATA_PREFIX_RE = re.compile(r"^(https?:|mailto:|tel:|data:|//|/|#[0-9a-f]{3,8}\Z|rgba?\(|hsla?\(|var\()", re.I | re.A)
_CODE_TOKEN_RE = re.compile(r"^[a-z0-9]+([-_.][a-z0-9]+)*\Z")
_LINK_RE = re.compile(r"^(https?:|mailto:|tel:|//|www\.)", re.I | re.A)


def js_trim(s: str) -> str:
    return s.strip(_JS_TRIM)


def is_text_key(key: Key) -> bool:
    """Is a string stored under ``key`` prose (worth translating)? (isTextKey)"""
    if key is None or isinstance(key, int):
        return True   # array items inherit their parent's verdict
    low = key.lower()
    if low in TEXT_KEY_EXCEPTIONS:
        return True
    if low in NON_TEXT_KEYS or low in OPAQUE_KEYS:
        return False
    return not NON_TEXT_SUFFIX.search(key)


def key_in_item_of(key: str, item_of: Key) -> Optional[str]:
    if isinstance(item_of, str) and key.lower() in TEXT_KEYS_IN_ITEMS_OF.get(item_of.lower(), ()):
        return None
    return key


def object_child_key(k: str, parent_key: Key, item_of: Key = None) -> Optional[str]:
    if isinstance(parent_key, str) and parent_key.lower() in TEXT_MAP_KEYS:
        return None
    return key_in_item_of(k, item_of)


def _is_opaque_key(key: Key) -> bool:
    return isinstance(key, str) and key.lower() in OPAQUE_KEYS


def looks_like_data(s: str) -> bool:
    """Values that are never prose even under a text key (looksLikeData)."""
    t = js_trim(s)
    if not t:
        return True
    if _PLACEHOLDER_ONLY_RE.match(t):
        return True
    if _DATA_PREFIX_RE.match(t):
        return True
    if _CODE_TOKEN_RE.match(t):
        return True
    return bool(_NUMERIC_RE.match(t))


def is_translatable(s: str, key: Key) -> bool:
    return is_text_key(key) and not looks_like_data(s)


def _js_entries(obj: Dict[str, Any]) -> List[Tuple[str, Any]]:
    """Object.entries order: integer-like keys ascending first, then insertion order."""
    def _index(k: str) -> Optional[int]:
        if k.isdigit() and k.isascii() and (k == "0" or not k.startswith("0")):
            n = int(k)
            return n if n < 2 ** 32 - 1 else None
        return None
    ints = sorted(((i, k) for k in obj if (i := _index(k)) is not None))
    int_keys = {k for _, k in ints}
    return [(k, obj[k]) for _, k in ints] + [(k, v) for k, v in obj.items() if k not in int_keys]


def visit_translatable_strings(value: Any, visit: Callable[[str, Path], None], key: Key = None,
                               item_of: Key = None, path: Optional[Path] = None) -> None:
    """Every translatable string under ``value`` with where it sits (visitTranslatableStrings)."""
    path = path or []
    if _is_opaque_key(key):
        return
    if isinstance(value, str):
        if is_translatable(value, key):
            visit(value, path)
        return
    if isinstance(value, list):
        inherited = key if isinstance(key, str) and not is_text_key(key) else None
        for i, item in enumerate(value):
            visit_translatable_strings(item, visit, inherited, key, [*path, i])
        return
    if isinstance(value, dict):
        for k, v in _js_entries(value):
            visit_translatable_strings(v, visit, object_child_key(k, key, item_of), None, [*path, k])


def collect_translatable_strings(value: Any) -> List[str]:
    out: List[str] = []
    seen: set = set()

    def _add(text: str, _path: Path) -> None:
        if text not in seen:
            seen.add(text)
            out.append(text)
    visit_translatable_strings(value, _add)
    return out


#: Texts inside a course grid's opaque ``render`` the site shows through its dictionary.
RENDER_TEXTS: Sequence[Tuple[Tuple[str, ...], bool]] = (
    (("card", "formatLabels"), True),
    (("card", "ctaLabels"), True),
    (("card", "freeLabel"), False),
    (("card", "descriptions"), True),
    (("pagination", "loadMoreLabel"), False),
    (("pagination", "countLabel"), False),
    (("gridHeading", "title"), False),
    (("gridHeading", "sortLabels"), True),
)


def _value_at(value: Any, path: Sequence[str]) -> Any:
    cur = value
    for step in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(step)
    return cur


def render_text_entries(render: Any) -> List[Tuple[List[str], str]]:
    """The translatable texts of a course grid's ``render`` with their paths (renderTextEntries)."""
    out: List[Tuple[List[str], str]] = []
    for path, is_map in RENDER_TEXTS:
        value = _value_at(render, path)
        if is_map:
            if not isinstance(value, dict):
                continue
            for k, v in _js_entries(value):
                if isinstance(v, str):
                    out.append(([*path, k], v))
        elif isinstance(value, str):
            out.append((list(path), value))
    return [(p, t) for p, t in out if is_translatable(t, None)]


# ── the site collector (site-strings.ts) ─────────────────────────────────

#: Text-looking props never shown to visitors (cached names, icon identifiers).
INTERNAL_TEXT_KEYS = frozenset({"audienceName", "gateAudienceName", "libraryName", "iconName"})
SETTINGS_TEXT_KEYS = frozenset({"label", "caption", "message", "placeholder", "title"})

#: Mirrors DEFAULT_COURSE_LANGUAGES (learner course-variants.ts / admin course-languages.ts).
DEFAULT_COURSE_LANGUAGES: List[Dict[str, Any]] = [
    {"code": "en", "label": "English", "chip": "EN", "match": ["english", "eng"]},
    {"code": "hi", "label": "Hindi", "chip": "हिं", "match": ["hindi", "हिन्दी", "हिंदी"]},
]


def _truthy(v: Any) -> bool:
    """JavaScript truthiness ({} and [] are truthy; NaN is not)."""
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return v != ""
    return True


def _without_internal_keys(value: Any) -> Any:
    if isinstance(value, list):
        return [_without_internal_keys(v) for v in value]
    if isinstance(value, dict):
        return {k: _without_internal_keys(v) for k, v in value.items() if k not in INTERNAL_TEXT_KEYS}
    return value


def _without_field_names(c: Dict[str, Any]) -> Any:
    props = c.get("props")
    fields = props.get("fields") if isinstance(props, dict) else None
    if c.get("type") != "contactForm" or not isinstance(fields, list):
        return props
    return {**props, "fields": [{k: v for k, v in f.items() if k != "name"} if isinstance(f, dict) and "name" in f else f
                                for f in fields]}


def _field_name(path: Sequence[Union[str, int]]) -> str:
    parts: List[str] = []
    for step in path:
        if isinstance(step, int) and parts:
            parts[-1] = f"{parts[-1]} #{step + 1}"
        else:
            parts.append(str(step))
    return " › ".join(parts)


def effective_course_languages(settings: Any) -> List[Any]:
    langs = settings.get("languages") if isinstance(settings, dict) else None
    return langs if isinstance(langs, list) and langs else DEFAULT_COURSE_LANGUAGES


AddText = Callable[[str, Dict[str, Any]], None]


def _visit_component(c: Any, add: AddText, where: Dict[str, Any], include_hidden: bool,
                     section: Optional[str] = None) -> None:
    if not isinstance(c, dict) or (c.get("enabled") is False and not include_hidden):
        return
    props = c.get("props")
    if not isinstance(props, (dict, list)):
        return
    section = section if section is not None else str(c.get("type") or "")
    visit_translatable_strings(
        _without_internal_keys(_without_field_names(c)),
        lambda text, path: add(text, {**where, "section": section, "field": _field_name(path)}),
    )
    render = props.get("render") if isinstance(props, dict) else None
    for path, text in render_text_entries(render):
        add(text, {**where, "section": section, "field": "render › " + " › ".join(path)})
    slots = props.get("slots") if isinstance(props, dict) else None
    if isinstance(slots, list):
        for slot in slots:
            if isinstance(slot, list):
                for child in slot:
                    _visit_component(child, add, where, include_hidden)


def _collect_settings_texts(node: Any, add: AddText, field: str, depth: int = 0) -> None:
    if not isinstance(node, (dict, list)) or depth > 6:
        return
    if isinstance(node, list):
        for item in node:
            _collect_settings_texts(item, add, field, depth + 1)
        return
    for k, v in _js_entries(node):
        if isinstance(v, str):
            if k in SETTINGS_TEXT_KEYS and js_trim(v):
                add(v, {"area": "settings", "field": field})
        else:
            _collect_settings_texts(v, add, field, depth + 1)


def _push_shown_text(value: Any, add: AddText, location: Dict[str, Any]) -> None:
    if not isinstance(value, str):
        return
    text = js_trim(value)
    if not text or _LINK_RE.match(text) or _NUMERIC_RE.match(text):
        return
    add(text, location)


def _get(d: Any, key: str) -> Any:
    return d.get(key) if isinstance(d, dict) else None


def collect_site_string_entries(config: Any, include_hidden: bool = False) -> List[Dict[str, Any]]:
    """
    Distinct translatable texts of the site in reading order (header, pages,
    footer, settings), each with where it is first shown (collectSiteStringEntries).
    Hidden sections and switched-off settings are skipped unless ``include_hidden``.
    """
    out: List[Dict[str, Any]] = []
    seen: set = set()

    def add(text: str, location: Dict[str, Any]) -> None:
        if text in seen:
            return
        seen.add(text)
        out.append({"text": text, "location": {k: v for k, v in location.items() if v not in (None, "")}})

    if not isinstance(config, dict):
        return out
    gs = config.get("globalSettings") if isinstance(config.get("globalSettings"), dict) else None
    layout = _get(gs, "layout")

    def shown(enabled: Any) -> bool:
        return include_hidden or _truthy(enabled)

    _visit_component(_get(layout, "header"), add, {"area": "header"}, include_hidden)
    for page in config.get("pages") or []:
        if not isinstance(page, dict):
            continue
        title = page.get("title")
        name = (js_trim(title) if isinstance(title, str) else "") or page.get("route") or page.get("id")
        if page.get("published") is not False or include_hidden:
            _push_shown_text(title, add, {"area": "pageTitle", "page": name})
        sections = [c for c in page.get("components") or [] if _truthy(c) and (include_hidden or _get(c, "enabled") is not False)]
        labels = [str(_get(c, "type") or "") for c in sections]
        counts: Dict[str, int] = {}
        for c, label in zip(sections, labels):
            counts[label] = counts.get(label, 0) + 1
            repeated = labels.count(label) > 1
            _visit_component(c, add, {"area": "page", "page": name}, include_hidden,
                             f"{label} #{counts[label]}" if repeated else label)
        if _truthy(page.get("seo")):
            visit_translatable_strings(
                page["seo"], lambda text, path: add(text, {"area": "seo", "page": name, "field": _field_name(path)}))
    _visit_component(_get(layout, "footer"), add, {"area": "footer"}, include_hidden)

    course_languages = _get(gs, "courseLanguages")
    if shown(_get(course_languages, "enabled")):
        for lang in effective_course_languages(course_languages):
            _push_shown_text(_get(lang, "label"), add, {"area": "settings", "field": "courseLanguages"})
            _push_shown_text(_get(lang, "chip"), add, {"area": "settings", "field": "courseLanguages"})
    formats = _get(gs, "courseFormats")
    if isinstance(formats, dict):
        for key, fmt in _js_entries(formats):
            if isinstance(fmt, dict):
                _push_shown_text(fmt.get("label"), add, {"area": "settings", "field": f"courseFormats › {key}"})
    naming = _get(gs, "naming")
    if isinstance(naming, dict):
        for key, word in _js_entries(naming):
            _push_shown_text(word, add, {"area": "settings", "field": f"naming › {key}"})
    whatsapp = _get(gs, "whatsapp")
    if shown(_get(whatsapp, "enabled") is not False):
        _collect_settings_texts(whatsapp, add, "whatsapp")
    finder = _get(gs, "courseFinder")
    step_labels = _get(finder, "stepLabels")
    if shown(_get(finder, "enabled")) and _truthy(step_labels):
        entries = _js_entries(step_labels) if isinstance(step_labels, dict) else (
            [(str(i), v) for i, v in enumerate(step_labels)] if isinstance(step_labels, list) else [])
        for key, v in entries:
            if isinstance(v, str) and js_trim(v):
                add(v, {"area": "settings", "field": f"courseFinder › {key}"})
    intro = config.get("introPage")
    if intro is None:
        intro = _get(gs, "introPage")
    images = _get(_get(intro, "imageSlider"), "images")
    if shown(_get(intro, "enabled")) and isinstance(images, list):
        for image in images:
            _push_shown_text(_get(image, "caption"), add, {"area": "settings", "field": "introPage"})
    lead = _get(gs, "leadCollection")
    if shown(_get(lead, "enabled")):
        _collect_settings_texts(_get(lead, "fields"), add, "leadCollection")
    return out


def collect_site_strings(config: Any, include_hidden: bool = False) -> List[str]:
    return [e["text"] for e in collect_site_string_entries(config, include_hidden)]


# ── settings helpers ─────────────────────────────────────────────────────
def base_locale_of(i18n: Any) -> str:
    return str(_get(i18n, "defaultLocale") or "en").lower()


def missing_translations(sources: List[str], dictionary: Any) -> List[str]:
    """translationCoverage: a source with no (or an empty) entry is missing."""
    d = dictionary if isinstance(dictionary, dict) else {}
    return [s for s in sources if not _truthy(d.get(s))]


def describe_location(location: Dict[str, Any]) -> str:
    """'page “Courses” › courseCatalog › hero › title' — where a text is first shown."""
    area = location.get("area")
    head = {"header": "header", "footer": "footer", "settings": "site settings"}.get(str(area))
    if head is None:
        head = f"page “{location.get('page')}”"
        if area == "pageTitle":
            head += " title"
        elif area == "seo":
            head += " SEO"
    parts = [head] + [str(location[k]) for k in ("section", "field") if location.get(k)]
    return " › ".join(parts)


__all__ = [
    "is_text_key", "looks_like_data", "is_translatable", "visit_translatable_strings",
    "collect_translatable_strings", "render_text_entries", "collect_site_string_entries",
    "collect_site_strings", "base_locale_of", "missing_translations", "describe_location", "js_trim",
]
