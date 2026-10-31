"""
`blog` / `blog_edit`: draft-only blog authoring for AI apps.

Posts are admin-core rows, so the tools are thin — what matters is containment:
create always saves a DRAFT with the MCP source, update/discard refuse anything
that is not a DRAFT, request_publish never publishes, bodies are nh3-cleaned
with the article profile (video embeds kept, foreign iframes and scripts
dropped), and the read side reports where posts appear without ever leaking
a draft's body into a `list`.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tools_blog as blog_mod  # noqa: E402
from app.services import website_data  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, ToolContext  # noqa: E402
from app.services.assistant_tools_blog import (  # noqa: E402
    execute_blog,
    execute_blog_edit,
    sanitize_blog_html,
    slugify,
)

INST = "inst-1"


def principal(roles=("ADMIN",)):
    return PinnedPrincipal(user_id="user-1", institute_id=INST, full_name="Asha Rao", roles=list(roles),
                           permissions=[], is_root_user=False)


class _FakeDb:
    def execute(self, stmt, params=None):
        if "admin_portal_base_url" in str(stmt):
            return SimpleNamespace(first=lambda: ("admin.acme.edu",))
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])


def ctx(session_id=None):
    return ToolContext(db=_FakeDb(), principal=principal(), keys=(), bearer_token="jwt", session_id=session_id)


SITE = {
    "tag_name": "school", "status": "ACTIVE", "is_default": True,
    "catalogue_json": json.dumps({
        "pages": [
            {"id": "home", "route": "homepage", "components": [{"type": "heroSection", "enabled": True}]},
            {"id": "blog", "route": "blog", "components": [{"type": "blog", "enabled": True, "props": {}}]},
        ],
        "globalSettings": {},
    }),
}

DRAFT = {
    "id": "post-draft", "slug": "neet-last-30-days", "title": "Your last 30 days before NEET", "status": "DRAFT",
    "excerpt": "A day-by-day plan.", "content_html": "<h2>Plan</h2>" + "<p>word </p>" * 200, "category": "Study tips",
    "tags": ["NEET"], "source": "MCP", "author_name": "Asha Rao",
}
LIVE = {**DRAFT, "id": "post-live", "slug": "results-2026", "title": "Results 2026", "status": "PUBLISHED",
        "published_at": "2026-09-01T09:00:00Z", "source": "EDITOR"}


class Backend:
    """Records the admin-core calls the tools make and answers like the Java API."""

    def __init__(self):
        self.calls = []
        self.posts = {DRAFT["id"]: dict(DRAFT), LIVE["id"]: dict(LIVE)}

    async def admin_core(self, ctx, method, path, params=None, body=None, **kw):
        self.calls.append((method, path, params, body))
        if path.endswith("/course-catalogue/institute/get-all"):
            return [SITE]
        if path.endswith("/catalogue-blog/posts"):
            rows = list(self.posts.values())
            status = (params or {}).get("status")
            if status:
                rows = [r for r in rows if r["status"] == status]
            return {"content": [{k: v for k, v in r.items() if k != "content_html"} for r in rows],
                    "total_elements": len(rows), "categories": ["Study tips"]}
        if path.endswith("/catalogue-blog/post") and method == "GET":
            return self.posts.get((params or {}).get("postId")) or {"error": "fetch_failed", "status": 400}
        if path.endswith("/catalogue-blog/post") and method == "POST":
            new = {**body, "id": "post-new", "slug": body.get("slug") or slugify(body["title"])}
            self.posts[new["id"]] = new
            return new
        if path.endswith("/catalogue-blog/post") and method == "PUT":
            post = self.posts[(params or {})["postId"]]
            post.update(body)
            return post
        if path.endswith("/catalogue-blog/post") and method == "DELETE":
            self.posts.pop((params or {})["postId"], None)
            return ""
        return {"error": "fetch_failed", "status": 404}


@pytest.fixture
def backend(monkeypatch):
    b = Backend()
    monkeypatch.setattr(blog_mod, "_admin_core_json", b.admin_core)
    monkeypatch.setattr(website_data, "_admin_core_json", b.admin_core)
    # No learner domain lookups in tests: site_url() returns a fixed origin.
    monkeypatch.setattr(blog_mod, "site_url", lambda ctx, tag: f"https://learn.acme.edu/{tag}")
    return b


async def run(tool, args, c=None):
    fn = execute_blog if tool == "blog" else execute_blog_edit
    return json.loads(await fn(args, c or ctx()))


# ── registration ──────────────────────────────────────────────────────────
def test_tools_are_registered_as_read_and_draft_write():
    assert ASSISTANT_TOOLS["blog"].mode == "READ"
    assert ASSISTANT_TOOLS["blog"].default_roles == ["ADMIN"]
    edit = ASSISTANT_TOOLS["blog_edit"]
    assert edit.mode == "WRITE" and not edit.default_enabled and not edit.default_roles
    assert edit.key() == "blog_edits"


# ── sanitiser ─────────────────────────────────────────────────────────────
def test_sanitizer_keeps_article_markup_and_video_embeds():
    warnings = []
    out = sanitize_blog_html(
        '<h2>Plan</h2><figure><img src="https://cdn.acme.edu/a.png" alt="a"><figcaption>cap</figcaption></figure>'
        '<table><tr><th>A</th><td>1</td></tr></table><pre><code>x</code></pre>'
        '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>',
        warnings,
    )
    assert "<h2>Plan</h2>" in out and "<figcaption>cap</figcaption>" in out and "<th>A</th>" in out
    assert "youtube.com/embed/abc" in out
    assert warnings == []


def test_sanitizer_drops_scripts_handlers_and_foreign_iframes():
    warnings = []
    out = sanitize_blog_html(
        '<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>'
        '<iframe src="https://evil.example.com/x"></iframe><img src="data:image/png;base64,AAAA">',
        warnings,
    )
    assert "script" not in out and "onclick" not in out and "javascript:" not in out
    assert "evil.example.com" not in out
    assert "data:image" not in out
    assert any("iframe" in w for w in warnings)


def test_slugify():
    assert slugify("Your Last 30 Days — Before NEET!") == "your-last-30-days-before-neet"
    assert len(slugify("x" * 500)) <= 120


# ── blog (READ) ───────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_list_reports_posts_placements_and_never_bodies(backend):
    out = await run("blog", {"action": "list"})
    assert out["count"] == 2 and out["categories"] == ["Study tips"]
    assert all("content_html" not in p for p in out["posts"])
    assert out["shown_on"] == [{
        "site": "school", "site_status": "ACTIVE", "page_route": "blog",
        "page_url": "https://learn.acme.edu/school/blog",
        "post_url_pattern": "https://learn.acme.edu/school/blog/<slug>",
    }]
    assert out["editor_url"] == "https://admin.acme.edu/manage-pages?blog=list"


@pytest.mark.asyncio
async def test_list_filters_by_status(backend):
    out = await run("blog", {"action": "list", "status": "DRAFT"})
    assert [p["id"] for p in out["posts"]] == ["post-draft"]
    assert (await run("blog", {"action": "list", "status": "nope"}))["error"] == "bad_request"


@pytest.mark.asyncio
async def test_get_returns_body_and_public_urls_only_when_published(backend):
    live = await run("blog", {"action": "get", "post_id": "post-live"})
    assert live["public_urls"] == ["https://learn.acme.edu/school/blog/results-2026"]
    assert live["content_html"].startswith("<h2>Plan</h2>")
    assert live["word_count"] > 100
    draft = await run("blog", {"action": "get", "slug": "neet-last-30-days"})
    assert draft["post"]["id"] == "post-draft" and "public_urls" not in draft
    assert draft["editor_url"].endswith("/manage-pages?blog=post-draft")
    assert (await run("blog", {"action": "get", "post_id": "missing"}))["error"] == "unknown_post"


@pytest.mark.asyncio
async def test_placements_hint_when_no_page_has_a_blog(backend, monkeypatch):
    async def no_blog(ctx, method, path, params=None, body=None, **kw):
        return [{**SITE, "catalogue_json": json.dumps({"pages": [{"route": "home", "components": []}]})}]
    monkeypatch.setattr(website_data, "_admin_core_json", no_blog)
    out = await run("blog", {"action": "placements"})
    assert out["count"] == 0 and "No website page has a Blog section" in out["hint"]


# ── blog_edit (WRITE) ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_saves_a_draft_with_mcp_source_and_sanitised_body(backend):
    out = await run("blog_edit", {
        "action": "create", "title": "Your last 30 days before NEET",
        "content_html": "<h2>Plan</h2><script>x()</script>" + "<p>study hard every day</p>" * 60,
        "excerpt": "A day-by-day plan.", "category": "Study tips", "tags": ["NEET", " Biology ", ""],
        "cover_image_url": "http://insecure.example.com/x.png",
    })
    assert out["status"] == "DRAFT"
    method, path, params, body = backend.calls[-1]
    assert (method, path) == ("POST", "/admin-core-service/v1/catalogue-blog/post")
    assert params == {"instituteId": INST}
    assert body["status"] == "DRAFT" and body["source"] == "MCP"
    assert body["author_name"] == "Asha Rao"           # from the pinned principal
    assert body["tags"] == ["NEET", "Biology"]
    assert "<script>" not in body["content_html"]
    assert "cover_image_url" not in body                # http:// dropped, with a warning
    assert any("https" in w for w in out["warnings"])
    assert out["editor_url"] == "https://admin.acme.edu/manage-pages?blog=post-new"
    assert "nothing is live" in out["next"].lower()


@pytest.mark.asyncio
async def test_create_from_the_in_product_assistant_is_marked_ai(backend):
    await run("blog_edit", {"action": "create", "title": "T", "content_html": "<p>body</p>"}, ctx(session_id="chat-1"))
    assert backend.calls[-1][3]["source"] == "AI"


@pytest.mark.asyncio
async def test_create_requires_title_and_body(backend):
    out = await run("blog_edit", {"action": "create", "title": "T"})
    assert out["error"] == "missing_argument" and out["needs"] == ["content_html"]
    assert backend.calls == []


@pytest.mark.asyncio
async def test_update_changes_only_drafts(backend):
    out = await run("blog_edit", {"action": "update", "post_id": "post-draft", "excerpt": "Better teaser"})
    assert out["changed"] == ["excerpt"]
    assert backend.posts["post-draft"]["excerpt"] == "Better teaser"
    refused = await run("blog_edit", {"action": "update", "post_id": "post-live", "title": "Hacked"})
    assert refused["error"] == "not_a_draft" and refused["status"] == "PUBLISHED"
    assert backend.posts["post-live"]["title"] == "Results 2026"
    assert refused["editor_url"].endswith("?blog=post-live")


@pytest.mark.asyncio
async def test_update_never_sets_status(backend):
    await run("blog_edit", {"action": "update", "post_id": "post-draft", "status": "PUBLISHED", "title": "T2"})
    body = backend.calls[-1][3]
    assert "status" not in body and body["title"] == "T2"


@pytest.mark.asyncio
async def test_request_publish_reports_readiness_and_the_dashboard_link_only(backend):
    out = await run("blog_edit", {"action": "request_publish", "post_id": "post-draft"})
    assert out["ready"] is True
    assert out["will_appear_on"][0]["page_route"] == "blog"
    assert "press Publish" in out["message"]
    assert backend.posts["post-draft"]["status"] == "DRAFT"          # nothing was published
    assert not any(m in ("POST", "PUT") for m, *_ in backend.calls)  # read-only round trip
    thin = dict(DRAFT, id="post-thin", content_html="<p>hi</p>", excerpt="", cover_image_url=None)
    backend.posts["post-thin"] = thin
    out = await run("blog_edit", {"action": "request_publish", "post_id": "post-thin"})
    assert out["ready"] is False and any(i["severity"] == "fix" for i in out["audit"])


@pytest.mark.asyncio
async def test_discard_deletes_only_drafts(backend):
    assert (await run("blog_edit", {"action": "discard", "post_id": "post-live"}))["error"] == "not_a_draft"
    assert "post-live" in backend.posts
    out = await run("blog_edit", {"action": "discard", "post_id": "post-draft"})
    assert out["discarded"] == "post-draft" and "post-draft" not in backend.posts


@pytest.mark.asyncio
async def test_unknown_action_lists_the_available_ones(backend):
    out = await run("blog_edit", {"action": "publish"})
    assert out["error"] == "unknown_action" and out["available"] == ["create", "update", "request_publish", "discard"]
