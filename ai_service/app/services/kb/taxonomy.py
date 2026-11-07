"""The curriculum taxonomy behind the Library picker.

Boards, competitive exams, classes and subjects an Indian teacher expects to
choose from — offered whether or not a textbook has been loaded yet, so the
picker reads like a syllabus rather than like a database — and the aliases
that let one corpus answer for many selections:

  * CBSE and most Hindi-belt state boards prescribe NCERT textbooks, so
    "CBSE → Class 10 → Science" is the NCERT Class 10 Science book.
  * JEE, NEET and CUET are built on NCERT Class 11–12; UPSC prelims on NCERT
    Class 6–12. An exam has subjects (or sections) but no class.

Everything in this module is data. `resolve` turns a picker selection into
listing filters for the catalogue query; `annotate` attaches published-library
counts to the tree for `/library/taxonomy`, so the UI can show what exists and
what is still to come. Names of boards and subjects here must match the
`board` / `level` / `subject` columns the curriculum loader writes to
`knowledge_base_listing` (NCERT, "10", "Science", …).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

MEDIUMS: Tuple[str, ...] = ("English", "Hindi", "Urdu")

ALL_CLASSES: Tuple[str, ...] = tuple(str(n) for n in range(1, 13))


def _classes(lo: int, hi: int) -> Tuple[str, ...]:
    return tuple(str(n) for n in range(lo, hi + 1))


# ---------------------------------------------------------------------------
# Subjects offered per class, NCERT-style. Boards override where their scheme
# differs (ICSE splits Science; Maharashtra names things its own way).
# ---------------------------------------------------------------------------

_PRIMARY = ("English", "Hindi", "Mathematics")
_UPPER_PRIMARY = ("English", "Hindi", "Mathematics", "Environmental Studies")
_MIDDLE = ("English", "Hindi", "Mathematics", "Science", "Social Science", "Sanskrit")
_SECONDARY = ("English", "Hindi", "Mathematics", "Science", "Social Science", "Sanskrit")
_SENIOR = (
    "Physics", "Chemistry", "Mathematics", "Biology", "English", "Hindi",
    "Accountancy", "Business Studies", "Economics", "History", "Geography",
    "Political Science", "Sociology", "Psychology", "Computer Science",
    "Informatics Practices", "Physical Education",
)


def standard_subjects(cls: str) -> Tuple[str, ...]:
    n = int(cls) if cls.isdigit() else 0
    if 1 <= n <= 2:
        return _PRIMARY
    if 3 <= n <= 5:
        return _UPPER_PRIMARY
    if 6 <= n <= 8:
        return _MIDDLE
    if 9 <= n <= 10:
        return _SECONDARY
    if 11 <= n <= 12:
        return _SENIOR
    return ()


_ICSE_MIDDLE = (
    "English", "Hindi", "Mathematics", "Physics", "Chemistry", "Biology",
    "History & Civics", "Geography", "Computer Studies",
)
_ICSE_SECONDARY = (
    "English", "Hindi", "Mathematics", "Physics", "Chemistry", "Biology",
    "History & Civics", "Geography", "Economics", "Commercial Studies",
    "Computer Applications",
)
_MAHARASHTRA_SECONDARY = (
    "English", "Marathi", "Hindi", "Mathematics", "Science and Technology",
    "History and Political Science", "Geography",
)


# ---------------------------------------------------------------------------
# Boards
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Source:
    """One corpus a selection can be answered from: listing.board, restricted
    to the classes for which that board actually prescribes those books."""
    board: str
    classes: Optional[Tuple[str, ...]] = None  # None = every class

    def covers(self, cls: Optional[str]) -> bool:
        return cls is None or self.classes is None or cls in self.classes


@dataclass(frozen=True)
class Board:
    key: str
    name: str
    full_name: str
    kind: str  # NATIONAL | STATE
    classes: Tuple[str, ...] = ALL_CLASSES
    # Where the books come from. A board is always a source for itself, so a
    # textbook loaded under "CBSE" is found even though CBSE also aliases NCERT.
    aliases: Tuple[Source, ...] = ()
    # Board-specific subject schemes, by class; standard_subjects otherwise.
    subject_overrides: Dict[str, Tuple[str, ...]] = field(default_factory=dict)
    # Picker subject → listing subjects it is also answered by, for boards
    # whose scheme splits or merges what the source corpus calls a subject
    # (ICSE "Physics" lives inside NCERT "Science").
    subject_aliases: Dict[str, Tuple[str, ...]] = field(default_factory=dict)
    # Regional-language subjects added to every class.
    extra_subjects: Tuple[str, ...] = ()
    # How the UI should describe the alias: PRESCRIBES (CBSE, UP Board really
    # do set NCERT books) or OVERLAPS (ICSE: nearest free corpus, not its book).
    alias_kind: str = "PRESCRIBES"

    def sources_for(self, cls: Optional[str]) -> List[str]:
        out = [self.key]
        for src in self.aliases:
            if src.covers(cls) and src.board not in out:
                out.append(src.board)
        return out

    def subjects_for(self, cls: str) -> Tuple[str, ...]:
        base = self.subject_overrides.get(cls) or standard_subjects(cls)
        return tuple(dict.fromkeys((*base, *self.extra_subjects)))

    def listing_subjects(self, subject: str) -> Tuple[str, ...]:
        """The subject itself plus whatever the source corpus files it under."""
        return tuple(dict.fromkeys((subject, *self.subject_aliases.get(subject, ()))))


_NCERT_ALL = (Source("NCERT"),)
# State boards that adopted NCERT for the board classes only; lower classes
# use the state SCERT's own books, which are not loaded.
_NCERT_9_12 = (Source("NCERT", _classes(9, 12)),)
_NCERT_6_12 = (Source("NCERT", _classes(6, 12)),)

BOARDS: Tuple[Board, ...] = (
    Board("NCERT", "NCERT", "National Council of Educational Research and Training", "NATIONAL"),
    Board("CBSE", "CBSE", "Central Board of Secondary Education", "NATIONAL",
          aliases=_NCERT_ALL),
    # CISCE publishes no textbooks (schools buy Selina, Frank, S. Chand…), so
    # the closest free corpus is NCERT: ISC 11–12 tracks CBSE almost topic for
    # topic, and ICSE 6–10 Physics/Chemistry/Biology sit inside NCERT Science.
    # The alias is labelled as an overlap in the UI, never as "the ICSE book".
    Board("ICSE", "ICSE / ISC", "Council for the Indian School Certificate Examinations", "NATIONAL",
          aliases=_NCERT_6_12, alias_kind="OVERLAPS",
          subject_overrides={
              **{c: _ICSE_MIDDLE for c in _classes(6, 8)},
              **{c: _ICSE_SECONDARY for c in _classes(9, 10)},
          },
          subject_aliases={
              "Physics": ("Science",), "Chemistry": ("Science",), "Biology": ("Science",),
              "History & Civics": ("Social Science",), "Geography": ("Social Science", "Geography"),
              "Economics": ("Social Science", "Economics"),
          }),
    # -- State boards, alphabetical by state ---------------------------------
    Board("AP", "Andhra Pradesh Board", "Board of Secondary / Intermediate Education, Andhra Pradesh", "STATE",
          extra_subjects=("Telugu",)),
    Board("ASSAM", "Assam Board", "SEBA / AHSEC, Assam", "STATE", extra_subjects=("Assamese",)),
    Board("BIHAR", "Bihar Board", "Bihar School Examination Board", "STATE", aliases=_NCERT_9_12),
    Board("CG", "Chhattisgarh Board", "Chhattisgarh Board of Secondary Education", "STATE", aliases=_NCERT_6_12),
    Board("GOA", "Goa Board", "Goa Board of Secondary and Higher Secondary Education", "STATE",
          aliases=(Source("NCERT", _classes(11, 12)),), extra_subjects=("Konkani",)),
    Board("GUJARAT", "Gujarat Board", "Gujarat Secondary and Higher Secondary Education Board", "STATE",
          aliases=_NCERT_9_12, extra_subjects=("Gujarati",)),
    Board("HARYANA", "Haryana Board", "Board of School Education Haryana", "STATE", aliases=_NCERT_6_12),
    Board("HP", "Himachal Pradesh Board", "Himachal Pradesh Board of School Education", "STATE", aliases=_NCERT_6_12),
    Board("JK", "J&K Board", "Jammu and Kashmir Board of School Education", "STATE", aliases=_NCERT_6_12),
    Board("JHARKHAND", "Jharkhand Board", "Jharkhand Academic Council", "STATE", aliases=_NCERT_6_12),
    Board("KARNATAKA", "Karnataka Board", "Karnataka School Examination and Assessment Board", "STATE",
          extra_subjects=("Kannada",)),
    Board("KERALA", "Kerala Board", "Kerala Board of Public Examinations / SCERT Kerala", "STATE",
          extra_subjects=("Malayalam",)),
    Board("MP", "MP Board", "Madhya Pradesh Board of Secondary Education", "STATE", aliases=_NCERT_6_12),
    Board("MAHARASHTRA", "Maharashtra Board", "Maharashtra State Board of Secondary and Higher Secondary Education", "STATE",
          subject_overrides={c: _MAHARASHTRA_SECONDARY for c in _classes(9, 10)},
          extra_subjects=("Marathi",)),
    Board("ODISHA", "Odisha Board", "Board of Secondary Education, Odisha / CHSE", "STATE", extra_subjects=("Odia",)),
    Board("PUNJAB", "Punjab Board", "Punjab School Education Board", "STATE", extra_subjects=("Punjabi",)),
    Board("RAJASTHAN", "Rajasthan Board", "Board of Secondary Education, Rajasthan", "STATE", aliases=_NCERT_6_12),
    Board("TN", "Tamil Nadu Board", "Tamil Nadu State Board of School Examination", "STATE", extra_subjects=("Tamil",)),
    Board("TELANGANA", "Telangana Board", "Board of Secondary / Intermediate Education, Telangana", "STATE",
          extra_subjects=("Telugu",)),
    Board("TRIPURA", "Tripura Board", "Tripura Board of Secondary Education", "STATE", aliases=_NCERT_9_12,
          extra_subjects=("Bengali",)),
    Board("UP", "UP Board", "Uttar Pradesh Madhyamik Shiksha Parishad", "STATE", aliases=_NCERT_9_12),
    Board("UTTARAKHAND", "Uttarakhand Board", "Uttarakhand Board of School Education", "STATE", aliases=_NCERT_6_12),
    Board("WB", "West Bengal Board", "West Bengal Board of Secondary Education / WBCHSE", "STATE",
          extra_subjects=("Bengali",)),
)


# ---------------------------------------------------------------------------
# Competitive exams
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Exam:
    key: str
    name: str
    full_name: str
    # Picker label → listing subjects it is built on. An empty tuple means the
    # section has no textbook corpus (CAT's DILR, CLAT's legal reasoning).
    subjects: Dict[str, Tuple[str, ...]]
    sources: Tuple[Source, ...] = ()

    def listing_subjects(self, subject: Optional[str]) -> Tuple[str, ...]:
        """Listing subjects behind one exam subject, or behind all of them.

        The label itself is always included: a syllabus or past-paper library
        loaded under the exam's own key is filed under the picker label
        ("Quantitative Aptitude"), and that is how CAT can have books at all."""
        if subject is not None:
            return tuple(dict.fromkeys((subject, *self.subjects.get(subject, ()))))
        return tuple(dict.fromkeys(
            s for label, group in self.subjects.items() for s in (label, *group)
        ))

    def source_groups(self) -> Tuple["Group", ...]:
        """The exam's own listings (board = exam key, any level) first, then
        the textbook corpora it is built on."""
        return (Group(self.key),) + tuple(Group(src.board, src.classes) for src in self.sources)


def _same(*names: str) -> Dict[str, Tuple[str, ...]]:
    return {n: (n,) for n in names}


_SENIOR_SRC = (Source("NCERT", _classes(11, 12)),)

EXAMS: Tuple[Exam, ...] = (
    Exam("CUET", "CUET (UG)", "Common University Entrance Test",
         subjects={
             **_same("English", "Hindi", "Physics", "Chemistry", "Biology", "Mathematics",
                     "Accountancy", "Business Studies", "Economics", "History", "Geography",
                     "Political Science", "Sociology", "Psychology", "Computer Science"),
             "General Test": (),
         },
         sources=(Source("NCERT", ("12",)),)),
    Exam("JEE_MAIN", "JEE Main", "Joint Entrance Examination (Main)",
         subjects=_same("Physics", "Chemistry", "Mathematics"), sources=_SENIOR_SRC),
    Exam("JEE_ADVANCED", "JEE Advanced", "Joint Entrance Examination (Advanced)",
         subjects=_same("Physics", "Chemistry", "Mathematics"), sources=_SENIOR_SRC),
    Exam("NEET", "NEET (UG)", "National Eligibility cum Entrance Test",
         subjects=_same("Physics", "Chemistry", "Biology"), sources=_SENIOR_SRC),
    Exam("CAT", "CAT", "Common Admission Test",
         subjects={"Quantitative Aptitude": (), "Verbal Ability & Reading Comprehension": (),
                   "Data Interpretation & Logical Reasoning": ()}),
    Exam("UPSC", "UPSC CSE", "Civil Services Examination (Prelims)",
         subjects={"History": ("History",), "Geography": ("Geography",),
                   "Polity": ("Political Science",), "Economy": ("Economics",),
                   "Science & Technology": ("Science", "Physics", "Chemistry", "Biology"),
                   "Society": ("Sociology",), "Current Affairs": ()},
         sources=(Source("NCERT", _classes(6, 12)),)),
    Exam("CLAT", "CLAT", "Common Law Admission Test",
         subjects={"English": (), "Current Affairs & GK": (), "Legal Reasoning": (),
                   "Logical Reasoning": (), "Quantitative Techniques": ()}),
    Exam("NDA", "NDA", "National Defence Academy Examination",
         subjects={"Mathematics": ("Mathematics",), "English": ("English",),
                   "Physics": ("Physics", "Science"), "Chemistry": ("Chemistry", "Science"),
                   "History": ("History", "Social Science"), "Geography": ("Geography", "Social Science")},
         sources=(Source("NCERT", _classes(9, 12)),)),
    Exam("SSC", "SSC (CGL / CHSL)", "Staff Selection Commission",
         subjects={"Quantitative Aptitude": (), "Reasoning": (), "English": (),
                   "General Awareness": ()}),
)


_BOARD_INDEX: Dict[str, Board] = {}
for _b in BOARDS:
    _BOARD_INDEX[_b.key.upper()] = _b
    _BOARD_INDEX[_b.name.upper()] = _b
_EXAM_INDEX: Dict[str, Exam] = {}
for _e in EXAMS:
    _EXAM_INDEX[_e.key.upper()] = _e
    _EXAM_INDEX[_e.name.upper()] = _e


def find_board(value: Optional[str]) -> Optional[Board]:
    return _BOARD_INDEX.get((value or "").strip().upper()) if value else None


def find_exam(value: Optional[str]) -> Optional[Exam]:
    return _EXAM_INDEX.get((value or "").strip().upper()) if value else None


# ---------------------------------------------------------------------------
# Resolving a selection into listing filters
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Group:
    """`l.board = board [AND l.level IN levels]`; board None = any board."""
    board: Optional[str]
    levels: Optional[Tuple[str, ...]] = None


@dataclass(frozen=True)
class Selection:
    groups: Optional[Tuple[Group, ...]]   # OR-ed; None = no board constraint
    subjects: Optional[Tuple[str, ...]]   # None = no subject constraint
    # True when a filter resolved to nothing that can exist (CAT → DILR): the
    # catalogue must answer empty rather than drop the constraint.
    impossible: bool = False


def resolve(
    *,
    board: Optional[str] = None,
    exam: Optional[str] = None,
    level: Optional[str] = None,
    subject: Optional[str] = None,
) -> Selection:
    """Turn what the picker sent into what the catalogue query needs.

    A board known to the taxonomy expands to itself plus every alias that
    covers the chosen class; an unknown board (older listings with free-text
    boards) passes through untouched so nothing that used to be findable
    disappears.
    """
    if exam:
        ex = find_exam(exam)
        if not ex:
            return Selection(groups=(), subjects=None, impossible=True)
        return Selection(groups=ex.source_groups(), subjects=ex.listing_subjects(subject))

    subjects = (subject,) if subject else None
    if not board:
        # No board: a class alone is still an ordinary equality filter.
        return Selection(groups=(Group(None, (level,)),) if level else None, subjects=subjects)

    b = find_board(board)
    if not b:
        return Selection(groups=(Group(board, (level,) if level else None),), subjects=subjects)

    if subject:
        subjects = b.listing_subjects(subject)
    if level:
        groups = tuple(Group(src, (level,)) for src in b.sources_for(level))
    else:
        groups = (Group(b.key),) + tuple(Group(src.board, src.classes) for src in b.aliases)
    return Selection(groups=groups, subjects=subjects)


# ---------------------------------------------------------------------------
# The tree with counts, for /library/taxonomy
# ---------------------------------------------------------------------------

Count = Tuple[str, str, str, int]  # (board, level, subject, published libraries)


def _count(counts: Sequence[Count], boards: Iterable[str], levels: Optional[Iterable[str]],
           subjects: Optional[Iterable[str]]) -> int:
    board_set = set(boards)
    level_set = set(levels) if levels is not None else None
    subject_set = set(subjects) if subjects is not None else None
    return sum(
        n for (bd, lv, sj, n) in counts
        if bd in board_set
        and (level_set is None or lv in level_set)
        and (subject_set is None or sj in subject_set)
    )


def _loaded_subjects(counts: Sequence[Count], boards: Iterable[str], level: str) -> List[str]:
    board_set = set(boards)
    return list(dict.fromkeys(sj for (bd, lv, sj, n) in counts if bd in board_set and lv == level and n))


def annotate(counts: Sequence[Count]) -> Dict[str, Any]:
    """The full picker tree, each node carrying how many published libraries
    answer it. `counts` is the published catalogue grouped by
    (board, level, subject) — see library.published_counts."""
    boards_out: List[Dict[str, Any]] = []
    for b in BOARDS:
        classes_out: List[Dict[str, Any]] = []
        for cls in b.classes:
            sources = b.sources_for(cls)
            # The standard scheme first, then anything loaded that it does not
            # name (Arts, Vocational Education…), so nothing loaded is hidden —
            # unless the scheme already reaches it through a subject alias
            # (ICSE Physics covers NCERT Science; listing Science too would be
            # the same book twice).
            scheme = b.subjects_for(cls)
            covered = {alias for name in scheme for alias in b.subject_aliases.get(name, ())}
            extra = [x for x in _loaded_subjects(counts, sources, cls) if x not in covered]
            names = list(dict.fromkeys((*scheme, *extra)))
            subjects_out = [
                {"name": s, "libraries": _count(counts, sources, (cls,), b.listing_subjects(s))}
                for s in names
            ]
            classes_out.append({
                "class": cls,
                "libraries": _count(counts, sources, (cls,), None),
                "subjects": subjects_out,
            })
        boards_out.append({
            "key": b.key,
            "name": b.name,
            "full_name": b.full_name,
            "kind": b.kind,
            "alias_kind": b.alias_kind,
            "sources": [
                {"board": s.board, "classes": list(s.classes) if s.classes else None}
                for s in b.aliases
            ],
            "libraries": sum(c["libraries"] for c in classes_out),
            "classes": classes_out,
        })

    exams_out: List[Dict[str, Any]] = []
    for e in EXAMS:
        groups = e.source_groups()
        subjects_out = [
            {
                "name": label,
                "libraries": sum(
                    _count(counts, (g.board,), g.levels, e.listing_subjects(label)) for g in groups
                ),
            }
            for label in e.subjects
        ]
        # Distinct books, not the per-section sum: one Class 10 Science book
        # serves both NDA Physics and NDA Chemistry and must count once.
        all_subjects = e.listing_subjects(None)
        total = sum(_count(counts, (g.board,), g.levels, all_subjects) for g in groups)
        exams_out.append({
            "key": e.key,
            "name": e.name,
            "full_name": e.full_name,
            "sources": [
                {"board": s.board, "classes": list(s.classes) if s.classes else None}
                for s in e.sources
            ],
            "libraries": total,
            "subjects": subjects_out,
        })

    return {"mediums": list(MEDIUMS), "boards": boards_out, "exams": exams_out}


__all__ = [
    "MEDIUMS", "ALL_CLASSES", "BOARDS", "EXAMS", "Board", "Exam", "Source",
    "Group", "Selection", "standard_subjects", "find_board", "find_exam",
    "resolve", "annotate",
]
