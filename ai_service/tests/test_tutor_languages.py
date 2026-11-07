"""Tutor Mode languages: English, Hindi, Bengali, Kannada.

A course is compiled in its course language plus ONE second language (English
for an Indian-language course, Hindi for an English course). Every layer —
compile prompt, validator, voice prep, runtime templates, intents, the boot
payload — must agree on that pair.
"""
import string

import pytest

from app.schemas.tutor import CompileOptions, TeachingPlanDraft
from app.services.tutor import compile_prompts, languages as L
from app.services.tutor.plan_validator import soft_errors, validate_plan
from app.services.tutor.quiz_compiler import compile_quiz
from app.services.tutor.runtime import prompts
from app.services.tutor.runtime.intents import detect_intent
from app.services.tutor.runtime.revisit import fallback_check
from app.services.tutor.runtime.settings import TutorSettings, _apply
from app.services.tutor.runtime.speech import spoken_form
from tests.test_tutor_compile import _quiz_source


# ── the pair rule ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("course,expected", [
    ("en", ["en", "hi"]), ("hi", ["hi", "en"]), ("bn", ["bn", "en"]), ("kn", ["kn", "en"]),
    ("ta", ["en", "hi"]), (None, ["en", "hi"]), ("bn-IN", ["bn", "en"]),
])
def test_pair_is_course_language_plus_one(course, expected):
    assert L.pair(course) == expected


def test_settings_accept_bengali_and_kannada_course_language():
    for code in ("bn", "kn"):
        s = TutorSettings()
        _apply(s, {"languages": [code, "en"]})
        assert s.course_language == code
        assert s.language_pair == [code, "en"]
    s = TutorSettings()
    _apply(s, {"languages": ["ta", "en"]})   # unsupported falls back to English
    assert s.course_language == "en"


def test_compile_options_accept_new_languages():
    assert CompileOptions(language="bn").language == "bn"
    assert CompileOptions(language="kn").language == "kn"
    with pytest.raises(Exception):
        CompileOptions(language="ta")


# ── compile prompt ───────────────────────────────────────────────────────────

def test_bengali_compile_prompt_asks_for_bengali_and_english():
    schema = compile_prompts.plan_schema_text("bn")
    assert '"say_i18n": {"en":' in schema
    assert "spoken sentences in Bengali" in schema
    system = compile_prompts.system_prompt("Asha", "bn")
    assert "Course language: Bengali" in system
    assert "BENGALI means" in system and "HINDI means" not in system


def test_english_compile_prompt_keeps_hinglish_rule():
    system = compile_prompts.system_prompt("Asha", "en")
    assert "HINDI means Hinglish" in system
    assert '"say_i18n": {"hi":' in compile_prompts.plan_schema_text("en")


def test_kannada_compile_prompt():
    system = compile_prompts.system_prompt("Asha", "kn")
    assert "Course language: Kannada" in system and "KANNADA means" in system


# ── validator ────────────────────────────────────────────────────────────────

def _plan(lang: str, say: str, alt_lang: str, alt: str) -> TeachingPlanDraft:
    return TeachingPlanDraft.model_validate({
        "language": lang, "objectives": ["x"], "key_terms": [],
        "topics": [{
            "id": "t1", "title": "Force", "estimated_seconds": 60,
            "concepts": [{
                "id": "t1c1", "title": "Push", "concept_tags": ["force.def"],
                "board_ops": [{"op": "heading", "id": "t1-h", "text": "Force"},
                              {"op": "svg", "id": "t1c1-d", "svg": "<svg viewBox='0 0 10 10'><circle id='b' r='2'/></svg>",
                               "description": "a ball being pushed", "parts": [{"id": "b", "label": "Ball"}]}],
                "say": say, "say_i18n": {alt_lang: alt}, "check": {"type": "none"},
            }],
            "summary_say": say, "summary_say_i18n": {alt_lang: alt},
        }],
    })


def test_bengali_course_needs_english_narration_not_hindi():
    ok = _plan("bn", "force হলো একটা push বা pull।", "en", "A force is a push or a pull.")
    assert not [e for e in validate_plan(ok, "bn") if "say_i18n" in e]
    missing = _plan("bn", "force হলো একটা push বা pull।", "hi", "बल एक धक्का है।")
    assert any("say_i18n['en'] is missing" in e for e in validate_plan(missing, "bn"))


def test_script_check_catches_english_passed_off_as_indian_language():
    assert L.in_native_script("force হলো একটা push বা pull", "bn")
    assert L.in_native_script("force ಎಂದರೆ ಒಂದು push ಅಥವಾ pull", "kn")
    assert not L.in_native_script("A force is a push or a pull", "bn")
    assert not L.in_native_script("बल एक धक्का है", "kn")      # wrong script
    assert L.in_native_script("anything", "en")


def test_soft_errors_flag_non_hindi_i18n_for_english_course():
    bad = _plan("en", "A force is a push.", "hi", "A force is a push.")
    assert any("is not Hindi" in e for e in soft_errors(bad))


# ── quiz compiler ────────────────────────────────────────────────────────────

def test_quiz_plan_in_kannada_has_english_second_language():
    src = _quiz_source()
    plan = compile_quiz(src, "kn")
    intro = plan.topics[0].concepts[0]
    assert "ಅಧ್ಯಾಯ" in intro.say and set(intro.say_i18n) == {"en"}


# ── runtime templates ────────────────────────────────────────────────────────

def _fields(s: str) -> set:
    return {f for _, f, _, _ in string.Formatter().parse(s) if f}


def test_every_template_has_bengali_and_kannada_with_same_placeholders():
    for key, table in prompts.T.items():
        for lang in ("hi", "bn", "kn"):
            assert lang in table, f"{key} has no {lang}"
            assert _fields(table[lang]) == _fields(table["en"]), f"{key}/{lang} placeholders differ"
        for lang in ("bn", "kn"):
            # The words around the placeholders ("{prompt}" alone has none).
            literal = "".join(lit for lit, *_ in string.Formatter().parse(table[lang]))
            assert L.in_native_script(literal, lang), f"{key}/{lang} is not in {lang} script"


def test_tpl_renders_bengali_and_kannada():
    assert prompts.tpl("greet", "bn", name="Riya", teacher="Asha", slide="Force").startswith("নমস্কার Riya")
    assert prompts.tpl("greet", "kn", name="Riya", teacher="Asha", slide="Force").startswith("ನಮಸ್ಕಾರ Riya")
    assert "Bengali" in prompts.system_prompt("Asha", "bn", "normal")


def test_revisit_fallback_check_localised():
    class C:  # minimal concept
        title = "Force"; check = {}; say = "x"
    assert fallback_check(C(), "bn")["prompt"].endswith("Force কী?")
    assert "ಅಂದರೆ ಏನು" in fallback_check(C(), "kn")["prompt"]


# ── intents ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,intent", [
    ("আবার বলুন", "repeat"), ("বুঝতে পারিনি", "doubt"), ("আস্তে", "slower"), ("হয়ে গেছে", "done"),
    ("থামুন", "pause"), ("চলুন", "resume"), ("বাদ দিন", "skip"),
    ("ಮತ್ತೆ ಹೇಳಿ", "repeat"), ("ಅರ್ಥ ಆಗಿಲ್ಲ", "doubt"), ("ನಿಧಾನ", "slower"), ("ಆಯ್ತು", "done"),
    ("ನಿಲ್ಲಿಸಿ", "pause"), ("ಮುಂದುವರಿಸಿ", "resume"), ("ಬಿಟ್ಟುಬಿಡಿ", "skip"),
])
def test_bengali_and_kannada_intents(text, intent):
    assert detect_intent(text) == intent


def test_bengali_intent_matches_decomposed_ya():
    # য় as য + nukta (what some keyboards and STT engines emit)
    decomposed = "হয়ে গেছে"
    assert detect_intent(decomposed) == "done"


# ── speech and voices ────────────────────────────────────────────────────────

def test_spoken_form_bengali_maths_and_kannada_english_fallback():
    assert "যোগ" in spoken_form("x + y", "bn-IN")
    assert "plus" in spoken_form("x + y", "kn-IN")
    assert "जमा" in spoken_form("x + y", "hi-IN")


def test_voice_for_language():
    # English/Hindi keep the admin's voice exactly as before.
    assert L.tutor_voice_for("google", "hi-IN-Chirp3-HD-Achird", "en") == "hi-IN-Chirp3-HD-Achird"
    assert L.tutor_voice_for("edge", "hi-IN-SwaraNeural", "hi") == "hi-IN-SwaraNeural"
    # A Hindi-locale voice never reads Bengali / Kannada.
    assert L.tutor_voice_for("google", "hi-IN-Chirp3-HD-Achird", "bn") == "bn-IN-Chirp3-HD-Achird"
    assert L.tutor_voice_for("edge", "hi-IN-SwaraNeural", "kn") == "kn-IN-SapnaNeural"
    assert L.tutor_voice_for("edge", "", "bn") == "bn-IN-TanishaaNeural"
    assert L.tutor_voice_for("google", "bn-IN-Chirp3-HD-Achird", "bn") == "bn-IN-Chirp3-HD-Achird"
