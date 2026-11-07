"""
Tier-1 Brahm Varchas golden (evals/figma_bv): design_import's plan on the real
Figma inputs vs the published site fixture. The inputs are client files kept in
a private bucket, never in the repo — set FIGMA_BV_INPUTS to a directory holding
them; without it this test is skipped. The scorers themselves are tested below
on the committed fixture alone.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from evals.figma_bv import run as bv  # noqa: E402
from evals.figma_bv.scorers import expected_from_fixture, score_sections  # noqa: E402

AI_SERVICE = Path(__file__).resolve().parents[1]
SPEC = bv.load_spec()
FIXTURE = json.loads((AI_SERVICE.parent / SPEC["fixture"]).read_text(encoding="utf-8"))
PATTERNS = json.loads((AI_SERVICE / "app" / "data" / "catalogue_schema_catalog.json").read_text())["patterns"]


def test_expected_sections_come_from_the_registry_pointers_into_the_fixture():
    exp = expected_from_fixture(FIXTURE, PATTERNS, SPEC["fixture_ref"])
    assert set(exp["pages"]) == {"courses", "learning-paths"}
    courses = exp["pages"]["courses"]
    assert [s["component"] for s in courses] == ["courseCatalog", "ctaBanner"]
    assert "catalog.hero" in courses[0]["patterns"] and courses[1]["patterns"] == ["cta.band"]
    paths = exp["pages"]["learning-paths"]
    assert [s["component"] for s in paths] == [c["type"] for c in FIXTURE["pages"][2]["components"]]
    assert paths[-1]["patterns"] == ["cta.band"]          # an un-pointed second band, matched by its props
    assert {"header.editorial", "header.megaMenu", "footer.brand", "footer.newsletter"} == set(exp["chrome"])
    assert len(exp["palette"]) == 16 and exp["content_max_width"] == 1152


def test_section_scorer_counts_misses_and_extras():
    exp = expected_from_fixture(FIXTURE, PATTERNS, SPEC["fixture_ref"])
    plan = {"sections": [
        {"page_route": "courses", "component": "courseCatalog", "patterns": [{"id": "catalog.hero"}]},
        {"page_route": "courses", "component": "heroSection", "patterns": [{"id": "hero.editorial"}]},
    ]}
    card = score_sections(plan, exp)
    assert card["precision"] == 0.5 and 0 < card["recall"] < 0.2
    assert card["extra"] == ["courses#extra1:hero.editorial"] and card["missing_pages"] == ["learning-paths"]
    # A right pattern on the wrong section counts as a miss AND an extra.
    swapped = {"sections": [
        {"page_route": "courses", "component": "courseCatalog", "patterns": [{"id": "cta.band"}]},
        {"page_route": "courses", "component": "ctaBanner", "patterns": [{"id": "catalog.hero"}]},
    ]}
    card = score_sections(swapped, exp)
    assert card["true_positive"] == 0 and card["pages"]["courses"]["order"] == 1.0


@pytest.mark.skipif(bv.inputs_dir() is None, reason=f"set {bv.INPUTS_ENV} to the private Brahm Varchas Figma inputs")
def test_brahm_varchas_tier1_thresholds():
    card = bv.run(bv.inputs_dir())
    print(bv.summary_line(card))
    assert card["checks"] == {k: True for k in card["checks"]}, card["checks"]
    assert card["sections"]["recall"] >= 0.85 and card["sections"]["precision"] >= 0.85
    assert card["plan_seconds"] < 30
