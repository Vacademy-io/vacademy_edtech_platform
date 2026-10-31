"""Site Assistant page index: extraction, fingerprint, the one-pod lock, and
the embedder-outage fallback. Also token expiry and settings defaults."""
import asyncio
import copy
import time

from site_assistant_fakes import CATALOGUE, INST, TAG, install  # noqa: E402

from app.site_assistant import knowledge as K  # noqa: E402
from app.site_assistant import settings as S  # noqa: E402
from app.site_assistant import tokens as T  # noqa: E402

REAL_ENSURE = K.ensure_index_background   # captured before any test stubs it


def test_extract_sections_keeps_text_and_skips_forms_and_repeats():
    cat = copy.deepcopy(CATALOGUE)
    footer = {"id": "ft", "type": "footer", "props": {"text": "Brahm Varchas, Shantikunj Haridwar, call +91 99999 00000"}}
    for p in cat["pages"]:
        p["components"].append(dict(footer))
    cat["pages"][0]["components"].append({"id": "lf", "type": "leadForm", "props": {"title": "Enquire now please"}})
    cat["pages"][1]["components"].append({"id": "off", "type": "textBlock", "enabled": False,
                                          "props": {"content": "Hidden draft text that must not be indexed"}})
    sections = K.extract_sections(cat)
    texts = " ".join(s["text"] for s in sections)
    assert "founded in 2004" in texts and "Shantikunj" in texts
    assert "Enquire now" not in texts and "Hidden draft" not in texts
    assert sum("Shantikunj Haridwar, call" in s["text"] for s in sections) == 1      # footer once
    about = next(s for s in sections if s["page_route"] == "about")
    assert about["section_id"] == "ab" and about["page_title"] == "About us"


def test_chunks_are_bounded_and_prefixed():
    sections = [{"page_route": "p", "page_title": "Policies", "section_id": "s", "heading": "Refunds",
                 "text": ("Refunds are given within seven days. " * 80)}]
    chunks = K.chunk_sections(sections)
    assert len(chunks) > 2
    assert all(c["content"].startswith("Policies › Refunds\n") for c in chunks)
    assert all(len(c["content"]) <= K.CHUNK_CHARS + 200 for c in chunks)


def test_fingerprint_changes_with_pages_not_with_assistant_settings():
    a = K.fingerprint(CATALOGUE)
    cat = copy.deepcopy(CATALOGUE)
    cat["globalSettings"]["siteAssistant"]["greeting"] = "Hello!"
    assert K.fingerprint(cat) == a
    cat["pages"][1]["components"][0]["props"]["content"] += " New line."
    assert K.fingerprint(cat) != a


def test_footer_is_indexed_once_with_the_home_page():
    cat = copy.deepcopy(CATALOGUE)
    cat["globalSettings"]["layout"] = {"footer": {"id": "site-footer", "type": "footer", "props": {
        "leftSection": {"title": "BRAHM VARCHAS", "text": "Call +91 99999 00000<br>hello@example.org",
                        "socials": [{"platform": "YouTube", "url": "https://youtube.com/@x"}]},
        "rightSection1": {"title": "Explore", "links": [{"label": "Blog", "route": "blog"}]}}}}
    footer = [s for s in K.extract_sections(cat) if s["section_id"] == "site-footer"]
    assert len(footer) == 1 and footer[0]["page_route"] == ""
    home = next(p for p in cat["pages"] if p.get("route") in ("", "home")) if any(
        p.get("route") in ("", "home") for p in cat["pages"]) else cat["pages"][0]
    assert footer[0]["page_title"] == home["title"]                     # the site's own home title, no literal
    assert "+91 99999 00000" in footer[0]["text"] and "hello@example.org" in footer[0]["text"]
    assert "youtube.com" not in footer[0]["text"]
    a = K.fingerprint(cat)
    cat["globalSettings"]["layout"]["footer"]["props"]["leftSection"]["text"] = "Call +91 88888 00000"
    assert K.fingerprint(cat) != a                                   # a footer edit re-indexes
    cat["globalSettings"]["layout"]["footer"]["enabled"] = False
    assert not [s for s in K.extract_sections(cat) if s["section_id"] == "site-footer"]


def test_blog_route_is_the_page_with_a_blog_section():
    cat = copy.deepcopy(CATALOGUE)
    assert K.blog_route(cat) is None
    cat["pages"].append({"id": "news", "route": "news", "title": "News",
                         "components": [{"id": "b1", "type": "blog", "props": {}}]})
    assert K.blog_route(cat) == "news"
    cat["pages"].append({"id": "blog", "route": "/blog/", "title": "Blog",
                         "components": [{"id": "b2", "type": "blogList", "props": {}}]})
    assert K.blog_route(cat) == "blog"                                # the page named blog wins
    cat["pages"][-1]["hidden"] = True
    assert K.blog_route(cat) == "news"


def test_blog_posts_become_sections_at_their_own_address():
    posts = [
        {"slug": "ssc-cgl", "title": "SSC CGL 2026: Complete Guide", "category": "SSC",
         "excerpt": "Eligibility &amp; pattern", "content_html":
             "<style>.x{color:red}</style><h2>Eligibility</h2><p>Age 18&ndash;32 years.</p><svg><text>no</text></svg>"},
        {"slug": "", "title": "No slug", "content_html": "<p>Never indexed because it has no address.</p>"},
        {"slug": "empty", "title": "Empty", "content_html": "<p></p>"},
    ]
    sections = K.blog_sections(posts, "blog")
    assert [s["page_route"] for s in sections] == ["blog/ssc-cgl"]
    s = sections[0]
    assert s["page_title"] == "SSC CGL 2026: Complete Guide" and s["heading"] == "SSC"
    assert "Eligibility & pattern" in s["text"] and "Age 18–32 years." in s["text"]
    assert "color:red" not in s["text"] and "no" not in s["text"].split()
    chunks = K.chunk_sections(sections, max_chunks=K.MAX_BLOG_CHUNKS)
    assert chunks[0]["content"].startswith("SSC CGL 2026: Complete Guide › SSC\n")


def test_blog_posts_have_their_own_budget():
    big = [{"slug": f"p{i}", "title": f"Post {i}", "content_html": "<p>" + "Word " * 60_000 + "</p>"} for i in range(5)]
    sections = K.blog_sections(big, "blog")
    assert sum(len(s["text"]) for s in sections) <= K.MAX_BLOG_CHARS
    assert len(K.chunk_sections(sections, max_chunks=K.MAX_BLOG_CHUNKS)) <= K.MAX_BLOG_CHUNKS


def test_index_includes_blog_posts_when_the_site_has_a_blog(monkeypatch):
    f = install(monkeypatch)
    cat = copy.deepcopy(CATALOGUE)
    cat["pages"].append({"id": "blog", "route": "blog", "title": "Blog",
                         "components": [{"id": "b", "type": "blog", "props": {}}]})
    posts = [{"id": "p1", "slug": "ssc-cgl", "title": "SSC CGL guide", "category": "SSC", "excerpt": None,
              "content_html": "<p>SSC CGL eligibility: any graduate, age 18 to 32 years.</p>",
              "updated_at": "2026-10-01T00:00:00"}]
    monkeypatch.setattr(K.repo, "blog_posts", lambda db, iid, limit=200: posts)
    monkeypatch.setattr(K.repo, "blog_post_stamps", lambda db, iid, limit=200: [
        {"id": p["id"], "updated_at": p["updated_at"]} for p in posts])

    async def docs(texts, iid):
        return [[0.1] * 3 for _ in texts]
    monkeypatch.setattr(K.embedder, "documents", docs)
    res = asyncio.run(K.index_site(INST, TAG, cat))
    assert res["status"] == "READY"
    routes = {c["page_route"] for c in f.store.chunks[(INST, TAG)]}
    assert "blog/ssc-cgl" in routes
    fp = K.site_fingerprint(INST, cat)
    posts[0]["updated_at"] = "2026-10-02T00:00:00"
    assert K.site_fingerprint(INST, cat) != fp                        # an edited post re-indexes


def test_index_once_then_skip_until_pages_change(monkeypatch):
    f = install(monkeypatch)
    calls = []

    async def docs(texts, iid):
        calls.append(len(texts))
        return [[0.1] * 3 for _ in texts]
    monkeypatch.setattr(K.embedder, "documents", docs)
    res = asyncio.run(K.index_site(INST, TAG, CATALOGUE))
    assert res["status"] == "READY" and res["chunks"] == len(f.store.chunks[(INST, TAG)]) > 0
    state = f.store.index_state(None, INST, TAG)
    assert state["status"] == "READY" and state["fingerprint"] == K.fingerprint(CATALOGUE)
    assert not K.needs_index(INST, TAG, K.fingerprint(CATALOGUE))
    assert asyncio.run(K.index_site(INST, TAG, CATALOGUE)) == {"status": "skipped"}
    assert len(calls) == 1
    cat = copy.deepcopy(CATALOGUE)
    cat["pages"][2]["components"][0]["props"]["content"] = "We moved to Rishikesh."
    assert K.needs_index(INST, TAG, K.fingerprint(cat))
    assert asyncio.run(K.index_site(INST, TAG, cat))["status"] == "READY"
    assert len(calls) == 2


def test_lock_blocks_a_second_pod_while_indexing(monkeypatch):
    f = install(monkeypatch)
    fp = K.fingerprint(CATALOGUE)
    assert f.store.try_lock_index(None, INST, TAG, fp)          # pod 1 starts
    assert not f.store.try_lock_index(None, INST, TAG, fp)      # pod 2 is refused
    assert asyncio.run(K.index_site(INST, TAG, CATALOGUE)) == {"status": "skipped"}


def test_embedder_outage_stores_chunks_for_keyword_search_and_marks_failed(monkeypatch):
    f = install(monkeypatch)

    async def down(texts, iid):
        raise RuntimeError("402 Payment Required")
    monkeypatch.setattr(K.embedder, "documents", down)
    res = asyncio.run(K.index_site(INST, TAG, CATALOGUE))
    assert res["status"] == "FAILED" and res["chunks"] > 0
    assert all(c["embedding"] is None for c in f.store.chunks[(INST, TAG)])
    assert f.store.index_state(None, INST, TAG)["status"] == "FAILED"


def test_ensure_index_background_starts_a_task_only_when_needed(monkeypatch):
    install(monkeypatch)
    started = []

    async def fake_index(iid, tag, cat, force=False):
        started.append(tag)
        return {"status": "READY"}
    monkeypatch.setattr(K, "index_site", fake_index)

    async def go(needed):
        monkeypatch.setattr(K, "needs_index", lambda *a: needed)
        REAL_ENSURE(INST, TAG, CATALOGUE)
        await asyncio.sleep(0.01)
    asyncio.run(go(False))
    assert started == []
    asyncio.run(go(True))
    assert started == [TAG]


# ── tokens and settings ──────────────────────────────────────────────────

def test_token_round_trip_and_expiry():
    minted = T.mint(sid="s1", iid=INST, tag=TAG, vid="v_abcdefgh", ch="EMBED")
    claims = T.verify(minted["token"])
    assert (claims.sid, claims.iid, claims.tag, claims.vid, claims.ch) == ("s1", INST, TAG, "v_abcdefgh", "EMBED")
    assert 11 * 3600 < minted["exp"] - time.time() <= 12 * 3600
    old = T.mint(sid="s1", iid=INST, tag=TAG, vid="v_abcdefgh", ch="EMBED", now=int(time.time()) - 13 * 3600)
    assert T.verify(old["token"]) is None
    assert T.verify(minted["token"][:-2] + "xx") is None
    assert T.verify(None) is None


def test_visitor_ids_and_hash_keys():
    assert T.visitor_id("v_abcdefgh") == "v_abcdefgh"
    assert T.visitor_id("bad id!") != "bad id!" and T.visitor_id(None).startswith("v_")
    k = T.hash_key("v", "x")
    assert k.startswith("v:") and len(k) <= 64
    assert T.hash_key("ip", "1.2.3.4").startswith("ip:") and len(T.hash_key("ip", "1.2.3.4")) <= 64


def test_settings_defaults_and_sanitising():
    s = S.normalize(None)
    assert s["enabled"] is False and s["limits"]["dailyAnswers"] == 300 and s["embed"]["enabled"] is False
    s = S.normalize({"enabled": True, "persona": "rude", "accentColor": "red;", "avatarUrl": "http://x/y.png",
                     "support": {"loginUrl": "javascript:alert(1)"}, "limits": {"dailyAnswers": "50"},
                     "knowledge": {"courses": False}})
    assert s["persona"] == "warm" and s["accentColor"] is None and s["avatarUrl"] is None
    assert s["support"]["loginUrl"] is None and s["limits"]["dailyAnswers"] == 50
    assert s["knowledge"]["courses"] is False and s["knowledge"]["pages"] is True
