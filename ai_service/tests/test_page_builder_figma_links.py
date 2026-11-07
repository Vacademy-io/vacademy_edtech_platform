"""A figma.com link given to the in-product AI page wizard.

Product decision 1 (2026-10-10): no server-side Figma. A Figma file opened
without the owner's session is Figma's sign-in page, and the wizard used to
screenshot it as the "reference site" and design from a login form. Every
surface that takes a link now refuses a Figma one before any browser, DNS or
fetch work, and tells the admin what works instead — the same sentence the
admin UI shows, design_import(source='figma_url') returns and the playbook carries.
"""
import asyncio
import os
import socket
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from app.services import figma_links  # noqa: E402
from app.services.figma_links import FIGMA_LINK_GUIDANCE, find_figma_url, is_figma_url  # noqa: E402

pb = pytest.importorskip("app.routers.page_builder")

FIGMA = "https://www.figma.com/design/c3DrF8i0qcRGQNayy/BV?node-id=1-36"


# ── detection ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    FIGMA,
    "figma.com/file/AbC/x",
    "www.figma.com/proto/AbC/x",
    "HTTPS://WWW.FIGMA.COM/design/AbC",
    "https://embed.figma.com/design/AbC",
    "  https://figma.com/board/AbC  ",
])
def test_figma_links_are_recognised(url):
    assert is_figma_url(url)


@pytest.mark.parametrize("url", [
    "https://figma.com.evil.io/design/AbC",
    "https://notfigma.com/design/AbC",
    "https://brahm-varchas.figma.site/",  # a published Figma Sites page is a normal website
    "https://example.edu/figma.com",
    "",
    None,
    42,
])
def test_lookalikes_and_published_sites_are_not_figma_links(url):
    assert not is_figma_url(url)


def test_a_figma_link_is_found_in_chat_text():
    assert find_figma_url(f"Here is our design: {FIGMA} — please follow it") == FIGMA
    assert find_figma_url("design at www.figma.com/file/AbC/x.") == "www.figma.com/file/AbC/x."
    assert find_figma_url("Mail design@figma.com or see https://example.edu/figma.com") is None
    assert find_figma_url("We like figma.com.evil.io") is None
    assert find_figma_url("no links here") is None


@pytest.mark.parametrize("text", [
    "our designer uses figma.com for everything",  # a bare mention, no scheme and no file path
    "we tried Figma.com once",
    "https://example.com/?u=figma.com",  # inside another URL's query string
    "https://example.com/?next=https://www.figma.com/design/AbC/x",
    "https://example.com/r#figma.com/design/AbC",
])
def test_prose_mentions_and_embedded_links_are_not_shared_designs(text):
    assert find_figma_url(text) is None


def test_a_scheme_or_a_file_path_makes_it_a_shared_design():
    assert find_figma_url("see https://figma.com") == "https://figma.com"
    assert find_figma_url("see figma.com/design/AbC/x") == "figma.com/design/AbC/x"
    assert find_figma_url("see figma.com/proto/AbC") == "figma.com/proto/AbC"


def test_guidance_names_both_routes_that_work():
    assert FIGMA_LINK_GUIDANCE.startswith("Figma links can't be opened here.")
    assert "upload screenshots of your frames" in FIGMA_LINK_GUIDANCE
    assert "Claude with the Figma connector and the Vacademy MCP" in FIGMA_LINK_GUIDANCE


def test_the_ai_facing_guidance_is_white_label_and_says_mcp_is_opt_in():
    # An MCP client relays this to the admin; the institute may be white-label.
    text = figma_links.FIGMA_LINK_GUIDANCE_FOR_AI
    assert text.startswith("Figma links can't be opened here.") and "upload screenshots of your frames" in text
    assert "Vacademy" not in text and "this institute's MCP connection" in text
    assert "Settings → MCP Server" in text


# ── reference_url: never screenshotted ───────────────────────────────────────

def _no_browser(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a Figma link must not reach DNS or the browser")
    monkeypatch.setattr(pb, "_is_public_http_host", boom)
    monkeypatch.setattr(pb, "_capture_reference_png", boom)


def test_reference_capture_refuses_a_figma_link_before_any_browser_work(monkeypatch):
    _no_browser(monkeypatch)
    warnings: list = []
    assert asyncio.run(pb._capture_reference_screenshots(FIGMA, warnings)) == []
    assert warnings == [FIGMA_LINK_GUIDANCE]


def test_resolve_keeps_the_screenshots_and_explains_the_figma_link_even_when_the_budget_is_full(monkeypatch):
    async def capture(*a, **k):
        raise AssertionError("must not capture a Figma link")
    monkeypatch.setattr(pb, "_capture_reference_screenshots", capture)
    shots = ["https://cdn.example.com/frame.png"] * pb._MAX_INSPIRATION_IMAGES
    warnings: list = []
    body = SimpleNamespace(inspiration_image_urls=shots, reference_url="figma.com/design/AbC/x")
    assert asyncio.run(pb._resolve_inspiration_sources(body, warnings)) == shots
    assert warnings == [FIGMA_LINK_GUIDANCE], "the admin must learn why, not 'budget full'"


def test_a_real_reference_site_is_still_captured(monkeypatch):
    async def capture(url, warnings):
        return [f"data:image/png;base64,{url}"]
    monkeypatch.setattr(pb, "_capture_reference_screenshots", capture)
    body = SimpleNamespace(inspiration_image_urls=[], reference_url="https://brahm-varchas.figma.site/")
    warnings: list = []
    assert asyncio.run(pb._resolve_inspiration_sources(body, warnings)) == ["data:image/png;base64,https://brahm-varchas.figma.site/"]
    assert warnings == []


def test_site_import_never_fetches_a_figma_link(monkeypatch):
    def no_dns(*a, **k):
        raise AssertionError("no DNS for a Figma link")
    monkeypatch.setattr(socket, "getaddrinfo", no_dns)
    assert asyncio.run(pb._import_site(FIGMA)) == ""


class _Stop(Exception):
    pass


def test_compose_skips_figma_source_and_reference_and_warns_once(monkeypatch):
    calls = {"import": 0, "capture": 0, "vision": 0}
    held: list = []

    async def import_site(url):
        calls["import"] += 1
        return "copy"

    async def capture(url, warnings):
        calls["capture"] += 1
        return []

    async def vision(*a, **k):
        calls["vision"] += 1
        return {}

    async def gen(prompt, models, label=""):
        return "{}", "m", {}

    def build_prompt(body, catalog, inspiration, site_corpus, fixed_global):
        assert site_corpus == "" and not inspiration
        return "prompt"

    def stop(*a, **k):
        raise _Stop()

    monkeypatch.setattr(pb, "_import_site", import_site)
    monkeypatch.setattr(pb, "_capture_reference_screenshots", capture)
    monkeypatch.setattr(pb, "_analyze_inspiration", vision)
    monkeypatch.setattr(pb, "_build_prompt", build_prompt)
    monkeypatch.setattr(pb, "resolve_models", lambda *a, **k: ("m", []))
    monkeypatch.setattr(pb, "generate_json", gen)
    monkeypatch.setattr(pb, "_sanitize_page", lambda *a, **k: ({"components": []}, None, held))
    monkeypatch.setattr(pb, "strip_fabricated_people", stop)

    body = pb.GeneratePageRequest(brief="A school site", source_url=FIGMA, reference_url=FIGMA, auto_images=False)
    with pytest.raises(_Stop):
        asyncio.run(pb._compose_one_page(body, {}, None, "inst-1", "user-1"))
    assert calls == {"import": 0, "capture": 0, "vision": 0}
    assert held.count(FIGMA_LINK_GUIDANCE) == 1


def test_whole_site_build_explains_a_figma_link_once(monkeypatch):
    """The shared reference AND the homepage's source_url are both Figma: the
    admin sees the guidance once, and no page imports or captures anything."""
    calls = {"import": 0, "capture": 0, "compose": []}

    async def capture(url, warnings):
        calls["capture"] += 1
        return []

    async def compose(sub, catalog, db, institute_id, actor_user_id, fixed_global=None, inspiration=None):
        calls["compose"].append(sub.source_url)
        w = ["Image search skipped"]
        if sub.source_url and pb.is_figma_url(sub.source_url):  # what _compose_one_page does
            w.append(FIGMA_LINK_GUIDANCE)
        return {"route": "home", "components": []}, {"theme": {}}, w, "m", None

    monkeypatch.setattr(pb, "preflight_tool_credits", lambda *a, **k: {"estimated_credits": 1, "current_balance": 99})
    monkeypatch.setattr(pb, "_load_catalog", lambda: {})
    monkeypatch.setattr(pb, "_capture_reference_screenshots", capture)
    monkeypatch.setattr(pb, "_compose_one_page", compose)

    body = pb.GenerateSiteRequest(brief="A school site", source_url=FIGMA, reference_url="figma.com/design/AbC/x")
    user = SimpleNamespace(institute_id="inst-1", user_id="user-1")
    out = asyncio.run(pb.generate_site(body, db=None, current_user=user))
    assert out.warnings.count(FIGMA_LINK_GUIDANCE) == 1
    assert calls["capture"] == 0
    assert calls["compose"] == [FIGMA, None, None], "only the homepage gets source_url"
    assert len(out.pages) == 3


# ── intake chat ──────────────────────────────────────────────────────────────

def _turns(*pairs):
    return [pb.IntakeTurn(role=r, content=c) for r, c in pairs]


def test_intake_prompt_carries_the_figma_rule():
    prompt = pb._build_intake_prompt(pb.IntakeRequest(history=[]))
    assert "FIGMA LINKS" in prompt and FIGMA_LINK_GUIDANCE in prompt


def test_only_the_latest_admin_message_counts():
    assert pb._latest_user_figma_link(_turns(("assistant", "hi"), ("user", f"see {FIGMA}"))) == FIGMA
    assert pb._latest_user_figma_link(_turns(("user", f"see {FIGMA}"), ("assistant", "ok"), ("user", "a school"))) is None
    assert pb._latest_user_figma_link([]) is None


def test_guard_prepends_the_guidance_once_and_opens_the_screenshot_uploader():
    reply, upload = pb._apply_figma_link_guard("Lovely! What is the site for?", None)
    assert reply == f"{FIGMA_LINK_GUIDANCE}\n\nLovely! What is the site for?" and upload == "inspiration"
    reply, upload = pb._apply_figma_link_guard(f"{FIGMA_LINK_GUIDANCE} Can you share screenshots?", "logo")
    assert reply == f"{FIGMA_LINK_GUIDANCE}\n\nCan you share screenshots?" and upload == "logo"
    assert reply.count(FIGMA_LINK_GUIDANCE) == 1


def test_guard_drops_a_model_claim_to_have_seen_the_figma_design():
    reply, _ = pb._apply_figma_link_guard(
        "I've looked at your Figma design. The hero is lovely! Who is the site for?", None
    )
    assert reply == f"{FIGMA_LINK_GUIDANCE}\n\nThe hero is lovely! Who is the site for?"
    # Nothing left once the Figma talk is gone → ask for the screenshots.
    reply, _ = pb._apply_figma_link_guard("I reviewed the figma file.", None)
    assert reply == f"{FIGMA_LINK_GUIDANCE}\n\n{pb._FIGMA_SCREENSHOT_ASK}"


def test_figma_sentences_are_dropped_and_line_breaks_kept():
    brief = "Sanskrit school in Varanasi. Match the Figma file exactly.\nTone: warm. Use the Figma palette."
    assert pb._drop_figma_sentences(brief) == "Sanskrit school in Varanasi.\nTone: warm."
    assert pb._drop_figma_sentences("") == ""


def _fake_llm(monkeypatch, reply_json: str, seen: list):
    import app.services.api_key_resolver as akr
    import app.services.chat_llm_client as clc

    class Client:
        def __init__(self, resolver):
            pass

        async def chat_completion(self, msgs, **kw):
            seen.append(msgs)
            return {"content": reply_json, "model": "m", "usage": {}}

    monkeypatch.setattr(clc, "ChatLLMClient", Client)
    monkeypatch.setattr(akr, "ApiKeyResolver", lambda db: None)
    monkeypatch.setattr(pb, "preflight_tool_credits", lambda *a, **k: {"sufficient": True})
    monkeypatch.setattr(pb, "resolve_models", lambda *a, **k: ("m", []))
    monkeypatch.setattr(pb, "record_tool_billing", lambda *a, **k: None)


def test_intake_turn_with_a_figma_link_always_answers_with_the_guidance(monkeypatch):
    seen: list = []
    # A model that pretends it looked at the design.
    _fake_llm(monkeypatch, '{"reply": "Great design! Who is it for?", "chips": [], "request_upload": null}', seen)
    user = SimpleNamespace(institute_id="inst-1", user_id="user-1")
    body = pb.IntakeRequest(history=_turns(("assistant", "What is the site for?"), ("user", f"Build this {FIGMA}")))
    out = asyncio.run(pb.intake_turn(body, db=None, current_user=user))
    assert out.reply.startswith(FIGMA_LINK_GUIDANCE)
    assert out.request_upload == "inspiration"
    assert "Figma file. It cannot be opened here" in seen[0][-1]["content"]


def test_intake_turn_with_a_figma_link_is_never_ready_and_keeps_figma_out_of_the_brief(monkeypatch):
    seen: list = []
    _fake_llm(
        monkeypatch,
        '{"reply": "I have reviewed your Figma design. Ready to build!", "ready": true, '
        '"brief": "A Sanskrit school site. Match the Figma file frame by frame. Warm saffron tone.", '
        '"chips": [], "request_upload": null}',
        seen,
    )
    user = SimpleNamespace(institute_id="inst-1", user_id="user-1")
    body = pb.IntakeRequest(history=_turns(("user", f"Build exactly this: {FIGMA}")))
    out = asyncio.run(pb.intake_turn(body, db=None, current_user=user))
    assert out.ready is False
    assert out.brief == "A Sanskrit school site. Warm saffron tone."
    assert out.reply == f"{FIGMA_LINK_GUIDANCE}\n\nReady to build!"
    assert "reviewed" not in out.reply


def test_intake_turn_with_a_figma_link_and_screenshots_attached_does_not_ask_again(monkeypatch):
    """F5: screenshots on the same message: no second upload ask, ready is kept, the brief keeps what they show."""
    seen: list = []
    _fake_llm(
        monkeypatch,
        '{"reply": "Thanks — the Figma frames you attached use saffron and cream. Ready to build!", "ready": true, '
        '"brief": "A Sanskrit school site. Colours from the Figma frames: saffron #E07A1F and cream.", '
        '"chips": [], "request_upload": null}',
        seen,
    )
    user = SimpleNamespace(institute_id="inst-1", user_id="user-1")
    turn = pb.IntakeTurn(role="user", content=f"Here is our design {FIGMA} — screenshots attached",
                         image_urls=["https://cdn.example.net/a.png"])

    async def _inline(url):
        return "data:image/png;base64,AAAA", None
    monkeypatch.setattr(pb, "_inline_image_data_url", _inline)
    body = pb.IntakeRequest(history=[turn])
    out = asyncio.run(pb.intake_turn(body, db=None, current_user=user))
    assert out.ready is True and out.request_upload is None
    assert out.reply.startswith(FIGMA_LINK_GUIDANCE) and "saffron and cream" in out.reply
    assert out.brief == "A Sanskrit school site. Colours from the Figma frames: saffron #E07A1F and cream."
    assert "attached screenshots" in seen[0][-1]["content"]


def test_intake_turn_without_a_figma_link_is_unchanged(monkeypatch):
    seen: list = []
    _fake_llm(monkeypatch, '{"reply": "Who is it for?", "chips": ["Parents"], "request_upload": null}', seen)
    user = SimpleNamespace(institute_id="inst-1", user_id="user-1")
    body = pb.IntakeRequest(history=_turns(("user", "A coaching institute in Jaipur, see https://example.edu")))
    out = asyncio.run(pb.intake_turn(body, db=None, current_user=user))
    assert out.reply == "Who is it for?" and out.request_upload is None
    assert "Figma" not in seen[0][-1]["content"]


def test_module_exports_are_stable():
    assert set(figma_links.__all__) == {
        "FIGMA_LINK_GUIDANCE", "FIGMA_LINK_GUIDANCE_FOR_AI", "find_figma_url", "is_figma_url",
    }
