"""
The learner site's course-data rules, ported to Python so the website tools
describe a course exactly the way the site will show it. Pure functions, no I/O.

Each function mirrors one learner helper (frontend-learner-dashboard-app/src/
routes/$tagName/…); keep them in step — tests/test_catalogue_course_rules.py
carries the TS tests' own cases:

    course_languages_of / language_of_level / language_of_tags / language_of_row
        -utils/course-variants.ts (courseLanguagesOf, languageOfLevel :55,
        languageOfTags :90, languageOfRow :111)
    resolve_course_formats / row_tags / course_format_keys / card_format_keys
        -utils/course-format.ts (:75, :107, :122, :146)
    folder_slug / folder_course_tag
        -services/folder-library-service.ts (:83, :96)
    folder_tag_set / streams_from_folder_tree
        -components/components/catalog/catalog-streams.ts
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional

#: course-variants.ts DEFAULT_COURSE_LANGUAGES
DEFAULT_COURSE_LANGUAGES: List[Dict[str, Any]] = [
    {"code": "en", "label": "English", "chip": "EN", "match": ["english", "eng"]},
    {"code": "hi", "label": "Hindi", "chip": "हिं", "match": ["hindi", "हिन्दी", "हिंदी"]},
]

FORMAT_TAG_PREFIX = "format-"
_MAX_FORMATS = 30


def _norm(value: Any) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def _is_ascii(s: str) -> bool:
    return all(ord(ch) < 128 for ch in s)


def _tokens(lang: Dict[str, Any]) -> List[str]:
    raw = [*(lang.get("match") or []), lang.get("label"), lang.get("code")]
    return [t.strip().lower() for t in raw if isinstance(t, str) and t.strip()]


# ── languages (course-variants.ts) ───────────────────────────────────────
def course_languages_of(settings: Any) -> List[Dict[str, Any]]:
    """The site's languages (globalSettings.courseLanguages.languages), else English + Hindi."""
    langs = settings.get("languages") if isinstance(settings, dict) else None
    if isinstance(langs, list):
        valid = [l for l in langs if isinstance(l, dict) and isinstance(l.get("code"), str)]
        if valid:
            return valid
    return DEFAULT_COURSE_LANGUAGES


def language_of_level(level_name: Any, languages: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    The language a level name stands for. ASCII words match as whole words
    ("eng" is not "engineering"); non-Latin tokens match anywhere.
    """
    name = level_name.lower() if isinstance(level_name, str) else ""
    if not name.strip():
        return None
    for lang in languages:
        for token in _tokens(lang):
            if _is_ascii(token):
                if re.search(rf"(^|[^a-z0-9]){re.escape(token)}([^a-z0-9]|$)", name):
                    return lang
            elif token in name:
                return lang
    return None


def language_of_tags(tags: Any, languages: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """A tag that is EXACTLY a language's label, code or match word — never a word inside a longer tag."""
    if not isinstance(tags, str) or not tags.strip():
        return None
    items = [t.strip().lower() for t in tags.split(",") if t.strip()]
    if not items:
        return None
    for lang in languages:
        tokens = _tokens(lang)
        if any(t in tokens for t in items):
            return lang
    return None


def language_of_row(row: Dict[str, Any], languages: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The level name first ("Beginner Hindi"), else a course tag that is exactly a language."""
    level = row.get("level_name") if row.get("level_name") is not None else row.get("level")
    return language_of_level(level, languages) or language_of_tags(row.get("comma_separeted_tags"), languages)


# ── formats (course-format.ts) ───────────────────────────────────────────
def _str_list(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for v in raw:
        n = _norm(v)
        if n and n not in out:
            out.append(n)
    return out


def resolve_course_formats(global_settings: Any) -> Optional[Dict[str, Any]]:
    """
    ``{"list": [{key, label, levels, tags}], "by_key": {key: …}}`` from
    globalSettings.courseFormats (ordered by courseFormatOrder, then authoring
    order), or None when the site authors none.
    """
    raw = global_settings.get("courseFormats") if isinstance(global_settings, dict) else None
    if not isinstance(raw, dict):
        return None
    formats: List[Dict[str, Any]] = []
    seen = set()
    for raw_key, definition in raw.items():
        key = _norm(raw_key)
        if not key or key in seen or not isinstance(definition, dict):
            continue
        label = definition.get("label").strip() if isinstance(definition.get("label"), str) else ""
        if not label:
            continue
        seen.add(key)
        tags = _str_list(definition.get("tags"))
        own = f"{FORMAT_TAG_PREFIX}{key}"
        formats.append({"key": key, "label": label, "levels": _str_list(definition.get("levels")),
                        "tags": tags if own in tags else [own, *tags]})
        if len(formats) >= _MAX_FORMATS:
            break
    if not formats:
        return None
    order = _str_list(global_settings.get("courseFormatOrder"))

    def rank(key: str) -> int:
        return order.index(key) if key in order else len(order)

    ordered = [f for _, f in sorted(enumerate(formats), key=lambda p: (rank(p[1]["key"]), p[0]))]
    return {"list": ordered, "by_key": {f["key"]: f for f in ordered}}


def row_tags(row: Dict[str, Any]) -> List[str]:
    """A row's course tags, lower-case (comma_separeted_tags + tags as a comma string or a list)."""
    out: List[str] = []

    def add(v: Any) -> None:
        if isinstance(v, str):
            out.extend(_norm(t) for t in v.split(",") if _norm(t))
        elif isinstance(v, list):
            for x in v:
                add(x)

    add(row.get("comma_separeted_tags"))
    add(row.get("tags"))
    return out


def course_format_keys(row: Dict[str, Any], formats: Optional[Dict[str, Any]]) -> List[str]:
    """Every format key of a row: a ``format-<key>`` tag, then a listed tag, then the level name."""
    if not formats:
        return []
    by_key = formats["by_key"]
    out: List[str] = []

    def push(key: str) -> None:
        if key in by_key and key not in out:
            out.append(key)

    tags = row_tags(row)
    for tag in tags:
        if tag.startswith(FORMAT_TAG_PREFIX):
            push(tag[len(FORMAT_TAG_PREFIX):])
    for f in formats["list"]:
        if any(t in tags for t in f["tags"]):
            push(f["key"])
    level = _norm(row.get("level_name") if row.get("level_name") is not None else row.get("level"))
    if level:
        for f in formats["list"]:
            if level in f["levels"]:
                push(f["key"])
    return out


def card_format_keys(rows: Iterable[Dict[str, Any]], formats: Optional[Dict[str, Any]]) -> List[str]:
    """Format keys of any of the rows (one course's levels, or a language-grouped card)."""
    out: List[str] = []
    for row in rows:
        for key in course_format_keys(row, formats):
            if key not in out:
                out.append(key)
    return out


# ── folder libraries (folder-library-service.ts, catalog-streams.ts) ─────
def folder_slug(node: Dict[str, Any]) -> str:
    """The folder's link key: its slug, else a slug made from its subtitle or title, else its id."""
    explicit = (node.get("slug") or "").strip() if isinstance(node.get("slug"), str) else ""
    if explicit:
        return explicit
    source = node.get("subtitle") or node.get("title") or ""
    source = source if isinstance(source, str) else ""
    text = unicodedata.normalize("NFKD", source)
    text = re.sub(r"[̀-ͯ]", "", text).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or str(node.get("id") or "")


def folder_course_tag(node: Dict[str, Any]) -> str:
    """The course tag a folder filters by: its explicit tag, else its slug."""
    tag = node.get("course_tag")
    tag = tag.strip() if isinstance(tag, str) else ""
    return tag or folder_slug(node)


def folder_tag_set(node: Dict[str, Any]) -> List[str]:
    """A folder's tag plus the tags of every folder below it, lower-case and unique."""
    out: List[str] = []

    def walk(n: Dict[str, Any]) -> None:
        if not isinstance(n, dict) or n.get("node_type") != "FOLDER":
            return
        tag = _norm(folder_course_tag(n))
        if tag and tag not in out:
            out.append(tag)
        for child in n.get("children") or []:
            walk(child)

    walk(node)
    return out


def streams_from_folder_tree(roots: Any) -> List[Dict[str, Any]]:
    """
    Top-level folders are streams, their direct sub-folders categories (the
    learner's streamsFromFolderTree). Duplicate slugs keep the first. Pass the
    PUBLIC tree (``public_folder_tree``) to get what a visitor sees.
    """
    streams: List[Dict[str, Any]] = []
    seen = set()
    for node in roots or []:
        if not isinstance(node, dict) or node.get("node_type") != "FOLDER":
            continue
        slug = folder_slug(node)
        if not slug or slug.lower() in seen:
            continue
        seen.add(slug.lower())
        category_slugs = set()
        categories: List[Dict[str, Any]] = []
        for child in node.get("children") or []:
            if not isinstance(child, dict) or child.get("node_type") != "FOLDER":
                continue
            child_slug = folder_slug(child)
            if not child_slug or child_slug.lower() in category_slugs:
                continue
            category_slugs.add(child_slug.lower())
            categories.append({
                "id": child.get("id"), "slug": child_slug, "title": child.get("title") or child.get("subtitle") or "",
                "subtitle": child.get("subtitle") or "", "tags": folder_tag_set(child),
                "coming_soon": bool(child.get("coming_soon")), "audience_id": child.get("audience_id") or None,
            })
        streams.append({
            "id": node.get("id"), "slug": slug, "title": node.get("title") or node.get("subtitle") or "",
            "subtitle": node.get("subtitle") or "", "tag": _norm(folder_course_tag(node)),
            "tags": folder_tag_set(node), "coming_soon": bool(node.get("coming_soon")),
            "audience_id": node.get("audience_id") or None, "categories": categories,
        })
    return streams


def public_folder_tree(roots: Any) -> List[Dict[str, Any]]:
    """
    The tree a visitor gets from the public endpoint: ACTIVE nodes only, and a
    product-page leaf only while its page is ACTIVE (CatalogueFolderService.publicTree).
    """
    out: List[Dict[str, Any]] = []
    for n in roots or []:
        if not isinstance(n, dict) or str(n.get("status") or "ACTIVE").upper() != "ACTIVE":
            continue
        if n.get("node_type") == "PRODUCT_PAGE" and str(n.get("product_page_status") or "ACTIVE").upper() != "ACTIVE":
            continue
        out.append({**n, "children": public_folder_tree(n.get("children"))})
    return out


__all__ = [
    "DEFAULT_COURSE_LANGUAGES", "FORMAT_TAG_PREFIX",
    "course_languages_of", "language_of_level", "language_of_tags", "language_of_row",
    "resolve_course_formats", "row_tags", "course_format_keys", "card_format_keys",
    "folder_slug", "folder_course_tag", "folder_tag_set", "streams_from_folder_tree", "public_folder_tree",
]
