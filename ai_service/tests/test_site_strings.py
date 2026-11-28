"""
The Python port of the builder's site-strings collector (``website(action='strings')``)
must answer exactly what the dashboard's Translations panel does.

Both sides are pinned to one golden file in the admin fixtures: the admin's
``site-strings-sync.test.ts`` checks the TypeScript collector against it, and
this test checks the port. A change to either side without the other fails one
of the two.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import site_strings  # noqa: E402

_FIXTURES = Path(__file__).resolve().parents[2] / "frontend-admin-dashboard/src/routes/manage-pages/-components/__fixtures__"
_GOLDEN = _FIXTURES / "site-strings-golden.json"
_BV = _FIXTURES / "brahm-varchas-site.json"

pytestmark = pytest.mark.skipif(not _GOLDEN.exists(), reason="admin fixtures not checked out next to ai_service")


def _golden():
    return json.loads(_GOLDEN.read_text(encoding="utf-8"))


def _bv():
    return json.loads(_BV.read_text(encoding="utf-8"))


def test_synthetic_site_matches_the_typescript_collector():
    g = _golden()
    config = g["synthetic"]["config"]
    assert site_strings.collect_site_strings(config) == g["expected"]["synthetic"]["visible"]
    assert site_strings.collect_site_strings(config, include_hidden=True) == g["expected"]["synthetic"]["includeHidden"]


def test_brahm_varchas_site_matches_the_typescript_collector():
    g = _golden()
    bv = _bv()
    assert site_strings.collect_site_strings(bv) == g["expected"]["brahmVarchas"]["visible"]
    assert site_strings.collect_site_strings(bv, include_hidden=True) == g["expected"]["brahmVarchas"]["includeHidden"]


def test_key_classifier_matches_the_typescript_one():
    g = _golden()
    for case, want in zip(g["classifier"], g["expected"]["classifier"]):
        key = case["key"]
        got = {
            "textKey": site_strings.is_text_key(key),
            "dataLike": site_strings.looks_like_data(case["text"]),
            "translatable": site_strings.is_translatable(case["text"], key),
        }
        assert got == want, case


def test_live_brahm_varchas_hindi_dictionary_covers_its_own_texts():
    bv = _bv()
    sources = site_strings.collect_site_strings(bv)
    hi = bv["globalSettings"]["i18n"]["strings"]["hi"]
    missing = site_strings.missing_translations(sources, hi)
    # The dictionary also carries live data (folder titles, course names) that is not in the page JSON.
    assert len(sources) > 100
    assert missing == [s for s in sources if not hi.get(s)]
    assert site_strings.missing_translations(sources, {}) == sources


def test_entries_say_where_a_text_is_first_shown():
    entries = site_strings.collect_site_string_entries(_golden()["synthetic"]["config"])
    by_text = {e["text"]: e["location"] for e in entries}
    assert by_text["Smart Academy"]["area"] == "header"
    assert by_text["Load more"]["field"].startswith("render › pagination")
    assert by_text["Join today"]["section"] == "ctaBanner #1"
    assert site_strings.describe_location(by_text["Learners"]).startswith("page “Home” › heroSection › statChips #1")
    assert site_strings.describe_location(by_text["E-books"]) == "site settings › courseFormats › ebook"
