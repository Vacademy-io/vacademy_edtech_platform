"""The Site Assistant's tools: a small registry in the ToolSpec style of the
Vacademy Assistant (services/assistant_tool_registry.py), but public.

Every executor gets a SiteContext built from the verified session — the
institute, site, channel and visitor come from there and NEVER from the
model's arguments. A model-supplied id (a course id, a path code) is only
ever looked up inside the session's institute, so it cannot reach another
tenant's data. Tools whose knowledge switch is off for the site are not
offered, and are refused if called anyway.

A tool returns ToolResult(text for the model, cards for the visitor). Text is
fenced in <data> blocks: page, KB and catalogue text is data, never
instructions.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

from . import cards as C
from . import internal_client as ac
from . import knowledge as K
from .guards import language_of

logger = logging.getLogger(__name__)

MAX_DATA_CHARS = 6000


@dataclass
class SiteContext:
    institute_id: str
    site_tag: str
    channel: str                       # HOSTED | EMBED | PREVIEW
    conversation_id: str
    visitor_id: str
    settings: Dict[str, Any]
    user_id: Optional[str] = None      # a verified logged-in learner
    site_name: Optional[str] = None
    site_host: Optional[str] = None    # the host the visitor is on
    hosted_base: Optional[str] = None  # https://<learner portal>/<tag>, when known
    catalogue: Optional[Dict[str, Any]] = None
    page: Dict[str, Any] = field(default_factory=dict)
    lead_status: Optional[str] = None
    contact_forms_shown: int = 0

    @property
    def logged_in(self) -> bool:
        return bool(self.user_id)

    def flag(self, name: str) -> bool:
        k = self.settings.get("knowledge") or {}
        if name == "linkedKbIds":
            return bool(k.get("linkedKbIds"))
        return bool(k.get(name, True))


@dataclass
class ToolResult:
    text: str
    cards: List[Dict[str, Any]] = field(default_factory=list)
    sources: List[Dict[str, Any]] = field(default_factory=list)
    found: bool = True


Executor = Callable[[Dict[str, Any], SiteContext], Awaitable[ToolResult]]


@dataclass
class SiteToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]
    executor: Executor
    knowledge_flag: Optional[Tuple[str, ...]] = None   # any-of; None = always offered
    returns_cards: Tuple[str, ...] = ()

    def schema(self) -> Dict[str, Any]:
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                 "parameters": self.parameters}}

    def allowed(self, ctx: SiteContext) -> bool:
        return self.knowledge_flag is None or any(ctx.flag(f) for f in self.knowledge_flag)


# ── helpers ───────────────────────────────────────────────────────────────

def fence(source: str, body: str, **attrs: Any) -> str:
    """A data block the prompt tells the model never to take instructions from."""
    body = (body or "").replace("</data>", "</ data>")[:MAX_DATA_CHARS]
    extra = "".join(f' {k}="{str(v)[:120]}"' for k, v in attrs.items() if v not in (None, ""))
    return f'<data source="{source}"{extra}>\n{body}\n</data>'


def _str_arg(args: Dict[str, Any], key: str, cap: int = 200) -> Optional[str]:
    v = args.get(key)
    if v is None or isinstance(v, (dict, list)):
        return None
    s = " ".join(str(v).split())
    return s[:cap] if s else None


def site_path(ctx: SiteContext, route: Optional[str]) -> Optional[str]:
    """Where a site page lives: site-relative on the hosted site, absolute elsewhere."""
    r = str(route or "").strip().strip("/")
    if r.lower() in ("", "home", "index"):
        r = ""
    rel = f"/{ctx.site_tag}" + (f"/{r}" if r else "")
    if ctx.channel == "HOSTED":
        return rel
    if ctx.hosted_base:
        return ctx.hosted_base.rstrip("/") + (f"/{r}" if r else "")
    return None


def _course_line(c: Dict[str, Any]) -> str:
    parts = [f"id={c.get('id')}", f"title={c.get('title')}"]
    label = C.price_label(c)
    parts.append(f"price={label}" if label else "price=not shown on the site (do not state a price)")
    fmts = ", ".join(C._strs(c.get("formats")))
    if fmts:
        parts.append(f"format={fmts}")
    langs = ", ".join(C._strs(c.get("languages")))
    if langs:
        parts.append(f"language={langs}")
    if c.get("level"):
        parts.append(f"level={c.get('level')}")
    if c.get("availability"):
        parts.append(f"availability={c.get('availability')}")
    cs = c.get("coming_soon")
    if isinstance(cs, dict):
        parts.append("coming_soon=yes" + (f" (launch {cs.get('launch_date')})" if cs.get("launch_date") else ""))
    badges = ", ".join(C._strs(c.get("badges")))
    if badges:
        parts.append(f"badges={badges}")
    if c.get("duration_minutes"):
        parts.append(f"duration_minutes={c.get('duration_minutes')}")
    if c.get("subtitle"):
        parts.append(f"summary={str(c.get('subtitle'))[:200]}")
    if c.get("url"):
        parts.append(f"url={c.get('url')}")
    return "- " + " | ".join(str(p) for p in parts)


# ── executors ─────────────────────────────────────────────────────────────

async def _find_on_site(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    query = _str_arg(args, "query", 300)
    if not query:
        return ToolResult(fence("site_pages", "No query given."), found=False)
    hits = await K.search_pages(ctx.institute_id, ctx.site_tag, query, top_k=4)
    blocks, cards, sources = [], [], []
    for h in hits:
        href = site_path(ctx, h.get("page_route"))
        blocks.append(fence("site_page", h.get("content") or "", page=h.get("page_title"),
                            link=(href + (f"#{h['section_id']}" if h.get("section_id") and ctx.channel == "HOSTED" else ""))
                            if href else None))
        sources.append({"type": "page", "route": h.get("page_route"), "section_id": h.get("section_id")})
        if href and len(cards) < 1:
            card = C.page_link_card(h.get("page_title") or "Open page", href, h.get("section_id"),
                                    (h.get("heading") or "") or None)
            if card:
                cards.append(card)
    if ctx.channel == "EMBED" and ctx.flag("linkedKbIds"):
        for h in await K.search_linked_kbs(ctx.institute_id, ctx.settings["knowledge"]["linkedKbIds"], query, top_k=2):
            blocks.append(fence("site_page", h.get("content") or "", page=h.get("title"), link=h.get("url")))
            sources.append({"type": "kb", "source_id": h.get("source_id")})
            if h.get("url") and len(cards) < 2:
                card = C.page_link_card(h.get("title") or "Open page", h["url"])
                if card:
                    cards.append(card)
    if not blocks:
        return ToolResult(fence("site_pages", "Nothing on the website matches this."), found=False)
    return ToolResult("\n".join(blocks), cards, sources)


_SORTS = ("relevance", "popular", "newest", "price_asc", "price_desc", "title")
_NARROWING = ("stream", "category", "format", "language", "level", "badge")


async def _courses(ctx: SiteContext, params: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    data = await ac.catalog_courses(ctx.institute_id, params)
    if data is None and params.get("sort") == "relevance":
        # An admin_core without sort=relevance answers 400: search again in its default order.
        data = await ac.catalog_courses(ctx.institute_id, {k: v for k, v in params.items() if k != "sort"})
    return data, [c for c in (data or {}).get("data") or [] if isinstance(c, dict)]


async def _search_courses(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    params: Dict[str, Any] = {}
    for key in ("q", "stream", "category", "format", "language", "level", "badge"):
        v = _str_arg(args, key, 120)
        if v:
            params[key] = v
    price = _str_arg(args, "price", 10)
    if price in ("free", "paid"):
        params["price"] = price
    try:
        if args.get("price_max") is not None:
            params["price_max"] = max(0, int(float(args["price_max"])))
    except (TypeError, ValueError):
        pass
    sort = _str_arg(args, "sort", 20)
    if sort in _SORTS:
        params["sort"] = sort
    elif params.get("q"):
        params["sort"] = "relevance"     # closest titles first; the API's own default is newest
    try:
        limit = int(args.get("limit") or 4)
    except (TypeError, ValueError):
        limit = 4
    params["page_size"] = max(1, min(limit, 4))
    asked = dict(params)
    data, courses = await _courses(ctx, params)
    # The model often adds a filter the site does not have (format=ebook on a site without formats, a made-up
    # category) or a word no title has ("guide", "series"): widen once without the filters, then drop the last
    # words, before telling the visitor nothing is there.
    if not courses and any(k in params for k in _NARROWING):
        params = {k: v for k, v in params.items() if k not in _NARROWING}
        data, courses = await _courses(ctx, params)
    words = (params.get("q") or "").split()
    while not courses and len(words) > 1 and len(asked.get("q", "").split()) - len(words) < 2:
        words = words[:-1]
        params = {**params, "q": " ".join(words)}
        data, courses = await _courses(ctx, params)
    if not courses:
        return ToolResult(fence("courses", f"No courses match {json.dumps(asked, ensure_ascii=False)}, even with "
                                           "fewer words and no filters. Tell the visitor you could not find it; never "
                                           "say you found courses or tell them to tap a button."), found=False)
    total = (data or {}).get("total")
    widened = "" if params == asked else (
        f"Nothing matched {json.dumps(asked, ensure_ascii=False)} exactly; these are the closest matches for "
        f"{json.dumps(params, ensure_ascii=False)}. Say so.\n")
    body = widened + f"{len(courses)} of {total} matching courses:\n" + "\n".join(_course_line(c) for c in courses)
    card = C.course_list_card(courses)
    return ToolResult(fence("courses", body), [card] if card else [],
                      [{"type": "course", "id": c.get("id")} for c in courses])


def _plain(html: Any, cap: int) -> str:
    from ..services.catalogue_summary import strip_html
    return strip_html(html if isinstance(html, str) else "", cap)


async def _get_course(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    cid = _str_arg(args, "course_id", 64)
    if not cid:
        return ToolResult(fence("course", "course_id is required."), found=False)
    lang = _str_arg(args, "language", 16)
    course = await ac.catalog_course(ctx.institute_id, cid, lang)
    if not course:
        return ToolResult(fence("course", f"No course with id {cid} on this site."), found=False)
    lines = [_course_line(course)]
    if course.get("description_text"):
        lines.append("description: " + str(course["description_text"])[:1200])
    if course.get("about_text"):
        lines.append("about: " + str(course["about_text"])[:800])
    for key, label in (("who_should_learn_html", "who should learn"), ("why_learn_html", "why learn")):
        if course.get(key):
            lines.append(f"{label}: " + _plain(course[key], 500))
    if course.get("mode"):
        lines.append(f"mode: {course['mode']}")
    authors = [a.get("name") for a in course.get("authors") or [] if isinstance(a, dict) and a.get("name")]
    instructors = [a.get("name") for a in course.get("instructors") or [] if isinstance(a, dict) and a.get("name")]
    if authors or instructors:
        lines.append("instructors: " + ", ".join(dict.fromkeys(authors + instructors)))
    variants = [v for v in course.get("variants") or [] if isinstance(v, dict)]
    if len(variants) > 1:
        for v in variants[:6]:
            vp = v.get("price") if course.get("price_visible") else None
            vl = (C.format_amount(vp.get("amount"), vp.get("currency")) if isinstance(vp, dict) and not vp.get("is_free")
                  else ("Free" if isinstance(vp, dict) else "not shown"))
            lang_label = (v.get("language") or {}).get("label") if isinstance(v.get("language"), dict) else None
            lines.append(f"version: {v.get('title') or v.get('level') or ''} | language={lang_label or '-'} "
                         f"| price={vl} | availability={v.get('availability')} | url={v.get('url') or ''}")
    for f in (course.get("faqs") or [])[:8]:
        if isinstance(f, dict) and f.get("question"):
            lines.append(f"FAQ: {f['question']} — {_plain(f.get('answer_html'), 400)}")
    if args.get("include_outline"):
        outline = await ac.catalog_outline(ctx.institute_id, cid)
        names: List[str] = []
        for level in (outline or {}).get("levels") or []:
            for subj in level.get("subjects") or []:
                for mod in subj.get("modules") or []:
                    if mod.get("name"):
                        names.append(str(mod["name"]))
                    for ch in mod.get("chapters") or []:
                        if ch.get("name"):
                            names.append("  " + str(ch["name"]))
        if names:
            lines.append("outline:\n" + "\n".join(names[:40]))
    card = C.course_card(course)
    return ToolResult(fence("course", "\n".join(lines)), [card] if card else [], [{"type": "course", "id": cid}])


async def _compare_courses(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    ids = [str(x)[:64] for x in (args.get("course_ids") or []) if isinstance(x, (str, int))][:3]
    if len(ids) < 2:
        return ToolResult(fence("compare", "Give 2 or 3 course ids to compare."), found=False)
    courses = [c for c in [await ac.catalog_course(ctx.institute_id, i) for i in ids] if c]
    if len(courses) < 2:
        return ToolResult(fence("compare", "Could not find at least two of those courses on this site."), found=False)
    card = C.compare_card(courses)
    body = "\n".join(_course_line(c) for c in courses)
    return ToolResult(fence("compare", body), [card] if card else [], [{"type": "course", "id": c.get("id")} for c in courses])


async def _get_learning_paths(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    data = await ac.catalog_learning_paths(ctx.institute_id)
    paths = [p for p in (data or {}).get("data") or [] if isinstance(p, dict)]
    if not paths:
        return ToolResult(fence("learning_paths", "This site has no learning paths."), found=False)
    body = "\n".join(f"- code={p.get('code')} | name={p.get('name')} | steps={p.get('step_count')}" for p in paths[:15])
    return ToolResult(fence("learning_paths", body), [], [{"type": "path", "code": p.get("code")} for p in paths[:15]])


async def _get_learning_path(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    code = _str_arg(args, "code", 80)
    if not code:
        return ToolResult(fence("learning_path", "code is required."), found=False)
    path = await ac.catalog_learning_path(ctx.institute_id, code)
    if not path:
        return ToolResult(fence("learning_path", f"No learning path {code}."), found=False)
    lines = [f"name={path.get('name')}"]
    if path.get("description_html"):
        lines.append("description: " + _plain(path["description_html"], 600))
    for s in path.get("steps") or []:
        c = s.get("course") if isinstance(s, dict) else None
        if isinstance(c, dict):
            lines.append(f"step {s.get('position')}: " + _course_line(c)[2:])
    card = C.path_card(path)
    return ToolResult(fence("learning_path", "\n".join(lines)), [card] if card else [], [{"type": "path", "code": code}])


async def _list_live_classes(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    try:
        days = max(1, min(int(args.get("days") or 30), 60))
    except (TypeError, ValueError):
        days = 30
    data = await ac.live_sessions(ctx.institute_id, days=days, limit=10)
    sessions = [s for s in (data or {}).get("data") or [] if isinstance(s, dict)]
    if not sessions:
        return ToolResult(fence("live_classes", f"No public live classes in the next {days} days."), found=False)
    lines = []
    for s in sessions[:10]:
        price = "free" if not s.get("is_paid") else (C.format_amount(s.get("price"), s.get("currency")) or "paid")
        lines.append(f"- title={s.get('title')} | starts_at={s.get('starts_at')} | ends_at={s.get('ends_at')} "
                     f"| timezone={s.get('timezone')} | price={price} | recorded={s.get('recorded')} "
                     f"| register={s.get('registration_url') or ''}"
                     + (f" | about={str(s.get('description_text'))[:200]}" if s.get("description_text") else ""))
    card = C.live_class_card(sessions)
    return ToolResult(fence("live_classes", "\n".join(lines)), [card] if card else [],
                      [{"type": "live_session", "id": s.get("session_id")} for s in sessions[:10]])


async def _search_knowledge(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    query = _str_arg(args, "query", 300)
    if not query:
        return ToolResult(fence("knowledge", "No query given."), found=False)
    kinds = [k for k, flag in (("FAQ", "faqs"), ("NOTICE", "notices")) if ctx.flag(flag)]
    hits = await K.search_knowledge(ctx.institute_id, ctx.site_tag, query, kinds, top_k=4)
    blocks, cards, sources = [], [], []
    for h in hits:
        if h.get("kind") == "NOTICE":
            blocks.append(fence("notice", f"{h.get('title')}\n{h.get('body')}", ends_at=h.get("ends_at")))
            if not any(c["type"] == "notice" for c in cards):
                card = C.notice_card(h)
                if card:
                    cards.append(card)
        else:
            blocks.append(fence("faq", f"Q: {h.get('title')}\nA: {h.get('body')}"))
        sources.append({"type": h.get("kind", "").lower(), "id": h.get("id")})
    if ctx.flag("linkedKbIds"):
        for h in await K.search_linked_kbs(ctx.institute_id, ctx.settings["knowledge"]["linkedKbIds"], query, top_k=2):
            blocks.append(fence("knowledge_base", h.get("content") or "", title=h.get("title"), link=h.get("url")))
            sources.append({"type": "kb", "source_id": h.get("source_id")})
    if len(blocks) < 2:
        for h in await K.search_institute_info(ctx.institute_id, query, top_k=2):
            blocks.append(fence("institute_info", h.get("content") or "", title=h.get("title")))
            sources.append({"type": "institute_info"})
    if not blocks:
        return ToolResult(fence("knowledge", "Nothing in the institute's FAQs, notices or knowledge covers this."),
                          found=False)
    return ToolResult("\n".join(blocks), cards, sources)


def _contact_page(ctx: SiteContext) -> Optional[Dict[str, Any]]:
    for page in (ctx.catalogue or {}).get("pages") or []:
        if not isinstance(page, dict):
            continue
        hay = f"{page.get('route') or ''} {page.get('title') or ''}".lower()
        if "contact" in hay:
            return page
    return None


async def _get_contact_info(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    sup = ctx.settings.get("support") or {}
    login = sup.get("loginUrl") or ("/login" if ctx.channel == "HOSTED" else None)
    page = _contact_page(ctx)
    page_href = site_path(ctx, page.get("route")) if page else None
    lines = [f"institute={ctx.site_name or ''}"]
    for k in ("email", "phone", "whatsapp"):
        if sup.get(k):
            lines.append(f"{k}={sup[k]}")
    if login:
        lines.append(f"login={login}")
    if page_href:
        lines.append(f"contact_page={page_href}")
    cards: List[Dict[str, Any]] = []
    info = C.contact_info_card(email=sup.get("email"), phone=sup.get("phone"), whatsapp=sup.get("whatsapp"),
                               login_url=login)
    if info:
        cards.append(info)
    if page_href:
        link = C.page_link_card(page.get("title") or "Contact us", page_href)
        if link:
            cards.append(link)
    found = len(lines) > 1
    if not found:
        lines.append("No contact details are configured. Offer the contact form instead (offer_contact).")
    return ToolResult(fence("contact", "\n".join(lines)), cards, [{"type": "contact"}], found=found)


_DEFAULT_FIELDS = [
    {"key": "full_name", "label": "Your name", "type": "text", "required": True},
    {"key": "phone", "label": "Phone", "type": "phone", "required": False},
    {"key": "email", "label": "Email", "type": "email", "required": False},
]
# Same sets as the widget's contact-form.ts roleOf(): one name/email/phone input each.
_NAME_KEYS = {"full_name", "fullname", "name", "your_name", "student_name", "parent_name"}
_EMAIL_KEYS = {"email", "email_address", "emailaddress", "mail"}
_PHONE_KEYS = {"phone", "mobile", "phone_number", "mobile_number", "phonenumber", "mobilenumber", "contact_number",
               "whatsapp"}
_TYPE_MAP = {"text": "text", "textfield": "text", "email": "email", "phone": "phone", "number": "number",
             "dropdown": "dropdown", "select": "dropdown", "textarea": "textarea", "date": "date",
             "checkbox": "checkbox", "mobile": "phone", "tel": "phone"}
# admin_core's CustomFieldKeyGenerator makes "<slug>_inst_<instituteId>[_<n>]": > 64 characters
# with a UUID institute id, past the widget's and the lead API's key limit.
_INST_SUFFIX = re.compile(r"_inst_[A-Za-z0-9-]+(?:_\d+)?$")
_KEY_UNSAFE = re.compile(r"[^A-Za-z0-9_.-]+")
FIELD_KEY_MAX = 64


def strip_inst_suffix(key: Any) -> str:
    """The field key without admin_core's "_inst_<instituteId>[_<n>]" suffix."""
    return _INST_SUFFIX.sub("", str(key or "").strip())


def short_field_key(key: Any) -> str:
    """A campaign field key without admin_core's "_inst_<instituteId>" suffix, form-safe, ≤ 64."""
    k = strip_inst_suffix(key)
    k = _KEY_UNSAFE.sub("_", k).strip("_.-")
    return k[:FIELD_KEY_MAX]


def field_role(key: str, ftype: str) -> Optional[str]:
    """name | email | phone for the visitor's own contact fields (the widget pulls these out), else None."""
    k = short_field_key(key).lower()
    if ftype == "email" or k in _EMAIL_KEYS:
        return "email"
    if ftype == "phone" or k in _PHONE_KEYS:
        return "phone"
    if k in _NAME_KEYS:
        return "name"
    return None


def _parse_options(config: Any) -> Optional[List[str]]:
    if not isinstance(config, str) or not config.strip() or config.strip() == "{}":
        return None
    raw = config.strip()
    if not raw.startswith(("[", "{")):
        return [o.strip() for o in raw.split(",") if o.strip()][:30] or None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    if isinstance(parsed, dict):
        if isinstance(parsed.get("options"), list):
            parsed = parsed["options"]
        else:
            s = parsed.get("coommaSepartedOptions") or parsed.get("commaSeparatedOptions")
            return [o.strip() for o in s.split(",") if o.strip()][:30] if isinstance(s, str) else None
    if isinstance(parsed, list):
        out = []
        for o in parsed:
            label = o.get("label") or o.get("value") or o.get("name") if isinstance(o, dict) else o
            if label not in (None, ""):
                out.append(str(label)[:80])
        return out[:30] or None
    return None


@dataclass
class CampaignField:
    """One visible campaign field: what the card shows (``card``) and the custom field it fills."""
    card: Dict[str, Any]
    field_id: Optional[str]     # custom_fields.id — what admin_core's saveCustomFieldValues resolves exactly
    role: Optional[str]         # name | email | phone | None


def _campaign_field_specs(campaign: Optional[Dict[str, Any]]) -> List[CampaignField]:
    rows = [f for f in (campaign or {}).get("institute_custom_fields") or []
            if isinstance(f, dict) and isinstance(f.get("custom_field"), dict) and f.get("status") != "DELETED"]
    rows.sort(key=lambda f: f.get("individual_order") or 0)
    out: List[CampaignField] = []
    used: set = set()
    for f in rows:
        cf = f["custom_field"]
        raw_key = str(cf.get("fieldKey") or cf.get("field_key") or "").strip()
        if not raw_key or cf.get("isHidden") or cf.get("is_hidden"):
            continue
        key = short_field_key(raw_key) or "field"
        base, n = key, 2
        while key.lower() in used:            # two fields with one slug: keep both, distinct keys
            suffix = f"_{n}"
            key = base[:FIELD_KEY_MAX - len(suffix)] + suffix
            n += 1
        used.add(key.lower())
        ftype = _TYPE_MAP.get(str(cf.get("fieldType") or cf.get("field_type") or "text").lower(), "text")
        card: Dict[str, Any] = {"key": key, "label": str(cf.get("fieldName") or cf.get("field_name") or key)[:120],
                                "type": ftype, "required": bool(cf.get("isMandatory") or f.get("is_mandatory"))}
        if ftype == "dropdown":
            opts = _parse_options(cf.get("config"))
            if opts:
                card["options"] = opts
            else:
                card["type"] = "text"
        fid = cf.get("id") or f.get("field_id")
        out.append(CampaignField(card=card, field_id=str(fid)[:64] if fid else None, role=field_role(key, ftype)))
    return out[:12]


def campaign_fields(campaign: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The campaign's own form fields in contact_form shape, or name/phone/email.

    Keys are SHORT and stable: the field key without the "_inst_<instituteId>" suffix (a key over
    64 characters is dropped by the widget and refused by the lead API). The custom field each key
    fills stays on the server (``campaign_field_map``) and is looked up again on submit."""
    fields = [dict(spec.card) for spec in _campaign_field_specs(campaign)]
    if not fields:
        return [dict(f) for f in _DEFAULT_FIELDS]
    if not any(field_role(f["key"], f["type"]) == "name" for f in fields):
        fields.insert(0, dict(_DEFAULT_FIELDS[0]))
    return fields[:12]


def campaign_field_map(campaign: Optional[Dict[str, Any]]) -> Dict[str, CampaignField]:
    """card key (lower case) → the campaign field it stands for; the server-side half of campaign_fields."""
    return {spec.card["key"].lower(): spec for spec in _campaign_field_specs(campaign)}


def campaign_for(ctx: SiteContext, kind: str, stream_slug: Optional[str] = None) -> Optional[str]:
    if kind != "SALES":
        return None
    leads = ctx.settings.get("leads") or {}
    if stream_slug and (leads.get("streamCampaigns") or {}).get(stream_slug):
        return leads["streamCampaigns"][stream_slug]
    return leads.get("campaignId")


async def _offer_contact(args: Dict[str, Any], ctx: SiteContext) -> ToolResult:
    kind = "SUPPORT" if str(args.get("kind") or "").upper() == "SUPPORT" else "SALES"
    reason = _str_arg(args, "reason", 200) or ("so our team can help you" if kind == "SUPPORT"
                                                 else "so our counsellor can call you")
    if ctx.lead_status == kind:
        return ToolResult(fence("contact_form", "The visitor already left their details in this chat; "
                                                "tell them the team will get in touch. Do not show the form again."),
                          found=True)
    if ctx.logged_in and kind == "SALES":
        res = await _get_contact_info({}, ctx)
        res.text = fence("contact_form", "The visitor is a logged-in learner: never ask them for contact details. "
                                         "Share the contact options instead.") + "\n" + res.text
        return res
    if ctx.contact_forms_shown >= 2:
        return ToolResult(fence("contact_form", "The form was already shown twice in this chat; point the visitor "
                                                "to it instead of showing it again."), found=True)
    stream = None
    ids = [str(x)[:64] for x in (args.get("course_ids") or []) if isinstance(x, (str, int))][:3]
    if ids and kind == "SALES":
        course = await ac.catalog_course(ctx.institute_id, ids[0])
        st = (course or {}).get("stream")
        stream = st.get("slug") if isinstance(st, dict) else None
    campaign_id = campaign_for(ctx, kind, stream)
    campaign = await ac.campaign(ctx.institute_id, campaign_id) if campaign_id else None
    fields = campaign_fields(campaign)
    consent = (ctx.settings.get("leads") or {}).get("consentText") or (
        f"By sending this you agree that {ctx.site_name or 'we'} may contact you about your enquiry.")
    card = C.contact_form_card(kind=kind, reason=reason, campaign_id=campaign_id if campaign else None,
                               fields=fields, consent_text=consent)
    ctx.contact_forms_shown += 1
    return ToolResult(fence("contact_form", f"A {kind.lower()} contact form is now shown to the visitor ({reason}). "
                                            "Tell them briefly why and that a person will reply; do not ask them to "
                                            "type their details in the chat."),
                      [card], [{"type": "contact_form", "kind": kind}])


# ── registry ──────────────────────────────────────────────────────────────

def _obj(props: Dict[str, Any], required: Sequence[str] = ()) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": list(required)}


SITE_TOOLS: Dict[str, SiteToolSpec] = {s.name: s for s in (
    SiteToolSpec(
        "find_on_site",
        "Search this website's own pages and blog articles (about, contact, policies, exam guides, articles, "
        "sections) for a topic. Use for questions about the institute, policies, navigation ('where is…'), and "
        "topics the site explains (an exam's eligibility, syllabus or dates when the site has a guide on it).",
        _obj({"query": {"type": "string", "description": "What to look for, in the visitor's words."}}, ["query"]),
        _find_on_site, ("pages",), ("page_link",)),
    SiteToolSpec(
        "search_courses",
        "Find courses on this site. All filters optional. Use for discovery ('courses for parents', 'free courses', "
        "'in Hindi', 'cheapest', 'most popular'). Returns up to 4 courses with ids, prices as the site shows them, "
        "formats, languages and links.",
        _obj({
            "q": {"type": "string", "description": "Key words from the visitor's request (the topic, subject, "
                                                   "exam, series, author or month and year), not a whole sentence. "
                                                   "Every word must match a course, so leave out filler words."},
            "stream": {"type": "string", "description": "Stream slug."},
            "category": {"type": "string", "description": "Category slug."},
            "format": {"type": "string", "description": "Format key, e.g. live, recorded, ebook."},
            "language": {"type": "string", "description": "Language code, e.g. hi, en."},
            "level": {"type": "string"},
            "price": {"type": "string", "enum": ["free", "paid"]},
            "price_max": {"type": "number", "description": "Maximum price."},
            "badge": {"type": "string", "description": "e.g. new, bestseller."},
            "sort": {"type": "string", "enum": list(_SORTS)},
            "limit": {"type": "integer", "minimum": 1, "maximum": 4},
        }),
        _search_courses, ("courses",), ("course_list",)),
    SiteToolSpec(
        "get_course",
        "Full details of one course by id (from search_courses): price, versions, description, who it is for, "
        "instructors, FAQs, and optionally its outline.",
        _obj({"course_id": {"type": "string"}, "language": {"type": "string"},
              "include_outline": {"type": "boolean"}}, ["course_id"]),
        _get_course, ("courses",), ("course",)),
    SiteToolSpec(
        "compare_courses",
        "Compare 2 or 3 courses side by side (price, format, language, level, duration).",
        _obj({"course_ids": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 3}},
             ["course_ids"]),
        _compare_courses, ("courses",), ("compare",)),
    SiteToolSpec(
        "get_learning_paths",
        "List the site's learning paths (ordered course sequences).",
        _obj({}), _get_learning_paths, ("courses",), ()),
    SiteToolSpec(
        "get_learning_path",
        "One learning path's steps by its code, e.g. to answer 'which should I start with?'.",
        _obj({"code": {"type": "string"}}, ["code"]), _get_learning_path, ("courses",), ("path",)),
    SiteToolSpec(
        "list_live_classes",
        "Upcoming PUBLIC live classes with dates, price and registration links.",
        _obj({"days": {"type": "integer", "minimum": 1, "maximum": 60}}),
        _list_live_classes, ("liveClasses",), ("live_class_list",)),
    SiteToolSpec(
        "search_knowledge",
        "Search the institute's FAQs, current notices (new batches, holidays, events) and linked knowledge bases. "
        "Use for policies (refund, payment, EMI, certificate, login help), announcements and topic questions.",
        _obj({"query": {"type": "string"}}, ["query"]),
        _search_knowledge, ("faqs", "notices", "linkedKbIds"), ("notice",)),
    SiteToolSpec(
        "get_contact_info",
        "The institute's contact options (email, phone, WhatsApp, login link, contact page).",
        _obj({}), _get_contact_info, None, ("contact_info", "page_link")),
    SiteToolSpec(
        "offer_contact",
        "Show the visitor a contact form so a person calls/emails them. ONLY when the visitor shows intent: wants "
        "to talk, needs enrolment help, group/bulk pricing, EMI/negotiation, or a question you could not answer. "
        "kind=SUPPORT for existing learners (login, access, certificate problems), else SALES.",
        _obj({"kind": {"type": "string", "enum": ["SALES", "SUPPORT"]},
              "reason": {"type": "string", "description": "Why we ask, shown to the visitor, e.g. "
                                                          "'so our counsellor can call you about Vedic Parenting'."},
              "course_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 3}}, ["kind", "reason"]),
        _offer_contact, None, ("contact_form",)),
)}


def offered_tools(ctx: SiteContext) -> List[SiteToolSpec]:
    return [t for t in SITE_TOOLS.values() if t.allowed(ctx)]


async def execute(name: str, raw_args: Any, ctx: SiteContext) -> ToolResult:
    """Run one tool call from the model, re-checking the gate at dispatch."""
    spec = SITE_TOOLS.get(name)
    if spec is None or not spec.allowed(ctx):
        return ToolResult(fence("error", f"The tool {name} is not available."), found=False)
    if isinstance(raw_args, str):
        try:
            raw_args = json.loads(raw_args or "{}")
        except ValueError:
            raw_args = {}
    args = raw_args if isinstance(raw_args, dict) else {}
    try:
        result = await spec.executor(args, ctx)
    except ac.AdminCoreUnavailable as exc:
        logger.warning("site-assistant tool %s: admin_core unavailable (%s)", name, exc)
        return ToolResult(fence("error", "That information is unavailable right now."), found=False)
    except Exception:  # noqa: BLE001
        logger.exception("site-assistant tool %s failed", name)
        return ToolResult(fence("error", "That information is unavailable right now."), found=False)
    result.cards = [c for c in (C.normalize(x) for x in result.cards) if c]
    return result


__all__ = ["SiteContext", "ToolResult", "SiteToolSpec", "SITE_TOOLS", "offered_tools", "execute", "fence",
           "campaign_fields", "campaign_field_map", "campaign_for", "field_role", "short_field_key", "strip_inst_suffix",
           "site_path",
           "language_of"]
