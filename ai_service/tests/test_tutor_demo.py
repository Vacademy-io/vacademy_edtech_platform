"""Public demo lesson: guest token, name hygiene, abuse controls."""
from app.services.tutor import demo
from app.core.security import decode_access_token


def test_guest_token_verifies_with_the_platform_secret():
    tok = demo.mint_guest_token(user_id="demo-abc", tutor_session_id="s1", institute_id="i1")
    claims = decode_access_token(tok)
    assert claims and claims["user"] == "demo-abc" and claims["demo"] == "s1"


def test_sanitize_name_keeps_first_word_only():
    assert demo.sanitize_name("priya sharma") == "Priya"
    assert "<" not in demo.sanitize_name("  <script>alert(1)</script> ")
    assert demo.sanitize_name("") == "Friend"
    assert demo.sanitize_name("राहुल") in ("राहुल", "Friend")


class _DB:
    def __init__(self, counts):
        self.counts = list(counts)
        self.sql = []
    def execute(self, stmt, params=None):
        self.sql.append(str(stmt)); n = self.counts.pop(0)
        class R:
            def scalar(_): return n
        return R()
    def commit(self): pass


def test_grant_limits():
    assert demo.grant_allowed(_DB([0, 0]), iph="h", per_ip_per_day=1, daily_cap=200) is None
    assert "today" in (demo.grant_allowed(_DB([200]), iph="h", per_ip_per_day=1, daily_cap=200) or "")
    assert "already" in (demo.grant_allowed(_DB([5, 1]), iph="h", per_ip_per_day=1, daily_cap=200) or "")
    assert demo.grant_allowed(_DB([]), iph="h", per_ip_per_day=0, daily_cap=0) is None


def test_ip_bucketing():
    class Req:
        headers = {"x-forwarded-for": "2001:db8:1234:5678:abcd::1, 10.0.0.1"}
        client = None
    assert demo.client_ip(Req()) == "2001:db8:1234:5678::"
    Req.headers = {}
    class C: host = "1.2.3.4"
    Req.client = C()
    assert demo.client_ip(Req()) == "1.2.3.4"
    assert demo.ip_hash("1.2.3.4") != demo.ip_hash("1.2.3.5")


def test_client_ip_prefers_cloudflare_connecting_ip():
    class Req:
        # Behind Cloudflare the first X-Forwarded-For hop may be the edge, not the visitor.
        headers = {"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "172.70.1.1, 10.0.0.1"}
        class client:
            host = "10.42.0.9"
    assert demo.client_ip(Req()) == "203.0.113.7"
    Req.headers = {"cf-connecting-ip": "not-an-ip", "x-forwarded-for": "198.51.100.4, 172.70.1.1"}
    assert demo.client_ip(Req()) == "198.51.100.4"
    Req.headers = {"cf-connecting-ip": "2001:db8:aa:bb:1::2"}
    assert demo.client_ip(Req()) == "2001:db8:aa:bb::"
    Req.headers = {"x-forwarded-for": "garbage"}
    assert demo.client_ip(Req()) == "10.42.0.9"


def test_public_topics_requires_everything(monkeypatch):
    base = {"enabled": True, "package_session_id": "", "topics": [], "minutes": 3, "per_ip_per_day": 1, "daily_cap": 200, "teacher_name": ""}
    monkeypatch.setattr(demo, "list_topics", lambda db, **k: [{"key": "k", "title": "T", "emoji": "", "language": "en", "ready": True},
                                                              {"key": "raw", "title": "R", "ready": False}])
    monkeypatch.setattr(demo, "config", lambda db=None: {**base, "institute_id": ""})
    assert demo.public_topics(object())["enabled"] is False
    monkeypatch.setattr(demo, "config", lambda db=None: {**base, "institute_id": "i"})
    out = demo.public_topics(object())
    assert out["enabled"] and [t["key"] for t in out["topics"]] == ["k"] and out["minutes"] == 3
    assert demo.slide_id_for("k") == "demo:k" and demo.is_demo_slide("demo:k") and not demo.is_demo_slide("abc")


def test_unlisted_topics_start_by_link_but_stay_out_of_the_picker(monkeypatch):
    from app.services.tutor import demo
    monkeypatch.setattr(demo, "config", lambda db=None: {"enabled": True, "institute_id": "i", "minutes": 3})
    monkeypatch.setattr(demo, "list_topics", lambda db, active_only=False, with_source=False: [
        {"key": "pub", "title": "Public", "ready": True, "sort_order": 10},
        {"key": "prospect", "title": "A prospect's chapter", "ready": True, "sort_order": demo.UNLISTED_SORT_ORDER},
        {"key": "draft", "title": "Not compiled", "ready": False, "sort_order": 10},
    ])
    listed = [t["key"] for t in demo.public_topics(object())["topics"]]
    startable = [t["key"] for t in demo.startable_topics(object())]
    assert listed == ["pub"], "the picker must not show a prospect's material"
    assert startable == ["pub", "prospect"], "but a direct link to it must still work"
    assert demo.topic_by_key(demo.startable_topics(object()), "prospect")["unlisted"] is True


def test_demo_source_and_topic_listing_imports_resolve(monkeypatch):
    """The compiler and the topics list import sibling modules lazily; a wrong
    relative import only fails at runtime, so exercise both paths here."""
    class _DB:
        def execute(self, stmt, params=None):
            class R:
                def first(_): return ("Photosynthesis", "Plants make sugar from light.", "en", "lesson")
                def fetchall(_): return []
            return R()
    src = demo.load_demo_source(_DB(), "demo:photosynthesis")
    assert src is not None and src.kind == "document" and src.slide_id == "demo:photosynthesis" and src.text and src.style == "lesson"
    assert demo.list_topics(_DB()) == []


def test_session_style_shapes_persona_and_greeting():
    from app.services.tutor.runtime import prompts as rp
    from app.services.tutor import compile_prompts as cp
    assert rp.greet_key("interview") == "greet_interview" and rp.greet_key("lesson") == "greet" and rp.greet_key("x") == "greet"
    g = rp.tpl("greet_interview", "en", name="Shreyash", teacher="Riya", slide="a mini aptitude interview")
    assert "interviewer" in g and "teaching" not in g
    assert "INTERVIEWER" in cp.system_prompt("Riya", "en", style="interview") and "interview" in rp.system_prompt("Riya", "en", "normal", "interview")
    assert "one-to-one teacher" in cp.system_prompt("Riya", "en")
    assert "ONE QUESTION, ASKED ONCE" in cp.rules_text()


def test_narration_must_not_ask_when_a_check_follows():
    from app.services.tutor.plan_validator import narration_asks
    from app.services.tutor.runtime.prompts import narration_asks as live_asks
    assert narration_asks("Try it before I reveal: what is the train's speed?")
    assert narration_asks("Here is question one. Try it before I reveal.")
    assert not narration_asks("Speed is distance over time. The train covers its own length.")
    assert live_asks("So what happens to acceleration?") and not live_asks("Acceleration halves.")
