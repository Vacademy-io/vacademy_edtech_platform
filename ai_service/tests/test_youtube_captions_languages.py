"""Caption track selection order (services/youtube_captions/languages.py). Pure, no I/O."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.youtube_captions.languages import (  # noqa: E402
    Candidate, base, pick, route_candidates, spoken_language, Track,
)


def codes(cands):
    return [(c.code, c.kind) + ((c.translate_to,) if c.translate_to else ()) for c in cands]


def test_base_code_matching():
    assert base("en-IN") == "en" and base("zh-Hans") == "zh" and base(None) == "" and base("HI") == "hi"


def test_requested_manual_first_then_requested_auto():
    tracks = [("hi", True, True), ("en", False, True), ("en-IN", True, False)]
    got = codes(pick(tracks, "en"))
    assert got[:2] == [("en", "manual"), ("en-IN", "auto")]


def test_requested_present_only_as_auto():
    tracks = [("en", True, True), ("hi", False, True)]
    assert codes(pick(tracks, "en"))[0] == ("en", "auto")


def test_hindi_auto_only_no_request():
    assert codes(pick([("hi", True, True)])) == [("hi", "auto")]


def test_hindi_auto_only_with_english_request_translates_last():
    got = codes(pick([("hi", True, True)], "en"))
    assert got == [("hi", "auto"), ("hi", "translated", "en")]


def test_manual_english_with_hindi_asr_keeps_todays_text():
    # Today's order was en, then hi: a manual English track still wins.
    tracks = [("hi", True, True), ("en", False, True)]
    assert codes(pick(tracks))[0] == ("en", "manual")


def test_manual_in_spoken_language_beats_manual_fallbacks():
    tracks = [("ta", True, True), ("en", False, True), ("ta", False, True)]
    got = codes(pick(tracks))
    assert got[0] == ("ta", "manual") and got[1] == ("en", "manual") and got[2] == ("ta", "auto")


def test_manual_fallback_languages_before_spoken_auto():
    tracks = [("mr", True, True), ("hi", False, False)]
    assert codes(pick(tracks)) == [("hi", "manual"), ("mr", "auto")]


def test_any_manual_then_any_auto_last():
    tracks = [("fr", False, False), ("de", True, False)]
    # spoken = de: no manual de / hi / en; auto de comes before the any-manual step
    assert codes(pick(tracks)) == [("de", "auto"), ("fr", "manual")]


def test_no_translation_without_a_request():
    got = pick([("hi", True, True), ("ta", False, True)])
    assert all(c.translate_to is None for c in got)


def test_translation_only_last_and_never_from_a_track_in_r():
    tracks = [("en", False, True), ("hi", True, True)]
    got = pick(tracks, "en")
    # Native R first; a translation (only reached if the native R tracks fail) is
    # last and never translates a track that is already in R.
    assert codes(got) == [("en", "manual"), ("hi", "auto"), ("hi", "translated", "en")]
    assert codes(pick([("en", False, True)], "en")) == [("en", "manual")]
    got = pick([("ta", False, True), ("hi", True, True)], "en")
    # order: auto in the spoken language (hi) before "any manual" (ta); the best is translated
    assert codes(got) == [("hi", "auto"), ("ta", "manual"), ("hi", "translated", "en")]
    assert got[-1] == Candidate("hi", True, translate_to="en")
    assert [c for c in got if c.translate_to] == [got[-1]]


def test_strict_keeps_only_r_and_translation():
    tracks = [("hi", True, True), ("en", False, True)]
    assert codes(pick(tracks, "hi", strict=True)) == [("hi", "auto"), ("en", "translated", "hi")]
    assert codes(pick([("ta", True, False)], "en", strict=True)) == []


def test_strict_with_native_r_still_offers_translation_last():
    tracks = [("en", False, True), ("hi", True, True)]
    got = codes(pick(tracks, "hi", strict=True))
    assert got[0] == ("hi", "auto") and got[-1] == ("en", "translated", "hi")


def test_auto_fallbacks_only_with_several_auto_tracks():
    one = pick([("ta", True, True), ("fr", False, False)])
    assert codes(one) == [("ta", "auto"), ("fr", "manual")]
    many = pick([("ta", True, True), ("en", True, True), ("fr", False, False)])
    assert codes(many)[:2] == [("ta", "auto"), ("en", "auto")]


def test_route_candidates_cap_natives_but_keep_translation():
    tracks = [(c, False, True) for c in ("fr", "de", "es", "it")] + [("ta", True, True)]
    cands = pick(tracks, "ja")
    picked = route_candidates(cands)
    assert len([c for c in picked if not c.translate_to]) == 3 and picked[-1].translate_to == "ja"


def test_spoken_language_and_tuples_or_tracks():
    assert spoken_language([Track("hi-IN", True)]) == "hi"
    assert pick([Track("en", False, True)]) == pick([("en", False, True)])
