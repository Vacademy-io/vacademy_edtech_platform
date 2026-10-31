"""The Library picker's taxonomy: a board or exam selection must resolve to
the corpus that actually answers it, and the annotated tree must count what
is loaded without hiding what is not.

The catalogue in prod (2026-09-21) is eight NCERT Class 10 books. A CBSE
teacher, a UP Board teacher and a UPSC aspirant should all find them; an ICSE
teacher should see Class 10 Physics offered but empty; CAT's DILR must never
turn into an unfiltered dump of the catalogue.
"""
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.services.kb import library, taxonomy
from app.services.kb.taxonomy import Group, resolve


# The published catalogue as published_counts() would return it.
COUNTS = [
    ("NCERT", "10", "Science", 1),
    ("NCERT", "10", "Mathematics", 1),
    ("NCERT", "10", "Social Science", 4),
    ("NCERT", "10", "English", 2),
    ("NCERT", "12", "Physics", 2),
    ("NCERT", "6", "Arts", 1),
]


# ── resolve ──────────────────────────────────────────────────────────────────

def test_ncert_itself_resolves_to_a_plain_board_filter():
    sel = resolve(board="NCERT", level="10", subject="Science")
    assert sel.groups == (Group("NCERT", ("10",)),)
    assert sel.subjects == ("Science",)
    assert not sel.impossible


def test_cbse_is_answered_by_ncert_for_every_class():
    sel = resolve(board="CBSE", level="4")
    assert sel.groups == (Group("CBSE", ("4",)), Group("NCERT", ("4",)))


def test_state_board_alias_respects_its_class_range():
    # UP Board adopted NCERT for 9–12 only; Class 7 stays the state's own books.
    assert Group("NCERT", ("10",)) in resolve(board="UP", level="10").groups
    assert resolve(board="UP", level="7").groups == (Group("UP", ("7",)),)


def test_board_without_class_keeps_alias_class_ranges():
    sel = resolve(board="UP")
    assert sel.groups == (Group("UP"), Group("NCERT", tuple(str(n) for n in range(9, 13))))


def test_board_name_and_key_are_both_accepted_case_insensitively():
    assert resolve(board="up board", level="10").groups == resolve(board="UP", level="10").groups
    assert resolve(board="icse / isc").groups[0] == Group("ICSE")


def test_icse_physics_is_answered_by_ncert_science():
    # CISCE has no textbooks of its own; ICSE 9–10 splits what NCERT calls
    # Science, so the picker's "Physics" must reach the Science book.
    sel = resolve(board="ICSE", level="10", subject="Physics")
    assert Group("NCERT", ("10",)) in sel.groups
    assert sel.subjects == ("Physics", "Science")
    # A subject with no split passes through unchanged.
    assert resolve(board="ICSE", level="10", subject="Mathematics").subjects == ("Mathematics",)


def test_unknown_board_passes_through_so_legacy_listings_stay_findable():
    assert resolve(board="Cambridge", level="9").groups == (Group("Cambridge", ("9",)),)


def test_no_board_no_level_means_no_constraint():
    sel = resolve()
    assert sel.groups is None and sel.subjects is None and not sel.impossible


def test_level_alone_is_an_ordinary_equality_filter():
    assert resolve(level="10").groups == (Group(None, ("10",)),)


def test_jee_resolves_to_its_own_listings_then_ncert_11_and_12():
    sel = resolve(exam="JEE_MAIN")
    assert sel.groups == (Group("JEE_MAIN"), Group("NCERT", ("11", "12")))
    assert sel.subjects == ("Physics", "Chemistry", "Mathematics")


def test_exam_subject_maps_to_listing_subjects_and_keeps_its_own_label():
    assert resolve(exam="UPSC", subject="Polity").subjects == ("Polity", "Political Science")
    assert resolve(exam="NDA", subject="Physics").subjects == ("Physics", "Science")


def test_exam_section_without_a_textbook_corpus_only_matches_its_own_listings():
    # CAT has no NCERT behind it: the only thing that can answer "Quantitative
    # Aptitude" is a syllabus or past-paper library loaded under board=CAT.
    sel = resolve(exam="CAT", subject="Quantitative Aptitude")
    assert sel.groups == (Group("CAT"),)
    assert sel.subjects == ("Quantitative Aptitude",)
    assert not sel.impossible


def test_exam_syllabus_library_is_counted_under_the_exam():
    counts = COUNTS + [("CAT", "UG", "Quantitative Aptitude", 1), ("JEE_MAIN", "UG", "Physics", 1)]
    tree = taxonomy.annotate(counts)
    cat = next(e for e in tree["exams"] if e["key"] == "CAT")
    assert _subject(cat, "Quantitative Aptitude")["libraries"] == 1
    assert cat["libraries"] == 1
    jee = next(e for e in tree["exams"] if e["key"] == "JEE_MAIN")
    assert _subject(jee, "Physics")["libraries"] == 2 + 1     # NCERT 12 Physics ×2 + syllabus
    # …and a board never sees an exam's listings.
    assert _board(tree, "CBSE")["libraries"] == 8 + 2 + 1


def test_unknown_exam_is_impossible():
    assert resolve(exam="GATE").impossible


# ── annotate ─────────────────────────────────────────────────────────────────

def _board(tree, key):
    return next(b for b in tree["boards"] if b["key"] == key)


def _cls(board, cls):
    return next(c for c in board["classes"] if c["class"] == cls)


def _subject(node, name):
    return next(s for s in node["subjects"] if s["name"] == name)


def test_tree_offers_every_class_and_the_standard_subjects_even_when_empty():
    tree = taxonomy.annotate([])
    icse = _board(tree, "ICSE")
    assert [c["class"] for c in icse["classes"]] == [str(n) for n in range(1, 13)]
    assert "Physics" in [s["name"] for s in _cls(icse, "9")["subjects"]]
    assert icse["libraries"] == 0
    assert all(s["libraries"] == 0 for s in _cls(icse, "9")["subjects"])


def test_icse_counts_ncert_science_under_its_split_subjects():
    tree = taxonomy.annotate(COUNTS)
    ten = _cls(_board(tree, "ICSE"), "10")
    assert _subject(ten, "Physics")["libraries"] == 1      # NCERT 10 Science
    assert _subject(ten, "Chemistry")["libraries"] == 1    # the same book
    assert _subject(ten, "History & Civics")["libraries"] == 4
    assert ten["libraries"] == 8                           # distinct books, not per-subject sum
    # NCERT "Science" / "Social Science" are reached through the split
    # subjects; they must not ALSO appear as subjects of their own.
    offered = [s["name"] for s in ten["subjects"]]
    assert "Science" not in offered and "Social Science" not in offered


def test_cbse_counts_the_ncert_books():
    tree = taxonomy.annotate(COUNTS)
    cbse = _board(tree, "CBSE")
    assert _subject(_cls(cbse, "10"), "Science")["libraries"] == 1
    assert _subject(_cls(cbse, "10"), "Social Science")["libraries"] == 4
    assert _cls(cbse, "10")["libraries"] == 8
    assert cbse["libraries"] == 8 + 2 + 1
    assert cbse["sources"] == [{"board": "NCERT", "classes": None}]


def test_state_board_counts_only_inside_its_alias_range():
    tree = taxonomy.annotate(COUNTS)
    up = _board(tree, "UP")           # NCERT for 9–12
    assert _cls(up, "10")["libraries"] == 8
    assert _cls(up, "6")["libraries"] == 0
    assert up["libraries"] == 10
    mp = _board(tree, "MP")           # NCERT for 6–12
    assert _cls(mp, "6")["libraries"] == 1


def test_loaded_subject_outside_the_standard_scheme_is_still_offered():
    tree = taxonomy.annotate(COUNTS)
    six = _cls(_board(tree, "NCERT"), "6")
    assert _subject(six, "Arts")["libraries"] == 1
    # …and the standard ones come first.
    assert six["subjects"][0]["name"] == "English"


def test_regional_language_subject_is_offered_by_that_state_board_only():
    tree = taxonomy.annotate([])
    assert "Tamil" in [s["name"] for s in _cls(_board(tree, "TN"), "8")["subjects"]]
    assert "Tamil" not in [s["name"] for s in _cls(_board(tree, "NCERT"), "8")["subjects"]]


def test_exam_counts_follow_its_sources_and_subject_map():
    tree = taxonomy.annotate(COUNTS)
    jee = next(e for e in tree["exams"] if e["key"] == "JEE_MAIN")
    assert _subject(jee, "Physics")["libraries"] == 2       # NCERT 12 Physics
    assert _subject(jee, "Mathematics")["libraries"] == 0   # Class 10 Maths is not 11–12
    upsc = next(e for e in tree["exams"] if e["key"] == "UPSC")
    assert _subject(upsc, "Science & Technology")["libraries"] == 1 + 2  # Class 10 Science + 12 Physics
    assert _subject(upsc, "Current Affairs")["libraries"] == 0
    cat = next(e for e in tree["exams"] if e["key"] == "CAT")
    assert cat["libraries"] == 0 and cat["sources"] == []


def test_exam_total_counts_each_book_once():
    tree = taxonomy.annotate(COUNTS)
    nda = next(e for e in tree["exams"] if e["key"] == "NDA")
    # Class 10 Science serves Physics AND Chemistry; Social Science serves
    # History AND Geography. Sections say so; the total does not double up.
    assert _subject(nda, "Physics")["libraries"] == 1 + 2   # 10 Science + 12 Physics
    assert _subject(nda, "Chemistry")["libraries"] == 1     # 10 Science again
    assert sum(s["libraries"] for s in nda["subjects"]) > nda["libraries"]
    assert nda["libraries"] == 2 + 1 + 1 + 4 + 2  # English, Maths, Science, Social Science, 12 Physics


def test_tree_lists_mediums():
    assert taxonomy.annotate([])["mediums"] == ["English", "Hindi", "Urdu"]


# ── the SQL the catalogue builds ─────────────────────────────────────────────

def _compile(sel):
    params = {}
    where, expanding = library._selection_sql(sel, params)
    stmt = text("SELECT 1 WHERE " + " AND ".join(where)).bindparams(*expanding)
    compiled = stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False})
    return str(compiled), params


def test_alias_groups_become_or_ed_board_and_level_clauses():
    sql, params = _compile(resolve(board="CBSE", level="10", subject="Science"))
    assert "(l.board = %(g0_board)s AND l.level IN (__[POSTCOMPILE_g0_levels]))" in sql
    assert " OR (l.board = %(g1_board)s AND l.level IN (__[POSTCOMPILE_g1_levels]))" in sql
    assert "l.subject IN (__[POSTCOMPILE_subjects])" in sql
    assert params["g0_board"] == "CBSE" and params["g1_board"] == "NCERT"
    assert params["g0_levels"] == ["10"] and params["subjects"] == ["Science"]


def test_impossible_selection_compiles_to_false():
    sql, params = _compile(resolve(exam="GATE"))
    assert sql.endswith("WHERE FALSE") and params == {}


def test_board_less_level_has_no_board_clause():
    sql, params = _compile(resolve(level="10"))
    assert "l.board" not in sql and "l.level IN" in sql and params["g0_levels"] == ["10"]


def test_no_selection_adds_nothing():
    params = {}
    where, expanding = library._selection_sql(resolve(), params)
    assert where == [] and expanding == [] and params == {}
