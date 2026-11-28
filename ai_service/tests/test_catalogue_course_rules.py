"""
The Python port of the learner site's course-data rules must agree with the
TypeScript it mirrors. The cases below are the TS tests' own
(-utils/course-format.test.ts) plus the documented behaviour of
-utils/course-variants.ts and catalog-streams.ts; when a TS rule changes, change
both and these cases with them.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.catalogue_course_rules import (  # noqa: E402
    DEFAULT_COURSE_LANGUAGES,
    card_format_keys,
    course_format_keys,
    course_languages_of,
    folder_course_tag,
    folder_slug,
    folder_tag_set,
    language_of_level,
    language_of_row,
    language_of_tags,
    public_folder_tree,
    resolve_course_formats,
    row_tags,
    streams_from_folder_tree,
)

GS = {
    "courseFormats": {
        "elearning": {"label": "Interactive, self-paced E-learning"},
        "ebook": {"label": "E-books", "levels": ["eBook"], "tags": ["e-book"]},
        "live": {"label": "Live sessions"},
        "animation": {"label": "Short film / Animation", "levels": ["Short Film"]},
        "article": {"label": "Articles-essays", "levels": ["Article/Essay"]},
        "merch": {"label": "Merchandise (in collaboration)"},
        "bad": {"levels": ["x"]},
        "": {"label": "No key"},
    },
    "courseFormatOrder": ["ebook", "elearning"],
}


# ── course-format.ts ─────────────────────────────────────────────────────
def test_resolve_course_formats_is_none_without_settings():
    assert resolve_course_formats(None) is None
    assert resolve_course_formats({}) is None
    assert resolve_course_formats({"courseFormats": []}) is None
    assert resolve_course_formats({"courseFormats": {"a": {"label": " "}}}) is None


def test_resolve_course_formats_validates_lowercases_and_orders():
    f = resolve_course_formats(GS)
    assert [x["key"] for x in f["list"]] == ["ebook", "elearning", "live", "animation", "article", "merch"]
    assert f["by_key"]["ebook"] == {"key": "ebook", "label": "E-books", "levels": ["ebook"],
                                    "tags": ["format-ebook", "e-book"]}


def test_format_tag_first_then_listed_tag_then_level():
    f = resolve_course_formats(GS)
    assert course_format_keys({"comma_separeted_tags": "shiksha, Format-Live ,format-elearning", "level_name": "eBook"}, f) \
        == ["live", "elearning", "ebook"]
    assert course_format_keys({"comma_separeted_tags": "e-book"}, f) == ["ebook"]
    assert course_format_keys({"level_name": " short film "}, f) == ["animation"]


def test_unknown_format_tags_and_levels_are_ignored():
    f = resolve_course_formats(GS)
    assert course_format_keys({"comma_separeted_tags": "format-podcast", "level_name": "default"}, f) == []


def test_row_tags_read_comma_strings_and_lists():
    f = resolve_course_formats(GS)
    assert row_tags({"tags": "a, B", "comma_separeted_tags": None}) == ["a", "b"]
    assert row_tags({"tags": ["x", " Y "]}) == ["x", "y"]
    assert course_format_keys({"tags": "format-merch"}, f) == ["merch"]
    assert course_format_keys({"level": "eBook"}, f) == ["ebook"]


def test_no_settings_means_no_formats():
    assert course_format_keys({"comma_separeted_tags": "format-ebook", "level_name": "eBook"}, None) == []
    assert card_format_keys([{"level_name": "eBook"}], None) == []


def test_card_format_keys_union_in_first_seen_order():
    f = resolve_course_formats(GS)
    assert card_format_keys([{"level_name": "eBook"}, {"comma_separeted_tags": "format-live"}, {"level_name": "eBook"}], f) \
        == ["ebook", "live"]


# ── course-variants.ts ───────────────────────────────────────────────────
def test_languages_default_to_english_and_hindi():
    assert course_languages_of(None) == DEFAULT_COURSE_LANGUAGES
    assert course_languages_of({"languages": []}) == DEFAULT_COURSE_LANGUAGES
    custom = [{"code": "ta", "label": "Tamil"}]
    assert course_languages_of({"languages": custom}) == custom


def test_language_of_level_matches_whole_ascii_words_and_any_native_token():
    langs = DEFAULT_COURSE_LANGUAGES
    assert language_of_level("Beginner Hindi", langs)["code"] == "hi"
    assert language_of_level("hindi - batch 2", langs)["code"] == "hi"
    assert language_of_level("Engineering", langs) is None          # "eng" is not a word here
    assert language_of_level("ENG", langs)["code"] == "en"
    assert language_of_level("कक्षा हिंदी", langs)["code"] == "hi"
    assert language_of_level("", langs) is None
    assert language_of_level(None, langs) is None


def test_language_of_tags_needs_an_exact_tag():
    langs = DEFAULT_COURSE_LANGUAGES
    assert language_of_tags("hindi, bharat", langs)["code"] == "hi"
    assert language_of_tags("English literature", langs) is None
    assert language_of_tags("en", langs)["code"] == "en"          # the code counts
    assert language_of_tags(" , ", langs) is None
    assert language_of_tags(None, langs) is None


def test_language_of_row_prefers_the_level_then_the_tags():
    langs = DEFAULT_COURSE_LANGUAGES
    assert language_of_row({"level_name": "Hindi", "comma_separeted_tags": "english"}, langs)["code"] == "hi"
    assert language_of_row({"level_name": "eBook", "comma_separeted_tags": "english,shastra"}, langs)["code"] == "en"
    assert language_of_row({"level": "Hindi"}, langs)["code"] == "hi"
    assert language_of_row({"level_name": "default", "comma_separeted_tags": ""}, langs) is None


# ── folder libraries ─────────────────────────────────────────────────────
def test_folder_slug_and_tag():
    assert folder_slug({"slug": " shastra ", "title": "x"}) == "shastra"
    assert folder_slug({"subtitle": "Scriptures | Texts", "title": "शास्त्र"}) == "scriptures-texts"
    assert folder_slug({"title": "Café Crème"}) == "cafe-creme"
    assert folder_slug({"title": "शास्त्र", "id": "n1"}) == "n1"
    assert folder_course_tag({"slug": "shastra", "course_tag": " Gita "}) == "Gita"
    assert folder_course_tag({"slug": "shastra"}) == "shastra"


def _folder(id_, slug, children=(), **extra):
    return {"id": id_, "node_type": "FOLDER", "slug": slug, "children": list(children), **extra}


def test_streams_from_folder_tree_collects_tags_below_and_skips_duplicates():
    tree = [
        _folder("s1", "shastra", [_folder("c1", "gita", course_tag="Gita"), _folder("c2", "stotra"),
                                  {"id": "p1", "node_type": "PRODUCT_PAGE", "product_page_code": "abc"}]),
        _folder("s2", "shastra"),                                   # duplicate slug: dropped
        {"id": "p2", "node_type": "PRODUCT_PAGE"},                  # not a folder: not a stream
    ]
    streams = streams_from_folder_tree(tree)
    assert [s["slug"] for s in streams] == ["shastra"]
    assert streams[0]["tags"] == ["shastra", "gita", "stotra"]
    assert [c["slug"] for c in streams[0]["categories"]] == ["gita", "stotra"]
    assert folder_tag_set(tree[0]["children"][0]) == ["gita"]


def test_public_tree_drops_hidden_nodes_and_inactive_paths():
    tree = [
        _folder("s1", "a", [_folder("c1", "hidden", status="HIDDEN"),
                            {"id": "p1", "node_type": "PRODUCT_PAGE", "product_page_status": "DRAFT"},
                            {"id": "p2", "node_type": "PRODUCT_PAGE", "product_page_status": "ACTIVE"}]),
        _folder("s2", "b", status="HIDDEN"),
    ]
    public = public_folder_tree(tree)
    assert [n["id"] for n in public] == ["s1"]
    assert [n["id"] for n in public[0]["children"]] == ["p2"]
