"""answer_language: the declared language of a paper decides who reads it,
whether it is refused, how its language is judged and how it is drawn."""
import pytest

from app.services.copy_check import annotator, answer_language as al, language_feedback as lf, language_vision as lv
from app.services.copy_check.prompt_builder import examiner_instructions_block


@pytest.mark.parametrize("value, code", [
    ("hi", "hi"), ("Hindi", "hi"), ("HIN", "hi"), ("hi-IN", "hi"), ("sanskrit", "sa"), ("Marathi", "mr"),
    ("urd", "ur"), ("Bangla", "bn"), ("fra", "fr"), ("de-DE", "de"), ("Chinese", "zh"), ("pa", "pa"),
    ("", ""), (None, ""), ("klingon", ""),
])
def test_codes_and_names(value, code):
    assert al.code_of(value) == code


def test_indian_and_arabic_scripts_are_read_with_the_language_check_model(monkeypatch):
    monkeypatch.setattr(lv, "language_model", lambda: "strong-reader")
    for code in ("hi", "sa", "mr", "ur", "bn", "ta", "te", "ar"):
        assert al.reading_model({"answer_language": code}, "default") == "strong-reader", code
    for value in ("en", "fr", "es", "de", "zh", "", "klingon", None):
        assert al.reading_model({"answer_language": value}, "default") == "default", value
    assert al.reading_model(None, "default") == "default"


def test_punjabi_and_gujarati_are_refused():
    assert al.unsupported({"answer_language": "pa"}).name == "Punjabi"
    assert al.unsupported({"answer_language": "Gujarati"}).name == "Gujarati"
    for code in ("en", "hi", "sa", "ur", "zh", "", "klingon"):
        assert al.unsupported({"answer_language": code}) is None
    # A refused language is never read with the strong model either.
    assert not al.needs_strong_reader({"answer_language": "pa"})


def test_highlight_runs_for_every_supported_language():
    on = {"language_feedback": "HIGHLIGHT"}
    for code in ("", "en", "hi", "sa", "mr", "ur", "bn", "ta", "te", "fr", "es", "de", "ar", "zh", "Sanskrit"):
        assert lf.enabled({**on, "answer_language": code}), code
    assert not lf.enabled({**on, "answer_language": "pa"})
    assert not lf.enabled({**on, "answer_language": "klingon"})
    assert not lf.enabled({"answer_language": "sa"})          # HIGHLIGHT not asked for


def test_prompt_follows_the_declared_language():
    deva = [{"line_id": "p1_r1", "text": "बालकः विद्यालयं गच्छन्ति"}]
    latin = [{"line_id": "p1_r1", "text": "he go home"}]
    # Unchanged behaviour when nothing (or English / Hindi) is declared.
    assert lf.system_prompt(latin, True) == lf.LANGUAGE_SYSTEM
    assert lf.system_prompt(deva, True) == lf.LANGUAGE_SYSTEM_HINDI
    assert lf.system_prompt(deva, True, "hi") == lf.LANGUAGE_SYSTEM_HINDI
    assert lf.system_prompt(latin, True, "en") == lf.LANGUAGE_SYSTEM
    # Sanskrit shares Devanagari with Hindi but is judged as Sanskrit.
    sa = lf.system_prompt(deva, True, "sa")
    assert "teacher of Sanskrit" in sa and sa != lf.LANGUAGE_SYSTEM_HINDI
    assert "teacher of Urdu" in lf.system_prompt(latin, False, "ur")
    assert '"errors"' in sa and "{" not in sa.split("Return STRICT JSON")[0][-5:]
    # The vision pass the same way.
    assert lv.spot_prompt(True, []).startswith(lv.SPOT_HINDI)
    assert lv.spot_prompt(False, []).startswith(lv.SPOT_ENGLISH)
    assert "examiner of Marathi" in lv.spot_prompt(True, [], language="mr")
    assert "examiner of French" in lv.spot_prompt(False, [], language="fr")


def test_non_latin_corrections_are_never_judged_as_latin_misreads():
    # The letter-shape table is Latin: an Urdu or Tamil correction must not be
    # thrown away by it, and is held to the strict transcript match instead.
    assert not lv.reading_slip("خریدا", "خریدے", "spelling")
    assert not lv.reading_slip("வாங்கினேன்", "வாங்கினேன", "spelling")
    assert lv.reading_slip("Jake", "fake", "spelling")
    assert al.is_latin("Ma frère est resté") and not al.is_latin("میری ماں") and not al.is_latin("我")


@pytest.mark.parametrize("text", ["میری ماں گھر پر تھی", "வானிலை நன்றாக", "我去市场", "বাংলা", "తెలుగు"])
def test_corrections_in_any_script_survive_to_the_copy(text):
    assert annotator._needs_shaping(text)
    assert annotator._script_safe(text).strip() == text
    width, _step = annotator._correction_metrics(text, 10.0)
    assert width > 10.0


def test_latin_and_devanagari_paths_are_unchanged():
    assert not annotator._needs_shaping("plain English, café")
    assert annotator._script_safe("café “quoted”") == annotator._latin1("café “quoted”")
    assert annotator._needs_shaping("मेरी माता")
    assert annotator._script_safe("मेरी माता X") == "मेरी माता X"


def test_shaped_text_is_drawn_not_blanked():
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=400, height=200)
    ok = annotator._deva_write(page, fitz.Rect(10, 10, 390, 190), ["میری ماں", "我去市场", "தமிழ்"], 12.0,
                               (0.8, 0.1, 0.1))
    assert ok
    text = page.get_text()
    assert "我去市场" in text


def test_grader_is_told_the_language_except_for_english():
    assert examiner_instructions_block({"answer_language": "sa"}).count("answered in Sanskrit") == 1
    assert examiner_instructions_block({"answer_language": "en"}) == ""
    assert examiner_instructions_block({}) == ""
    both = examiner_instructions_block({"answer_language": "ur", "instructions": "Mark strictly."})
    assert "answered in Urdu" in both and "Mark strictly." in both


def test_right_to_left_text_is_recognised():
    assert annotator._is_rtl("میری ماں") and annotator._is_rtl("ذهبت إلى السوق")
    assert not annotator._is_rtl("मेरी माता") and not annotator._is_rtl("Ma frère") and not annotator._is_rtl("")


@pytest.mark.parametrize("text", ["sin θ = 0.5", "Shrī Rāma", "Ελληνικά", "plain English"])
def test_latin_greek_and_symbols_keep_the_pen_they_always_had(text):
    # English copies carry maths symbols and transliterated names: the new
    # script path must not touch them.
    assert not annotator._needs_shaping(text)
    assert al.is_latin(text)


# ------------------------------------------------------------------ detection

def test_detection_picks_the_main_non_english_language():
    d = al.parse_detection('{"languages": [{"language": "English", "share": 0.45}, {"language": "Hindi", "share": 0.55}]}')
    assert d.code == "hi" and d.unsupported is None
    assert al.parse_detection('{"languages": [{"language": "Sanskrit", "share": 0.9}]}').code == "sa"
    assert al.parse_detection('```json\n{"languages": [{"language": "Urdu", "share": 1}]}\n```').code == "ur"


def test_english_or_unknown_or_garbage_changes_nothing():
    for content in ('{"languages": [{"language": "English", "share": 1.0}]}', "", "not json",
                    '{"languages": [{"language": "Klingon", "share": 0.9}]}',
                    '{"languages": [{"language": "Hindi", "share": 0.05}, {"language": "English", "share": 0.95}]}'):
        d = al.parse_detection(content)
        assert d.code == "" and d.unsupported is None
        ctx = {"subject": "Essay"}
        assert al.with_detected(ctx, d) is ctx


def test_a_copy_mostly_in_an_unreadable_language_is_refused_only_then():
    assert al.parse_detection('{"languages": [{"language": "Punjabi", "share": 0.8}]}').unsupported.code == "pa"
    d = al.parse_detection('{"languages": [{"language": "Gujarati", "share": 0.3}, {"language": "Hindi", "share": 0.4},'
                           ' {"language": "English", "share": 0.3}]}')
    assert d.unsupported is None and d.code == "hi"


def test_a_declared_language_wins_over_detection():
    ctx = {"answer_language": "en"}
    assert al.with_detected(ctx, al.Detected("hi", 0.9)) is ctx
    assert al.with_detected({}, al.Detected("sa", 0.9))["answer_language"] == "sa"
    assert al.with_detected(None, al.Detected("ur", 0.9)) == {"answer_language": "ur"}


def test_sample_pages_cover_first_middle_last():
    assert al.sample_pages(["p1", "p2"]) == ["p1", "p2"]
    assert al.sample_pages([f"p{i}" for i in range(1, 8)]) == ["p1", "p4", "p7"]


def test_detect_never_raises_and_reads_as_before_on_failure():
    import asyncio

    class Boom:
        async def chat_completion(self, **_kw):
            raise RuntimeError("provider down")

    from PIL import Image
    img = Image.new("RGB", (40, 40), "white")
    got = asyncio.run(al.detect(Boom(), "m", {"p1": img}, ["p1"]))
    assert got.code == "" and got.unsupported is None
    assert asyncio.run(al.detect(Boom(), "m", {}, ["p1"])).code == ""
