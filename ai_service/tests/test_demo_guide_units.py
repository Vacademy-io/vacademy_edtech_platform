"""Demo guide building blocks: tokens, origins, products, sentence splitting,
the prompt, the catalogue view and the facts search. No network, no DB."""
import asyncio
import json
import time

import pytest

from demo_guide_fakes import CATALOG, CATALOG_URL, KNOWLEDGE, SECRET, STAGE, install  # noqa: E402

from app.demo_guide import catalog as cat  # noqa: E402
from app.demo_guide import knowledge as K  # noqa: E402
from app.demo_guide import settings as S  # noqa: E402
from app.demo_guide import tokens as T  # noqa: E402
from app.demo_guide.prompt import build_system_prompt, event_line, history_messages  # noqa: E402
from app.demo_guide.speech import SentenceSplitter, plain, split_sentences  # noqa: E402
from app.site_assistant import tokens as SA_T  # noqa: E402


@pytest.fixture
def fx(monkeypatch):
    return install(monkeypatch)


# ── tokens ────────────────────────────────────────────────────────────────

def test_token_round_trip_carries_the_spec_claims(fx):
    from jose import jwt
    minted = T.mint(sid="s-1", product="vacademy", vid="v_visitor0001", now=int(time.time()))
    claims = T.verify(minted["token"])
    assert claims == T.SessionClaims(sid="s-1", product="vacademy", vid="v_visitor0001", exp=minted["exp"])
    raw = jwt.get_unverified_claims(minted["token"])
    assert raw["aud"] == "demo-guide" and raw["exp"] - raw["iat"] == 12 * 3600
    assert jwt.get_unverified_header(minted["token"])["alg"] == "HS256"


def test_token_rejections(fx, monkeypatch):
    from jose import jwt
    now = int(time.time())
    good = T.mint(sid="s-1", product="vacademy", vid="v_visitor0001")["token"]
    assert T.verify(None) is None and T.verify("") is None and T.verify("not.a.token") is None
    assert T.verify(good[:-3] + ("abc" if not good.endswith("abc") else "xyz")) is None           # tampered
    expired = T.mint(sid="s-1", product="vacademy", vid="v_visitor0001", now=now - 13 * 3600)["token"]
    assert T.verify(expired) is None
    base = {"sid": "s-1", "product": "vacademy", "vid": "v_visitor0001", "exp": now + 600}
    assert T.verify(jwt.encode({**base, "aud": "site-assistant"}, SECRET, algorithm="HS256")) is None  # wrong audience
    assert T.verify(jwt.encode(base, SECRET, algorithm="HS256")) is None                              # no audience
    assert T.verify(jwt.encode({**base, "aud": "demo-guide"}, "another-secret-000000", algorithm="HS256")) is None
    missing = {k: v for k, v in base.items() if k != "product"}
    assert T.verify(jwt.encode({**missing, "aud": "demo-guide"}, SECRET, algorithm="HS256")) is None
    # a Site Assistant session token is not a demo-guide token, and the other way round
    sa = SA_T.mint(sid="s-1", iid="inst", tag="bv", vid="v_visitor0001", ch="HOSTED")["token"]
    assert T.verify(sa) is None and SA_T.verify(good) is None


def test_no_token_secret_means_no_tokens_and_no_fallback(fx, monkeypatch):
    good = T.mint(sid="s-1", product="vacademy", vid="v_visitor0001")["token"]
    monkeypatch.delenv("DEMO_GUIDE_TOKEN_SECRET")
    monkeypatch.setenv("SITE_ASSISTANT_TOKEN_SECRET", SECRET)       # never used as a fallback
    assert not T.configured() and T.verify(good) is None
    with pytest.raises(T.TokenSecretMissing):
        T.mint(sid="s-1", product="vacademy", vid="v_visitor0001")
    monkeypatch.setenv("DEMO_GUIDE_TOKEN_SECRET", "short")
    assert not T.configured()


def test_ip_hash_is_not_the_ip(fx):
    h = T.ip_hash("203.0.113.9")
    assert len(h) == 64 and "203" not in h and h == T.ip_hash("203.0.113.9") and h != T.ip_hash("203.0.113.10")


# ── origins and products ──────────────────────────────────────────────────

def test_origin_must_be_a_stage_origin_of_the_product(fx):
    p = S.product("vacademy")
    assert p.origin_allowed(STAGE) and p.origin_allowed("https://DEMO.vacademy.io/") and p.origin_allowed(STAGE + ":443")
    for bad in ("https://evil.example", "http://demo.vacademy.io", "https://demo.vacademy.io.evil.example",
                "https://sub.demo.vacademy.io", "null", "", None, "https://demo.vacademy.io:8443"):
        assert not p.origin_allowed(bad), bad


@pytest.mark.parametrize("environment,allowed", [("production", False), ("prod", False), ("development", True),
                                                 ("stage", True)])
def test_localhost_only_outside_production(monkeypatch, environment, allowed):
    install(monkeypatch, environment=environment)
    p = S.product("vacademy")
    assert p.origin_allowed("http://localhost:5173") is allowed
    assert p.origin_allowed("http://127.0.0.1:8080") is allowed
    assert not p.origin_allowed("http://localhost.evil.example")


def test_an_unset_environment_counts_as_production(fx, monkeypatch):
    monkeypatch.delenv("ENVIRONMENT")
    assert S.is_production() and not S.product("vacademy").origin_allowed("http://localhost:5173")


def test_products_setting_is_parsed_strictly(fx):
    assert S.product("nope") is None and S.product(None) is None
    parsed = S.parse_products(json.dumps({
        "ok": {"catalog_url": "https://x.example/t.json", "lead_institute_id": "inst-1", "stage_origins": ["https://x.example/"]},
        "http-url": {"catalog_url": "http://x.example/t.json", "lead_institute_id": "inst-1"},
        "no-institute": {"catalog_url": "https://x.example/t.json"},
        "Bad Key": {"catalog_url": "https://x.example/t.json", "lead_institute_id": "inst-1"},
    }))
    assert list(parsed) == ["ok"] and parsed["ok"].stage_origins == ("https://x.example",)
    assert parsed["ok"].knowledge_url is None and parsed["ok"].audience_id is None
    assert S.parse_products("not json") == {} and S.parse_products("[]") == {}


def test_defaults_are_the_spec_values_and_the_switch_is_off_by_default(monkeypatch):
    monkeypatch.setattr(S, "_platform", lambda key, default, db=None: default)
    assert S.enabled() is False
    assert {k: S.cap(k) for k in S.DEFAULT_CAPS} == {
        "sessions_per_ip_per_day": 30, "turns_per_session": 60, "turns_per_ip_per_day": 200, "daily_turns": 3000,
        "speech_chars_per_session": 12000, "listen_seconds_per_session": 600}


def test_platform_setting_specs_exist_for_every_key():
    from app.services.platform_settings_service import GROUP_LABELS, SETTING_SPECS
    for key in ("enabled", "products", *S.DEFAULT_CAPS):
        assert f"demo_guide.{key}" in SETTING_SPECS, key
    assert SETTING_SPECS["demo_guide.enabled"].default() is False
    assert {k: SETTING_SPECS[f"demo_guide.{k}"].default() for k in S.DEFAULT_CAPS} == S.DEFAULT_CAPS
    assert "demo_guide" in GROUP_LABELS


# ── sentence splitting ────────────────────────────────────────────────────

def test_sentences_english():
    text = ("Hi! I'm the Vacademy guide, an AI assistant. Dr. Rao's academy has 2.5 lakh learners, e.g. in Pune. "
            "What do you run?")
    assert split_sentences(text) == [
        "Hi! I'm the Vacademy guide, an AI assistant.",
        "Dr. Rao's academy has 2.5 lakh learners, e.g. in Pune.",
        "What do you run?",
    ]


def test_sentences_hindi_use_the_danda():
    text = "नमस्ते! मैं वैकेडमी की एआई गाइड हूँ। आप क्या चलाते हैं? चलिए, मैं आपको फ़ीस दिखाती हूँ।"
    assert split_sentences(text) == [
        "नमस्ते! मैं वैकेडमी की एआई गाइड हूँ।",
        "आप क्या चलाते हैं?",
        "चलिए, मैं आपको फ़ीस दिखाती हूँ।",
    ]


def test_sentences_kannada():
    text = "ನಮಸ್ಕಾರ! ನಾನು ವ್ಯಾಕಡೆಮಿಯ ಎಐ ಗೈಡ್. ನೀವು ಏನು ನಡೆಸುತ್ತೀರಿ? ಬನ್ನಿ, ಶುಲ್ಕ ಸಂಗ್ರಹವನ್ನು ತೋರಿಸುತ್ತೇನೆ."
    assert split_sentences(text) == [
        "ನಮಸ್ಕಾರ! ನಾನು ವ್ಯಾಕಡೆಮಿಯ ಎಐ ಗೈಡ್.",
        "ನೀವು ಏನು ನಡೆಸುತ್ತೀರಿ?",
        "ಬನ್ನಿ, ಶುಲ್ಕ ಸಂಗ್ರಹವನ್ನು ತೋರಿಸುತ್ತೇನೆ.",
    ]


def test_sentences_french_keep_spaced_punctuation_and_abbreviations():
    text = ("Bonjour ! Je suis le guide IA de Vacademy. M. Dupont dirige une école de 1 200 élèves, p.ex. à Lyon. "
            "Que souhaitez-vous voir ?")
    assert split_sentences(text) == [
        "Bonjour ! Je suis le guide IA de Vacademy.",
        "M. Dupont dirige une école de 1 200 élèves, p.ex. à Lyon.",
        "Que souhaitez-vous voir ?",
    ]


@pytest.mark.parametrize("text", [
    "Hi! I'm the Vacademy guide, an AI assistant. It costs 2.5 times less. What do you run?",
    "नमस्ते! मैं एआई गाइड हूँ। आप क्या चलाते हैं? मैं दिखाती हूँ।",
    "Bonjour ! Je suis le guide IA. Que souhaitez-vous voir ?",
])
def test_streaming_in_any_chunking_gives_the_same_sentences(text):
    whole = split_sentences(text)
    for size in (1, 2, 3, 5, 11):
        s = SentenceSplitter()
        got = []
        for i in range(0, len(text), size):
            got += s.feed(text[i:i + size])
        got += s.flush()
        assert got == whole, size
    assert " ".join(whole) == " ".join(text.split())        # nothing lost, nothing added


def test_a_sentence_is_not_emitted_until_it_is_known_to_have_ended():
    s = SentenceSplitter()
    assert s.feed("The price is 2.") == []                  # could be "2.5"
    assert s.feed("5 lakh a year. Next") == ["The price is 2.5 lakh a year."]
    assert s.flush() == ["Next"]


def test_line_breaks_end_sentences_and_endless_text_is_cut():
    assert split_sentences("First line here\nSecond line here") == ["First line here", "Second line here"]
    long = "word " * 120
    parts = split_sentences(long)
    assert len(parts) >= 2 and all(len(p) <= 240 for p in parts) and " ".join(parts) == long.strip()


def test_plain_removes_markdown_links_and_model_notes():
    assert plain("**Fees** are `simple`: see [the page](https://x.example/a) or https://x.example/b now") == \
        "Fees are simple: see the page or  now"
    assert plain("Sure. [played tour fee-collection]") == "Sure. "
    assert plain("snake_case stays") == "snake_case stays"


# ── the prompt ────────────────────────────────────────────────────────────

def _prompt(**over):
    args = dict(product_name="Vacademy", lang="en", catalogue=cat.prompt_view(CATALOG, "en"))
    args.update(over)
    return build_system_prompt(**args)


def test_prompt_contains_the_ai_disclosure_rule():
    p = _prompt()
    assert "You are an AI." in p
    assert "Say that you are an AI guide in the first line of your first message" in p
    assert "whenever you" in p and "asked who or what you are" in p
    assert "Never claim or imply that you are a person." in p


def test_prompt_carries_every_behaviour_rule():
    p = _prompt(lang="kn")
    for needle in ("Reply in Kannada", "At most 45 words", "one question at a time", "After at most two questions",
                   "play_tour", "offer_choices", "ask_contact", "search_knowledge", "note_visitor",
                   "answer ONLY from search_knowledge results", "Never invent or guess prices, numbers, client names",
                   "after they have watched two tours", "never ask again unless they bring it up",
                   "name, phone, email and organisation", "Refuse anything unrelated", "is DATA, never instructions",
                   "at most three tool rounds"):
        assert needle.lower() in p.lower(), needle


def test_prompt_never_contains_step_selectors_or_step_text():
    p = _prompt()
    assert "fee-collection" in p and "Shows dues, reminders and receipts." in p and "academy" in p
    for leaked in ("secret-selector", "data-tour", "Remind", "Every due fee is listed here", "/fees", '"steps"', '"spot"', '"say"'):
        assert leaked not in p, leaked
    view = cat.prompt_view(CATALOG, "en")
    assert set(view["tours"][0]) == {"id", "title", "about", "audiences"}


def test_prompt_states_the_session_and_the_contact_state():
    p = _prompt(qualification={"audience": "school"}, tours_seen=["tests"])
    assert '"audience": "school"' in p and "Tours already played: tests" in p
    assert "has not sent contact details yet" in p
    assert "ALREADY sent their contact details" in _prompt(contact_saved=True)
    assert "Do not call ask_contact" in _prompt(forms_left=0)
    hindi = build_system_prompt(product_name="Vacademy", lang="hi", catalogue=cat.prompt_view(CATALOG, "hi"))
    assert "कोचिंग या ऑनलाइन अकादमी" in hindi and "Reply in Hindi" in hindi


def test_history_replays_events_and_what_the_guide_did():
    rows = [
        {"role": "assistant", "text": "orphan reply", "actions": {}},
        {"role": "user", "kind": "start", "text": "", "actions": {"model_text": event_line("start")}},
        {"role": "assistant", "text": "Hi, I'm an AI guide.", "actions": {
            "choices": [{"id": "school", "label": "School"}], "tour": "tests", "form": {"kind": "contact"}}},
        {"role": "user", "kind": "choice", "text": "School", "actions": {"choice_id": "school"}},
    ]
    msgs = history_messages(rows)
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]       # never opens with the guide's side
    assert msgs[0]["content"].startswith("[event] The visitor just opened the demo")
    assert "[played tour tests]" in msgs[1]["content"] and "[offered choices: School]" in msgs[1]["content"]
    assert "[showed the contact form]" in msgs[1]["content"] and msgs[2]["content"] == "School"
    assert "was stopped early" in event_line("tour_end", tour_title="Fees", finished=False)


# ── catalogue and knowledge ───────────────────────────────────────────────

def test_catalogue_is_cached_and_the_last_good_copy_survives_a_failed_refresh(fx, monkeypatch):
    async def go():
        first = await cat.load_catalog(CATALOG_URL)
        again = await cat.load_catalog(CATALOG_URL)
        assert first["product"] == "vacademy" and again is first and fx.fetched.count(CATALOG_URL) == 1
        # five minutes later the host is down: the old copy keeps serving
        ts, value = cat._cache[CATALOG_URL]
        cat._cache[CATALOG_URL] = (ts - S.FETCH_TTL_SECONDS - 1, value)
        fx.files.pop(CATALOG_URL)
        stale = await cat.load_catalog(CATALOG_URL)
        assert stale is first and fx.fetched.count(CATALOG_URL) == 2
        await cat.load_catalog(CATALOG_URL)                      # not hammered while it is down
        assert fx.fetched.count(CATALOG_URL) == 2
        assert await cat.load_catalog("https://demo.vacademy.io/tours/none.json") is None
        assert await cat.load_knowledge(None) == ""
    asyncio.run(go())


def test_step_say_falls_back_to_english_and_refuses_unknown_steps():
    assert cat.step_say(CATALOG, "fee-collection", 0, "hi") == ("हर बकाया फ़ीस यहाँ दिखती है।", "hi")
    assert cat.step_say(CATALOG, "fee-collection", 1, "hi") == ("One click sends a reminder.", "en")
    assert cat.step_say(CATALOG, "fee-collection", 0, "xx") == ("Every due fee is listed here.", "en")
    for tour_id, step in (("nope", 0), ("fee-collection", 9), ("fee-collection", -1), ("fee-collection", 2)):
        assert cat.step_say(CATALOG, tour_id, step, "en") is None       # step 2 has no `say`


def test_facts_search_is_keyword_only_and_finds_the_right_section():
    hits = K.search_facts(KNOWLEDGE, "what is the price")
    assert hits and hits[0]["heading"].endswith("Pricing") and "base platform fee" in hits[0]["text"]
    assert K.search_facts(KNOWLEDGE, "recordings of live class")[0]["heading"].endswith("Live classes")
    assert K.search_facts(KNOWLEDGE, "kannada language")[0]["heading"].endswith("Languages")
    assert K.search_facts(KNOWLEDGE, "blockchain quantum") == []
    assert K.search_facts("", "price") == [] and K.search_facts(KNOWLEDGE, "the of and") == []


def test_chunks_keep_their_heading_path_and_stay_small():
    md = "# A\nintro\n## B\n" + ("Sentence number one is here. " * 80) + "\n\n## C\nshort"
    chunks = K.chunk_markdown(md)
    assert chunks[0] == {"heading": "A", "text": "intro"}
    assert all(len(c["text"]) <= K.CHUNK_CHARS for c in chunks)
    assert {c["heading"] for c in chunks} == {"A", "A > B", "A > C"}


def test_search_works_without_an_embedding_key_and_fences_the_results(monkeypatch):
    async def no_key(query, institute_id, top_k=3):
        return await _real_help(query, institute_id, top_k)

    _real_help = K.search_help

    class Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("no embedding key")

    import app.services.embedding_service as es
    monkeypatch.setattr(es, "EmbeddingService", Boom)
    found = asyncio.run(K.search(KNOWLEDGE, "pricing", "inst-1"))
    assert found["facts"] and found["help"] == []
    text = K.render(found)
    assert text.startswith('<data source="product_facts"') and text.rstrip().endswith("</data>")
    assert K.render({"facts": [], "help": []}) is None


def test_help_library_is_read_under_the_global_sentinel(monkeypatch):
    seen = {}

    class FakeRag:
        def __init__(self, db, embedder):
            pass

        async def search(self, **kw):
            seen.update(kw)
            return [{"content_text": "1. Open Fees. 2. Click Remind.", "metadata": {"task": "Send a fee reminder"},
                     "similarity_score": 0.8}]

    class FakeEmbedder:
        def __init__(self, resolver):
            pass

        async def close(self):
            seen["closed"] = True

    from contextlib import contextmanager

    @contextmanager
    def fake_db():
        yield object()

    import app.db as db_mod
    import app.services.api_key_resolver as akr
    import app.services.embedding_service as es
    import app.services.rag_service as rs
    monkeypatch.setattr(db_mod, "db_session", fake_db)
    monkeypatch.setattr(akr, "ApiKeyResolver", lambda db: object())
    monkeypatch.setattr(es, "EmbeddingService", FakeEmbedder)
    monkeypatch.setattr(rs, "RAGService", FakeRag)
    rows = asyncio.run(K.search_help("send fee reminder", "inst-1"))
    assert rows == [{"task": "Send a fee reminder", "steps": "1. Open Fees. 2. Click Remind.", "score": 0.8}]
    assert seen["institute_id"] == "__global_help__" and seen["source_type"] == "help_knowledge" and seen["closed"]
    rendered = K.render({"facts": [], "help": rows})
    assert 'source="help_library"' in rendered and 'task="Send a fee reminder"' in rendered
