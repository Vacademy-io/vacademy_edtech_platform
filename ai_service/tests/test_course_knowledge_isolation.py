"""Course chunks stay behind course_knowledge/store.py (offline, whole tree).

  * The scoped vector column `embedding_768_scoped` may be named only in
    store.py, schema_check.py and kb/repository.py (its exclusion clauses).
  * The course KB purpose 'course_content' may appear as a string literal only
    in those same files. The name is also an unrelated RequestType value and a
    module (services/course_content.py), so this check reads Python string
    tokens (docstrings and comments excluded) and allows that one enum value.
  * store.py never reads slide, chapter or enrolment tables: callers pass slide
    ids, so the kb tables can move to their own Postgres later.
"""
from __future__ import annotations

import io
import re
import tokenize
from pathlib import Path
from typing import Iterator, List, Tuple

APP = Path(__file__).resolve().parents[1] / "app"
STORE = APP / "services" / "course_knowledge" / "store.py"

ALLOWED = {
    Path("services/course_knowledge/store.py"),
    Path("services/course_knowledge/schema_check.py"),
    Path("services/kb/repository.py"),
}

# Same text, different meaning: the ai_token_usage request type for course
# content generation (pre-dates course knowledge).
UNRELATED_LITERALS = {
    (Path("models/ai_token_usage.py"), '"course_content"'),
}

SCOPED_COLUMN = "embedding_768_scoped"
PURPOSE_RE = re.compile(r"\bcourse_content\b")


def _app_files() -> List[Path]:
    return sorted(p for p in APP.rglob("*.py") if "__pycache__" not in p.parts)


def _string_tokens(source: str) -> Iterator[Tuple[int, str]]:
    """(line, text) of every string literal that is not a docstring.

    A docstring is a STRING token that starts a logical line and is followed by
    the end of that line (an expression statement made only of a string)."""
    tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    skip = {tokenize.NL, tokenize.COMMENT, tokenize.INDENT, tokenize.DEDENT}
    fstring_middle = getattr(tokenize, "FSTRING_MIDDLE", None)  # Python 3.12+ f-string parts
    for i, tok in enumerate(tokens):
        if fstring_middle is not None and tok.type == fstring_middle:
            yield tok.start[0], tok.string
            continue
        if tok.type != tokenize.STRING:
            continue
        prev = next((t for t in reversed(tokens[:i]) if t.type not in skip), None)
        nxt = next((t for t in tokens[i + 1:] if t.type not in skip), None)
        starts_line = prev is None or prev.type == tokenize.NEWLINE or (
            prev.type == tokenize.OP and prev.string == ":")
        ends_line = nxt is None or nxt.type in (tokenize.NEWLINE, tokenize.ENDMARKER)
        if starts_line and ends_line:
            continue
        yield tok.start[0], tok.string


def test_app_tree_is_scanned():
    files = _app_files()
    assert STORE in files
    assert len(files) > 100


def test_scoped_column_named_only_in_allowed_files():
    offenders = []
    for path in _app_files():
        rel = path.relative_to(APP)
        if rel in ALLOWED:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if SCOPED_COLUMN in line:
                offenders.append(f"{rel}:{n}: {line.strip()}")
    assert not offenders, (
        "only course_knowledge/store.py may read or write course chunks:\n" + "\n".join(offenders)
    )


def test_course_content_purpose_literal_only_in_allowed_files():
    offenders = []
    for path in _app_files():
        rel = path.relative_to(APP)
        if rel in ALLOWED:
            continue
        for n, literal in _string_tokens(path.read_text(encoding="utf-8")):
            if PURPOSE_RE.search(literal) and (rel, literal) not in UNRELATED_LITERALS:
                offenders.append(f"{rel}:{n}: {literal}")
    assert not offenders, (
        "the course_content KB is reached only through course_knowledge/store.py:\n"
        + "\n".join(offenders)
    )


def test_string_scanner_skips_docstrings_and_comments():
    src = (
        '"""Module docstring with course_content."""\n'
        "# a comment about course_content\n"
        "def f():\n"
        '    """course_content in a docstring."""\n'
        "    return \"WHERE purpose = 'course_content'\"\n"
        "X = 'course_content'\n"
    )
    found = [lit for _n, lit in _string_tokens(src) if PURPOSE_RE.search(lit)]
    assert found == ["\"WHERE purpose = 'course_content'\"", "'course_content'"]


def test_store_never_reads_course_or_enrolment_tables():
    source = STORE.read_text(encoding="utf-8")
    for banned in ("chapter_to_slides", "student_session_institute_group_mapping"):
        assert banned not in source, banned
    assert not re.search(r"\b(FROM|JOIN)\s+slide\b", source, re.IGNORECASE)


def test_store_is_the_one_that_uses_the_scoped_column():
    source = STORE.read_text(encoding="utf-8")
    assert SCOPED_COLUMN in source
    assert "'course_content'" in source
    # Course chunks never get a legacy vector.
    assert re.search(r"embedding_768,\s*embedding_768_scoped", source)
    assert "NULL, CAST(:embedding AS vector)" in source
    # exact_scan carries no chunk text.
    scan = source.split("_EXACT_SCAN_SQL = text(", 1)[1].split('"""\n)', 1)[0]
    assert "content_text" not in scan
