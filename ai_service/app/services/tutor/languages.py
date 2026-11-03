"""Tutor Mode languages: one place for the codes, locales and the pair rule.

A course is taught in its course language and every spoken line is also
compiled in ONE second language, so a learner can switch mid-lesson with no
live model call (design §8). The second language is English for every
non-English course and Hindi for an English course; that keeps compile cost at
two narrations per slide whatever the course language is.

Indian-language narration is code-mixed the way a teacher speaks it: native
script sentences with the technical terms in English letters.
"""
from __future__ import annotations

import re
from typing import Iterable, List, Optional

SUPPORTED_LANGS = ("en", "hi", "bn", "kn")

# Locale handed to STT / TTS engines.
LOCALES = {"en": "en-IN", "hi": "hi-IN", "bn": "bn-IN", "kn": "kn-IN"}

# Plain names, for UI-facing strings and logs.
DISPLAY_NAMES = {"en": "English", "hi": "Hindi", "bn": "Bengali", "kn": "Kannada"}

# Names as written into model prompts (compile and live turn).
PROMPT_NAMES = {
    "en": "English",
    "hi": "Hindi (Devanagari script; keep English technical terms in Latin script)",
    "bn": "Bengali (Bengali script; keep English technical terms in Latin script)",
    "kn": "Kannada (Kannada script; keep English technical terms in Latin script)",
}

# How the compile model should write each Indian language. Each rule is one
# line of the compile prompt's narration rule.
CODE_MIX_RULES = {
    "hi": ("HINDI means Hinglish as an Indian teacher speaks it: Hindi sentences in Devanagari with the technical "
           "terms in English letters (\"physical assessment physiotherapy plan की नींव है\")"),
    "bn": ("BENGALI means Bengali as a Kolkata teacher speaks it in class: Bengali sentences in Bengali script with "
           "the technical terms in English letters (\"physical assessment হলো physiotherapy plan-এর ভিত্তি\")"),
    "kn": ("KANNADA means Kannada as a Bengaluru teacher speaks it in class: Kannada sentences in Kannada script "
           "with the technical terms in English letters (\"physical assessment ಎಂಬುದು physiotherapy plan-ನ ಅಡಿಪಾಯ\")"),
}

_SCRIPTS = {
    "hi": re.compile(r"[ऀ-ॿ]"),   # Devanagari
    "bn": re.compile(r"[ঀ-৿]"),   # Bengali
    "kn": re.compile(r"[ಀ-೿]"),   # Kannada
}
_LATIN = re.compile(r"[A-Za-z]")
# Every Indic script block (Devanagari through Malayalam): Hindi handed back
# as "Kannada" must fail, not pass for want of Latin letters.
_INDIC = re.compile(r"[\u0900-\u0DFF]")
# Code-mixed narration keeps English technical terms, so a sentence can be
# mostly Latin letters; it must still carry at least this share of the
# language's own script among all letters.
MIN_NATIVE_SHARE = 0.15


def normalize(lang: Optional[str], default: str = "en") -> str:
    """A supported code, or `default`. Accepts locales ("bn-IN") too."""
    code = (lang or "").strip().lower().split("-")[0]
    return code if code in SUPPORTED_LANGS else default


def is_supported(lang: Optional[str]) -> bool:
    return (lang or "") in SUPPORTED_LANGS


def second_language(course_lang: str) -> str:
    """The one other language every spoken line is compiled in."""
    return "hi" if normalize(course_lang) == "en" else "en"


def pair(course_lang: str) -> List[str]:
    """[course language, second language] — what a plan is compiled in and
    what a learner may switch between."""
    c = normalize(course_lang)
    return [c, second_language(c)]


def filter_supported(langs: Optional[Iterable[str]]) -> List[str]:
    out: List[str] = []
    for x in langs or []:
        if x in SUPPORTED_LANGS and x not in out:
            out.append(x)
    return out


def locale(lang: Optional[str]) -> str:
    return LOCALES.get(normalize(lang), "en-IN")


def prompt_name(lang: Optional[str]) -> str:
    return PROMPT_NAMES.get(lang or "", lang or "English")


def in_native_script(text: str, lang: str) -> bool:
    """Is this line really written in `lang`? English (and unknown codes)
    always pass; an Indian language needs a share of its own script, so an
    English sentence handed back as "Bengali" is caught."""
    script = _SCRIPTS.get(lang)
    if script is None:
        return True
    native = len(script.findall(text or ""))
    total = len(_INDIC.findall(text or "")) + len(_LATIN.findall(text or ""))
    return total == 0 or native / total >= MIN_NATIVE_SHARE


def voice_matches_locale(voice: Optional[str], loc: str) -> bool:
    """Google/Edge voice ids carry their locale ("hi-IN-SwaraNeural"); a voice
    without a locale prefix (Sarvam, Smallest) is multilingual."""
    v = (voice or "").strip()
    if not v or not re.match(r"^[a-z]{2}-[A-Z]{2}-", v):
        return True
    return v.startswith(loc + "-")


def tutor_voice_for(provider: str, voice: Optional[str], lang: str) -> str:
    """The Google/Edge voice to speak `lang` with. Their voice ids are tied to
    a locale, and the admin picks ONE voice for the course: a Hindi voice must
    not read Bengali or Kannada narration. English and Hindi keep the picked
    voice as before (an Indian-English or Hindi voice reads both)."""
    from ..voice_tts import default_voice_for  # lazy: keeps this module import-light

    loc = locale(lang)
    v = (voice or "").strip()
    if not v:
        return default_voice_for(provider, loc)
    if lang in ("en", "hi") or voice_matches_locale(v, loc):
        return v
    if provider == "google":
        # Chirp3-HD voice names are shared across locales: keep the persona.
        parts = v.split("-", 2)
        if len(parts) == 3:
            return f"{loc}-{parts[2]}"
    return default_voice_for(provider, loc)


# What the teacher calls a learner whose name is unknown ("{student_name}").
UNNAMED_LEARNER = {"en": "there", "hi": "दोस्त", "bn": "বন্ধু", "kn": "ಗೆಳೆಯರೇ"}
