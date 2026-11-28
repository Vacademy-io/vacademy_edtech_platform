"""What the assistant can look things up in, besides the catalogue.

* Site pages: the published catalogue's pages (and its footer), split into
  sections, chunked (~800 chars), embedded (768-d, the platform embedder) and
  stored in site_assistant_page_chunk. When the site has a blog section, the
  institute's published blog posts are indexed with it, each at its own
  address (<blog page>/<slug>). Re-indexed when the published pages' or the
  posts' fingerprint changes; one pod at a time (site_assistant_index_state is
  the lock). Not billed (platform cost); logged.
* FAQs and notices: site_assistant_knowledge rows, embedded on create/update.
* Linked knowledge bases: retrieval only, through kb/retrieval.py, and only
  for bases the institute owns or may use.

Searches fall back to keyword matching when an embedding is not available,
so an embedder outage degrades answers instead of breaking them.
"""
from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence
from urllib.parse import quote

from sqlalchemy import text

from ..db import db_session
from ..services.catalogue_summary import heading_of, job_slug, strip_html, walk_components
from . import repository as repo
from .guards import words_for_search

logger = logging.getLogger(__name__)

INDEX_VERSION = "sa-index-v2"
CHUNK_CHARS = 800
MAX_SITE_CHARS = 400_000
MAX_CHUNKS = 600
MAX_BLOG_POSTS = 200
MAX_BLOG_CHARS = 1_000_000
MAX_BLOG_CHUNKS = 1_400
BLOG_TYPES = {"blog", "blogList"}
PAGE_THRESHOLD = 0.35
KNOWLEDGE_THRESHOLD = 0.35
_SKIP_KEYS = {"id", "url", "href", "src", "image", "imageurl", "logo", "icon", "color", "background", "style",
              "classname", "variant", "anchorid", "type", "audienceid", "campaignid", "target", "link", "css",
              "backgroundimage", "posterimage", "thumbnail", "avatar", "photo", "alignment", "layout", "theme"}
_SKIP_TYPES = {"header", "cartComponent", "leadForm", "contactForm", "newsletterSignup", "videoEmbed", "imageGallery"}
_NOT_TEXT_RE = re.compile(r"<(style|script|svg|noscript)\b.*?</\1\s*>", re.I | re.S)
_JUNK_RE = re.compile(r"^(#[0-9a-f]{3,8}|https?:\S+|[a-z0-9_\-]+|\d+(px|rem|em|%)?|rgba?\(.*\))$", re.I)


# ── extraction ────────────────────────────────────────────────────────────

def _strings(node: Any, out: List[str], depth: int = 0) -> None:
    if depth > 7 or node is None:
        return
    if isinstance(node, str):
        s = strip_html(node, 20_000)
        if len(s) >= 3 and not _JUNK_RE.match(s.strip()):
            out.append(s)
    elif isinstance(node, list):
        for v in node:
            _strings(v, out, depth + 1)
    elif isinstance(node, dict):
        for k, v in node.items():
            if str(k).lower() in _SKIP_KEYS or k == "slots":
                continue
            _strings(v, out, depth + 1)


def _page_visible(page: Dict[str, Any]) -> bool:
    if page.get("hidden") is True or page.get("enabled") is False or page.get("draft") is True:
        return False
    return bool(page.get("route") is not None or page.get("id"))


def extract_sections(catalogue: Dict[str, Any]) -> List[Dict[str, Any]]:
    """[{page_route, page_title, section_id, heading, text}] in document order.

    Repeated blocks (a footer on every page) are kept once."""
    out: List[Dict[str, Any]] = []
    seen: set = set()
    total = 0
    for page in (catalogue or {}).get("pages") or []:
        if not isinstance(page, dict) or not _page_visible(page):
            continue
        route = str(page.get("route") or "").strip()
        title = strip_html(page.get("title") or (page.get("seo") or {}).get("metaTitle") or route or "Home", 160)
        for comp in walk_components(page.get("components")):
            if comp.get("enabled") is False or comp.get("type") in _SKIP_TYPES:
                continue
            strings: List[str] = []
            props = comp.get("props") or {}
            if comp.get("type") == "htmlPage":
                strings.append(strip_html(str(props.get("html") or ""), 20_000))
            elif comp.get("type") == "jobOpenings":
                # Each job is a page of its own (<page>/<slug>), like a blog post:
                # index it there, and only the section's own copy on the page.
                for sec in job_sections(props, route):
                    key = hashlib.sha1(sec["text"].encode()).hexdigest()
                    if key in seen:
                        continue
                    seen.add(key)
                    total += len(sec["text"])
                    if total > MAX_SITE_CHARS:
                        return out
                    out.append(sec)
                _strings({k: v for k, v in props.items() if k != "jobs"}, strings)
            else:
                _strings(props, strings)
            body = "\n".join(dict.fromkeys(s for s in strings if s))
            if len(body) < 20:
                continue
            key = hashlib.sha1(body.encode()).hexdigest()
            if key in seen:
                continue
            seen.add(key)
            total += len(body)
            if total > MAX_SITE_CHARS:
                return out
            out.append({"page_route": route, "page_title": title, "section_id": comp.get("anchorId") or comp.get("id"),
                        "heading": heading_of(comp) or None, "text": body})
    footer = _footer_section(catalogue, seen, _home_title(catalogue))
    if footer and total + len(footer["text"]) <= MAX_SITE_CHARS:
        out.append(footer)
    return out


def _home_title(catalogue: Dict[str, Any]) -> str:
    """The title of the page the site opens on (route "" / "home", else the first page)."""
    pages = [p for p in (catalogue or {}).get("pages") or [] if isinstance(p, dict) and _page_visible(p)]
    home = next((p for p in pages if str(p.get("route") or "").strip().strip("/").lower() in ("", "home", "index")),
                pages[0] if pages else {})
    return strip_html(home.get("title") or (home.get("seo") or {}).get("metaTitle") or "Home", 160)


def _footer_section(catalogue: Dict[str, Any], seen: set, home_title: str) -> Optional[Dict[str, Any]]:
    """The site-wide footer (phone, email, address, links' labels), once, as part of the home page."""
    layout = ((catalogue or {}).get("globalSettings") or {}).get("layout") or {}
    footer = layout.get("footer") if isinstance(layout, dict) else None
    if not isinstance(footer, dict) or footer.get("enabled") is False:
        return None
    strings: List[str] = []
    _strings(footer.get("props") or {}, strings)
    body = "\n".join(dict.fromkeys(s for s in strings if s))
    key = hashlib.sha1(body.encode()).hexdigest()
    if len(body) < 20 or key in seen:
        return None
    seen.add(key)
    return {"page_route": "", "page_title": home_title, "section_id": footer.get("id"),
            "heading": None, "text": body}


def blog_route(catalogue: Dict[str, Any]) -> Optional[str]:
    """Where the site opens a blog post: the route of its blog page (route "blog" first), else None."""
    found: List[str] = []
    for page in (catalogue or {}).get("pages") or []:
        if not isinstance(page, dict) or not _page_visible(page):
            continue
        if any(c.get("type") in BLOG_TYPES and c.get("enabled") is not False
               for c in walk_components(page.get("components"))):
            route = str(page.get("route") or "").strip().strip("/")
            if route and route.lower() not in ("home", "index"):
                found.append(route)
    if not found:
        return None
    return next((r for r in found if r.lower() == "blog"), found[0])


def job_sections(props: Dict[str, Any], route: str) -> List[Dict[str, Any]]:
    """One section per visible job of a jobOpenings block, at the job's own address.

    Slugs follow the learner rule (catalogue_summary.job_slug; repeats get -2, -3…);
    on the home page a job opens at ?job=<slug>."""
    out: List[Dict[str, Any]] = []
    used: set = set()
    jobs = props.get("jobs") if isinstance(props.get("jobs"), list) else []
    base = str(route or "").strip().strip("/")
    on_home = base.lower() in ("", "home", "homepage", "index")
    for i, job in enumerate(jobs):
        if not isinstance(job, dict) or job.get("enabled") is False:
            continue
        title = strip_html(job.get("title") or "", 160)
        if not title:
            continue
        root = job_slug(job.get("slug")) or job_slug(job.get("title")) or f"job-{i + 1}"
        slug, n = root, 2
        while slug in used:
            slug, n = f"{root}-{n}", n + 1
        used.add(slug)
        meta = [job.get("summary"), job.get("location"), job.get("jobType"), job.get("compensation")]
        meta += [f"{d.get('label') or ''}: {d.get('value') or ''}" for d in job.get("details") or [] if isinstance(d, dict)]
        parts = [strip_html(str(m), 2_000) for m in meta if m] + [blog_plain_text(job.get("description"))]
        body = "\n".join(x for x in parts if x and x.strip(": ")).strip()
        if len(body) < 20:
            continue
        address = f"?job={quote(slug)}" if on_home else f"{base}/{quote(slug)}"
        out.append({"page_route": address, "page_title": title, "section_id": None, "heading": None, "text": body})
    return out


def blog_plain_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return html.unescape(strip_html(_NOT_TEXT_RE.sub(" ", value), 10_000_000))


def blog_sections(posts: Sequence[Dict[str, Any]], route: str) -> List[Dict[str, Any]]:
    """One section per published post, addressed <blog page>/<slug>, within the blog budget."""
    out: List[Dict[str, Any]] = []
    total = 0
    for p in posts[:MAX_BLOG_POSTS]:
        slug = str(p.get("slug") or "").strip().strip("/")
        title = strip_html(p.get("title") or "", 160)
        if not slug or not title:
            continue
        parts = [blog_plain_text(p.get("excerpt")), blog_plain_text(p.get("content_html"))]
        body = "\n".join(x for x in parts if x).strip()
        if len(body) < 20:
            continue
        body = body[:max(0, MAX_BLOG_CHARS - total)]
        if not body:
            break
        total += len(body)
        heading = strip_html(p.get("category") or "", 80) or None
        out.append({"page_route": f"{route}/{slug}", "page_title": title, "section_id": None,
                    "heading": heading, "text": body})
    return out


def chunk_sections(sections: List[Dict[str, Any]], size: int = CHUNK_CHARS,
                   max_chunks: int = MAX_CHUNKS) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    for s in sections:
        body = s["text"]
        start = 0
        while start < len(body):
            end = min(len(body), start + size)
            if end < len(body):
                window = body[start:end]
                br = max(window.rfind(". "), window.rfind("\n"), window.rfind("। "))
                if br > size // 2:
                    end = start + br + 1
            piece = body[start:end].strip()
            if piece:
                prefix = s["page_title"] + (f" › {s['heading']}" if s.get("heading") else "")
                chunks.append({"page_route": s["page_route"], "page_title": s["page_title"],
                               "section_id": s.get("section_id"), "heading": s.get("heading"),
                               "content": f"{prefix}\n{piece}"[:CHUNK_CHARS + 200]})
            start = end
        if len(chunks) >= max_chunks:
            break
    return chunks[:max_chunks]


def fingerprint(catalogue: Dict[str, Any], blogs: Optional[str] = None) -> str:
    """sha256 of the published pages, footer and blog posts' stamp (other settings edits do not re-index)."""
    pages = (catalogue or {}).get("pages") or []
    layout = ((catalogue or {}).get("globalSettings") or {}).get("layout") or {}
    footer = layout.get("footer") if isinstance(layout, dict) else None
    blob = json.dumps({"v": INDEX_VERSION, "pages": pages, "footer": footer, "blogs": blogs},
                      sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


def blog_stamp(institute_id: str, catalogue: Dict[str, Any]) -> Optional[str]:
    """sha256 of the published posts' ids and edit times when the site shows a blog, else None."""
    if not blog_route(catalogue):
        return None
    try:
        with db_session() as db:
            rows = repo.blog_post_stamps(db, institute_id, MAX_BLOG_POSTS)
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant: blog posts unreadable for %s (%s)", institute_id, exc)
        return None
    blob = json.dumps([[r.get("id"), r.get("updated_at")] for r in rows], default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


def site_fingerprint(institute_id: str, catalogue: Dict[str, Any]) -> str:
    return fingerprint(catalogue, blog_stamp(institute_id, catalogue))


def _blog_chunks(institute_id: str, catalogue: Dict[str, Any]) -> List[Dict[str, Any]]:
    route = blog_route(catalogue)
    if not route:
        return []
    try:
        with db_session() as db:
            posts = repo.blog_posts(db, institute_id, MAX_BLOG_POSTS)
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant: blog posts unreadable for %s (%s); indexing pages only", institute_id, exc)
        return []
    return chunk_sections(blog_sections(posts, route), max_chunks=MAX_BLOG_CHUNKS)


# ── embeddings ────────────────────────────────────────────────────────────

class _Embedder:
    """The platform embedder (OpenRouter gemini-embedding-001, 768-d)."""

    async def documents(self, texts: List[str], institute_id: str) -> List[Optional[List[float]]]:
        from ..services.api_key_resolver import ApiKeyResolver
        from ..services.embedding_service import EmbeddingService
        with db_session() as db:
            svc = EmbeddingService(ApiKeyResolver(db))
            try:
                return await svc.embed_batch(texts, institute_id)
            finally:
                await svc.close()

    async def query(self, text_: str, institute_id: str) -> Optional[List[float]]:
        from ..services.api_key_resolver import ApiKeyResolver
        from ..services.embedding_service import EmbeddingService
        with db_session() as db:
            svc = EmbeddingService(ApiKeyResolver(db))
            try:
                vec = await svc.embed_query(text_, institute_id)
            finally:
                await svc.close()
        return vec if vec and any(vec) else None


embedder = _Embedder()


async def embed_query_safe(query: str, institute_id: str) -> Optional[List[float]]:
    try:
        return await embedder.query(query, institute_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant: query embedding failed (%s); keyword search only", exc)
        return None


# ── page index ────────────────────────────────────────────────────────────

_background: set = set()


def needs_index(institute_id: str, site_tag: str, fp: str) -> bool:
    with db_session() as db:
        state = repo.index_state(db, institute_id, site_tag)
    if not state or state.get("fingerprint") != fp or state.get("status") == "FAILED":
        return True
    if state.get("status") == "INDEXING":   # a holder that died mid-run is taken over after 15 min
        from datetime import datetime, timedelta, timezone
        try:
            started = datetime.fromisoformat(str(state.get("updated_at")))
        except ValueError:
            return True
        return started < datetime.now(timezone.utc) - timedelta(minutes=15)
    return False


async def index_site(institute_id: str, site_tag: str, catalogue: Dict[str, Any], *, force: bool = False) -> Dict[str, Any]:
    """Index the site's pages if this pod wins the lock. Returns {status, chunks}."""
    fp = site_fingerprint(institute_id, catalogue)
    with db_session() as db:
        if not repo.try_lock_index(db, institute_id, site_tag, fp, force=force):
            return {"status": "skipped"}
    sections = extract_sections(catalogue)
    chunks = chunk_sections(sections) + _blog_chunks(institute_id, catalogue)
    error: Optional[str] = None
    try:
        vectors = await embedder.documents([c["content"] for c in chunks], institute_id) if chunks else []
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant index %s/%s: embedding failed (%s); storing for keyword search",
                       institute_id, site_tag, exc)
        vectors, error = [None] * len(chunks), f"embeddings unavailable: {type(exc).__name__}"
    for c, v in zip(chunks, vectors):
        c["embedding"] = v
    if chunks and not any(c.get("embedding") for c in chunks) and not error:
        error = "embeddings unavailable"
    try:
        with db_session() as db:
            n = repo.replace_page_chunks(db, institute_id, site_tag, fp, chunks)
            repo.finish_index(db, institute_id, site_tag, fingerprint=fp, ok=error is None, chunks=n, error=error)
    except Exception as exc:  # noqa: BLE001
        logger.exception("site-assistant index %s/%s failed", institute_id, site_tag)
        with db_session() as db:
            repo.finish_index(db, institute_id, site_tag, fingerprint=fp, ok=False, error=str(exc)[:500])
        return {"status": "FAILED", "chunks": 0}
    logger.info("site-assistant index %s/%s: %d sections → %d chunks (platform cost, not billed)%s",
                institute_id, site_tag, len(sections), n, f"; {error}" if error else "")
    return {"status": "READY" if error is None else "FAILED", "chunks": n}


def ensure_index_background(institute_id: str, site_tag: str, catalogue: Dict[str, Any]) -> None:
    """Kick off indexing when the published pages changed. Never raises."""
    try:
        fp = site_fingerprint(institute_id, catalogue)
        if not needs_index(institute_id, site_tag, fp):
            return
        task = asyncio.get_running_loop().create_task(index_site(institute_id, site_tag, catalogue))
        _background.add(task)
        task.add_done_callback(_background.discard)
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant: could not start indexing %s/%s: %s", institute_id, site_tag, exc)


async def search_pages(institute_id: str, site_tag: str, query: str, top_k: int = 4) -> List[Dict[str, Any]]:
    vec = await embed_query_safe(query, institute_id)
    with db_session() as db:
        hits: List[Dict[str, Any]] = []
        if vec:
            hits = repo.search_page_chunks_vector(db, institute_id, site_tag, vec, top_k, PAGE_THRESHOLD)
        if not hits:
            hits = repo.search_page_chunks_keyword(db, institute_id, site_tag, words_for_search(query), top_k)
    return hits


# ── FAQs and notices ──────────────────────────────────────────────────────

async def embed_knowledge(institute_id: str, kid: str, title: str, body: str) -> bool:
    try:
        vecs = await embedder.documents([f"{title}\n{body}"[:4000]], institute_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant: FAQ/notice embedding failed for %s (%s)", kid, exc)
        return False
    vec = vecs[0] if vecs else None
    with db_session() as db:
        repo.set_knowledge_embedding(db, institute_id, kid, vec)
    return bool(vec)


async def search_knowledge(institute_id: str, site_tag: str, query: str, kinds: Sequence[str],
                           top_k: int = 4) -> List[Dict[str, Any]]:
    if not kinds:
        return []
    vec = await embed_query_safe(query, institute_id)
    with db_session() as db:
        hits: List[Dict[str, Any]] = []
        if vec:
            hits = repo.search_knowledge_vector(db, institute_id, site_tag, kinds, vec, top_k, KNOWLEDGE_THRESHOLD)
        have = {h["id"] for h in hits}
        if len(hits) < top_k:
            for h in repo.search_knowledge_keyword(db, institute_id, site_tag, kinds, words_for_search(query), top_k):
                if h["id"] not in have and len(hits) < top_k:
                    hits.append(h)
    return hits


# ── linked KBs + institute info ──────────────────────────────────────────

def _source_urls(db, source_ids: Iterable[str]) -> Dict[str, str]:
    ids = [s for s in dict.fromkeys(source_ids) if s]
    if not ids:
        return {}
    rows = db.execute(text("SELECT id, source_url FROM knowledge_base_source WHERE id = ANY(CAST(:ids AS TEXT[]))"),
                      {"ids": [str(i) for i in ids]}).fetchall()
    return {str(r[0]): r[1] for r in rows if isinstance(r[1], str) and r[1].startswith("https://")}


async def search_linked_kbs(institute_id: str, kb_ids: Sequence[str], query: str, top_k: int = 3) -> List[Dict[str, Any]]:
    """Passages from the site's linked KBs the institute may use, with source URLs when they have one."""
    from ..services.kb.repository import KbRepository
    from ..services.kb.retrieval import KbRetrievalService
    out: List[Dict[str, Any]] = []
    if not kb_ids:
        return out
    with db_session() as db:
        kb_repo = KbRepository(db)
        retrieval = KbRetrievalService(db)
        for kb_id in list(kb_ids)[:5]:
            try:
                kb = kb_repo.get_kb(kb_id, institute_id)
                if not kb or not kb_repo.is_usable(kb, institute_id):
                    continue
                hits = await retrieval.search(kb_id=kb_id, institute_id=institute_id, query=query,
                                              top_k=top_k, similarity_threshold=0.35)
            except Exception as exc:  # noqa: BLE001
                logger.warning("site-assistant: linked KB %s search failed: %s", kb_id, exc)
                continue
            for h in hits:
                out.append({"kb": kb.get("name"), "source_id": h.get("source_id"), "title": h.get("source_title"),
                            "content": (h.get("content_text") or "")[:1500],
                            "similarity": h.get("similarity_score")})
        urls = _source_urls(db, (h["source_id"] for h in out))
    for h in out:
        if urls.get(str(h.get("source_id"))):
            h["url"] = urls[str(h["source_id"])]
    out.sort(key=lambda h: -(h.get("similarity") or 0))
    return out[:top_k * 2]


async def search_institute_info(institute_id: str, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
    from ..services.kb.retrieval import KbRetrievalService
    try:
        with db_session() as db:
            hits = await KbRetrievalService(db).search_institute(institute_id=institute_id, query=query, top_k=top_k,
                                                                 purposes=["institute_info"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant: institute_info search failed: %s", exc)
        return []
    return [{"title": h.get("source_title") or h.get("knowledge_base_name"), "content": (h.get("content_text") or "")[:1500],
             "similarity": h.get("similarity_score")} for h in hits or []]
