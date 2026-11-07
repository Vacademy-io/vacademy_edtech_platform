"""Sound palette: no horror stabs, and real variety per role.

Video feadce4b (2026-10-27, a parenting lesson) played a "HORROR ... CATHEDRAL,
ORGAN, STAB, DISSONANT" file on every reveal: the whole Musical category
counted as ui_chime, and the keyword fallback (substring scoring, no dedupe)
collapsed a role's 4-file palette to one or two files.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

AI_SERVICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AI_SERVICE / "app" / "ai-video-gen-main"))

import sound_catalog as sc  # noqa: E402
import sound_planner as sp  # noqa: E402

ORGAN = "CathedralOrgan_S011HO.48.mp3"
SCRIPT = (
    "A child cries at the door and pushes the shoes away. Is this a meltdown or a message? "
    "Look beyond behaviour: see the whole child, look beneath the visible, respect the "
    "developmental journey and respond with intention."
)


@pytest.fixture(scope="module")
def catalog():
    cat = sc.SoundCatalog(json.loads((AI_SERVICE / "sounds_metadata.json").read_text()))
    cat._embeddings = None  # the keyword fallback — what runs without an embedding key
    return cat


def _files(cat, role):
    return [cat.sounds[i].get("file_name") or "" for i in cat._by_role[role]]


def test_horror_files_are_in_no_role(catalog):
    for role in sc.ROLE_RULES:
        assert ORGAN not in _files(catalog, role), role
        for i in catalog._by_role[role]:
            assert not (sc._words(catalog.sounds[i].get("description", "")) & sc.EXCLUDE_KEYWORDS)


def test_ui_chime_no_longer_takes_the_whole_musical_category():
    assert "Musical" not in sc.ROLE_RULES["ui_chime"]["categories"]
    cat = sc.SoundCatalog([
        {"file_id": "1", "category": "Musical", "description": "Musical - STING, BRASS, ACCENT",
         "duration_seconds": 1.0, "public_url": "u1"},
        {"file_id": "2", "category": "Musical", "description": "Musical - CHIME, BRIGHT",
         "duration_seconds": 1.0, "public_url": "u2"},
    ])
    assert [cat.sounds[i]["file_id"] for i in cat._by_role["ui_chime"]] == ["2"]


def test_topic_terms_drop_short_and_stop_words():
    assert sc.topic_terms(["a", "the", "Context:", "is", "child,", "Behaviour", "with", "child"]) == [
        "child", "behaviour"]


@pytest.mark.parametrize("role", ["ui_chime", "ui_positive", "impact", "ui_click", "data_reveal"])
def test_palette_has_four_distinct_files_per_role(catalog, role):
    palette = sp._build_sound_palette(catalog, "feadce4b", SCRIPT)
    urls = [v["url"] for v in palette[role]]
    assert len(urls) == 4 and len(set(urls)) == 4


def test_exclude_urls_is_honoured_and_never_repeats(catalog):
    first = catalog.resolve_for_topic("ui_chime", SCRIPT.split(), seed_key="s")
    again = catalog.resolve_for_topic("ui_chime", SCRIPT.split(), seed_key="s", exclude_urls={first["url"]})
    assert again and again["url"] != first["url"]
    every = {catalog.sounds[i]["public_url"] for i in catalog._by_role["ui_click"]}
    assert catalog.resolve("ui_click", seed_key="s", exclude_urls=every) is None
