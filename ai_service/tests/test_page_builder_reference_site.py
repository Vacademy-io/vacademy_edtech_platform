"""'Make my site look like THAT website, but in my colours and with my logo.'

The wizard could only take uploaded screenshots, and with a pinned theme the
reference palette still leaked in through four paths (prompt colour lines,
the two post-sanitize backstops, and the fidelity audit driving the repair
pass). These guard the URL capture plumbing and the theme-locked mode.
"""
import asyncio
import os
import sys
from io import BytesIO

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

pb = pytest.importorskip("app.routers.page_builder")
audit = pytest.importorskip("app.services.page_audit")


def _png(width: int, height: int) -> bytes:
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (width, height), (10, 31, 58)).save(buf, format="PNG")
    return buf.getvalue()


def _tile_heights(tiles):
    from PIL import Image
    return [Image.open(BytesIO(t)).size[1] for t in tiles]


# ── capture plumbing ──────────────────────────────────────────────────────────

def test_full_page_screenshot_is_sliced_into_readable_tiles():
    assert _tile_heights(pb._slice_screenshot(_png(1440, 4000))) == [1600, 1600, 800]
    assert _tile_heights(pb._slice_screenshot(_png(1440, 500))) == [500]
    # a footer sliver under 15% of a tile is not worth an image slot
    assert _tile_heights(pb._slice_screenshot(_png(1440, 1650))) == [1600]
    # very long pages are truncated at the vision budget
    assert len(pb._slice_screenshot(_png(1440, 40000))) == pb._MAX_INSPIRATION_IMAGES


def test_reference_capture_refuses_private_hosts_and_says_so():
    warnings: list = []
    out = asyncio.run(pb._capture_reference_screenshots("http://127.0.0.1:8080/admin", warnings))
    assert out == []
    assert any("not a public" in w for w in warnings)


def test_reference_tiles_fill_the_budget_after_the_admins_own_screenshots(monkeypatch):
    async def fake_capture(url, warnings):
        warnings.append("captured")
        return [f"data:image/png;base64,{i}" for i in range(4)]
    monkeypatch.setattr(pb, "_capture_reference_screenshots", fake_capture)

    class Body:
        inspiration_image_urls = ["https://cdn.example.com/a.png"] * 4
        reference_url = "https://example.edu"
    warnings: list = []
    urls = asyncio.run(pb._resolve_inspiration_sources(Body(), warnings))
    assert len(urls) == pb._MAX_INSPIRATION_IMAGES
    assert urls[:4] == Body.inspiration_image_urls and urls[4].startswith("data:image/")

    class Full:
        inspiration_image_urls = ["https://cdn.example.com/a.png"] * pb._MAX_INSPIRATION_IMAGES
        reference_url = "https://example.edu"
    warnings = []
    urls = asyncio.run(pb._resolve_inspiration_sources(Full(), warnings))
    assert len(urls) == pb._MAX_INSPIRATION_IMAGES and any("budget" in w for w in warnings)


def test_site_request_accepts_reference_url_and_pinned_theme():
    req = pb.GenerateSiteRequest(brief="x", reference_url="https://example.edu", global_settings={"theme": {"preset": "ocean"}})
    assert req.reference_url and req.global_settings["theme"]["preset"] == "ocean"
    assert pb.GeneratePageRequest(brief="x", reference_url="https://example.edu").reference_url


# ── theme-locked mode ────────────────────────────────────────────────────────

_SPEC = {
    "palette": {"primary": "#2563EB", "surface": "#0B1F3A", "background": "#F8FAFC", "ink": "#1E293B", "accent": "#06B6D4"},
    "typography": {"heading": "sans", "scale": "large"},
    "sections": [{"role": "hero", "layout": "split"}, {"role": "features"}, {"role": "cta"}],
    "signatureMoves": ["pill eyebrow above the headline"],
}


def test_dark_surface_is_derived_from_the_sites_own_brand():
    navy = pb._derive_dark_surface({"primaryColor": "#2563EB"})
    assert pb.is_hex_dark(navy)
    r, g, b = (int(navy[i:i + 2], 16) for i in (1, 3, 5))
    assert b > r, "a blue brand must give a blue-leaning band, not the reference's"
    green = pb._derive_dark_surface({"preset": "forest"})
    gr, gg, gb = (int(green[i:i + 2], 16) for i in (1, 3, 5))
    assert pb.is_hex_dark(green) and gg > gr and gg > gb
    assert pb._derive_dark_surface({}) == "#111827"


def test_locked_block_carries_no_reference_hex_and_keeps_the_structure():
    text = pb._inspiration_block(_SPEC, theme_locked=True, locked_surface="#0A1A3F")
    for hexv in _SPEC["palette"].values():
        assert hexv.lower() not in text.lower(), f"reference colour {hexv} leaked into the locked prompt"
    assert "REFERENCE LAYOUT" in text and "#0A1A3F" in text
    assert "BRAND COLOUR:" not in text and "CANVAS:" not in text and "fonts.headingFamily" not in text
    assert "STRUCTURE:" in text and "SIGNATURE DETAILS" in text
    assert '"sections"' in text

    free = pb._inspiration_block(_SPEC)
    assert "BRAND COLOUR:" in free and "#2563EB" in free


def test_build_prompt_locks_the_reference_when_a_theme_is_pinned():
    req = pb.GeneratePageRequest(brief="A school site", institute_name="X")
    catalog = pb._load_catalog()
    pinned = {"theme": {"preset": "ocean", "primaryColor": "#2563EB"}}
    locked = pb._build_prompt(req, catalog, inspiration=_SPEC, fixed_global=pinned)
    assert "REFERENCE LAYOUT" in locked and "FIXED SITE THEME" in locked
    assert "#0B1F3A" not in locked
    free = pb._build_prompt(req, catalog, inspiration=_SPEC)
    assert "REFERENCE DESIGN — MATCH THIS" in free and "#0B1F3A" in free


def test_recolour_scrubs_reference_colours_the_composer_still_painted():
    page = {"components": [
        {"id": "hero", "type": "heroSection", "props": {"backgroundColor": "#0B1F3A", "textColor": "#FFFFFF", "left": {"title": "t"}},
         "style": {"backgroundColor": "#0b1f3b", "customClass": "dark"}},
        {"id": "h", "type": "sectionHeading", "props": {"title": "x", "textColor": "#2563EB", "backgroundColor": "#F8FAFC"}},
        {"id": "own", "type": "ctaBanner", "props": {"backgroundColor": "#14532D"}},
        {"id": "chips", "type": "featureGrid", "props": {"features": [{"title": "a", "iconColor": "#06B6D4"}]}},
    ]}
    n = pb._recolour_reference_palette(page, _SPEC["palette"], "#0A1A3F")
    hero = page["components"][0]
    assert hero["props"]["backgroundColor"] == "#0A1A3F" and hero["style"]["backgroundColor"] == "#0A1A3F"
    assert hero["props"]["textColor"] == "#FFFFFF", "near-white is the canvas, not a brand cue"
    assert "textColor" not in page["components"][1]["props"], "reference brand colour dropped → theme tokens"
    assert "backgroundColor" not in page["components"][1]["props"] or page["components"][1]["props"]["backgroundColor"] == "#F8FAFC"
    assert page["components"][2]["props"]["backgroundColor"] == "#14532D", "colours unrelated to the reference are untouched"
    assert "iconColor" not in page["components"][3]["props"]["features"][0]
    assert n == 4


def test_locked_audit_does_not_demand_the_reference_colour_or_canvas():
    page = {"components": [{"type": "heroSection"}, {"type": "featureGrid"}, {"type": "ctaBanner"}]}
    gs = {"theme": {"primaryColor": "#FF6600"}}
    free = audit.audit_reference_fidelity(page, gs, _SPEC)
    assert {i["code"] for i in free} >= {"reference-colour-ignored", "reference-canvas-ignored"}
    locked = audit.audit_reference_fidelity(page, gs, _SPEC, theme_locked=True)
    assert not {i["code"] for i in locked} & {"reference-colour-ignored", "reference-canvas-ignored"}
    # section coverage still audited under a lock
    sparse = audit.audit_reference_fidelity({"components": [{"type": "heroSection"}]}, gs, _SPEC, theme_locked=True)
    assert any(i["code"] == "reference-section-missing" for i in sparse)


# ── fabricated people ─────────────────────────────────────────────────────────

def _people_page():
    return {"components": [
        {"id": "hero", "type": "heroSection", "props": {"left": {"title": "x"}}},
        {"id": "quotes", "type": "testimonialSection", "props": {"testimonials": [
            {"name": "Aditi R.", "quote": "invented"},
            {"name": "Priya Sharma", "quote": "real — she is in the brief"},
        ]}},
        {"id": "team", "type": "teamSection", "props": {"members": [{"name": "Founder", "role": "Founder"}]}},
        {"id": "cta", "type": "ctaBanner", "props": {"button": {"text": "Go"}}},
    ]}


def test_invented_testimonials_and_team_are_dropped_but_named_ones_survive():
    page = _people_page()
    warnings: list = []
    n = pb.strip_fabricated_people(page, "Smart AI Academy. Testimonial from Priya Sharma: loved it.", warnings)
    types = [c["type"] for c in page["components"]]
    assert n == 2
    assert types == ["heroSection", "testimonialSection", "ctaBanner"], "empty team section removed, others kept in order"
    assert [t["name"] for t in page["components"][1]["props"]["testimonials"]] == ["Priya Sharma"]
    assert any("teamSection" in w for w in warnings)


def test_people_named_in_the_evidence_are_all_kept():
    page = _people_page()
    n = pb.strip_fabricated_people(page, "Quotes from Aditi and Priya. Our founder Rahul.", [])
    assert n == 1, "'Founder' is a role word, not a name — it goes even though 'founder' is in the brief"
    assert len(page["components"]) == 3 and page["components"][1]["type"] == "testimonialSection"


def test_people_backstop_ignores_pages_without_people_sections():
    page = {"components": [{"id": "h", "type": "heroSection", "props": {}}]}
    assert pb.strip_fabricated_people(page, "", []) == 0 and len(page["components"]) == 1


def test_capture_session_routes_every_request_through_the_ssrf_guard(monkeypatch):
    # The browser runs inside the cluster: sub-requests (redirects, <img>, XHR)
    # must be gated like the first URL, or an internal response ends up painted
    # into a screenshot the admin can see.
    seen = []

    class Route:
        def __init__(self, url): self.request = type("R", (), {"url": url})(); self.action = None
        async def continue_(self): self.action = "continue"
        async def abort(self, reason=""): self.action = "abort"

    class Page:
        async def goto(self, *a, **k): pass
        async def wait_for_load_state(self, *a, **k): pass
        async def evaluate(self, *a, **k): return [1000, 500]
        async def wait_for_timeout(self, *a, **k): pass
        async def screenshot(self, **k): return b"png"

    class Context:
        handler = None
        async def add_init_script(self, *a): pass
        async def route(self, pattern, handler): Context.handler = handler
        async def new_page(self): return Page()

    class Browser:
        async def new_context(self, **k): return Context()
        async def close(self): pass

    class Chromium:
        async def launch(self, **k): return Browser()

    class PW:
        chromium = Chromium()
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass

    monkeypatch.setattr(pb, "_is_public_http_host", lambda u: (seen.append(u), not u.startswith("http://internal"))[1])
    png = asyncio.run(pb._capture_reference_png("https://public.example/", PW))
    assert png == b"png" and Context.handler is not None, "guard must be installed on the context"
    ok = Route("https://cdn.example/a.png"); bad = Route("http://internal.svc:8080/actuator")
    asyncio.run(Context.handler(ok, ok.request)); asyncio.run(Context.handler(bad, bad.request))
    assert ok.action == "continue" and bad.action == "abort"
    assert "http://internal.svc:8080/actuator" in seen


def test_short_names_given_in_the_brief_survive():
    page = {"components": [{"id": "q", "type": "testimonialSection", "props": {"testimonials": [
        {"name": "Li Na", "quote": "in the brief"}, {"name": "Yu Bo", "quote": "not in the brief"}]}}]}
    n = pb.strip_fabricated_people(page, "Feedback from Li Na, our first learner.", [])
    assert n == 1 and [t["name"] for t in page["components"][0]["props"]["testimonials"]] == ["Li Na"]
