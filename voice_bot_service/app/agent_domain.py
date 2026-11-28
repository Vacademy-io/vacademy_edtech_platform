"""Is an agent calling for an EDUCATION business, judged from its own script only?

The platform rules build_system_prompt adds to every agent were written around
education: live classes, a counsellor's Hindi vocabulary (marks, fees,
scholarship, parents), "steer toward your goal (demo/next step)". An agent whose
script says what it sells never notices. An agent whose script does NOT say it
borrows them: AAIBUZZ/IRPL calls c43e9ce7 and e6cb5f47 (2026-10-16) had a
512-character generic script, and the bot told the caller "we are an edtech
company… for children from class 1 to 12", "AI-powered learning programs…
maths, science, English", then booked a 5 PM demo that does not exist.

So the prompt is built in two shapes:

  EDUCATION — the agent's own script carries ANY education signal, or it has
              no script at all (the built-in persona and blank agents, which
              keep today's behaviour). The prompt is byte-identical to what it
              was before this module existed.
  GENERAL   — everything else. Same rules with industry-neutral examples, plus
              a grounding rule (nothing about the business may come from
              anywhere but the script) — see build_system_prompt.

Deliberately one-sided: a false EDUCATION costs nothing (the agent keeps the
prompt it has today), a false GENERAL changes a working agent. So the word list
is broad and any single hit is enough. Kept in step with admin_core's
AiAgentDomain (the prompt assistant), which uses the same list.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Iterable

EDUCATION = "EDUCATION"
GENERAL = "GENERAL"

# admin_core sends this in place of a blank system prompt
# (VoiceBotInternalController.registryAgentMap). A blank agent is legacy.
_BLANK_PROMPT_STAND_IN = "You are a friendly, concise phone assistant."

# Latin script: English and romanised Hindi/Hinglish. Whole words (with the
# common inflections) so "classic" or "upgrade" do not count. Left out on
# purpose, although they lean educational: "learn" ("learn more"), "study"
# ("case study") and "degree" ("360 degree") are in every sales script, and
# would keep almost any future agent on the education rules.
EDUCATION_TERMS_LATIN = (
    r"class(?:es|room|rooms|mates?)?", r"students?", r"parents?", r"parenting", r"guardians?",
    r"child(?:ren|'s)?", r"kids?", r"schools?", r"schooling", r"pre-?schools?",
    r"colleges?", r"universit(?:y|ies)", r"courses?", r"courseware", r"coaching",
    r"tuitions?", r"tutors?", r"tutoring", r"tutorials?", r"admissions?",
    r"exams?", r"examinations?", r"marks", r"syllabus", r"teach(?:er|ers|ing)?",
    r"faculty", r"institutes?", r"academy", r"academies", r"academics?",
    r"learning", r"learners?", r"e-?learning", r"lectures?", r"lecturers?",
    r"scholarships?", r"batch(?:es)?", r"cbse", r"icse", r"neet", r"jee", r"upsc", r"ssc",
    r"ielts", r"toefl", r"olympiads?", r"grades?", r"subjects?", r"curricul(?:um|a)",
    r"lms", r"counsell?ors?", r"counsell?ing", r"ed-?tech", r"educat(?:ion|ional|ors?)",
    r"homework", r"semesters?", r"diplomas?", r"quiz(?:zes)?", r"training", r"trainers?",
    r"bootcamps?",
    # Exam-prep and degree names, and a parent's "your son / your daughter" —
    # education scripts that use none of the words above (code review of the
    # AAIBUZZ/IRPL fix, 2026-10-16). Left out: bare "nda" (non-disclosure),
    # "cat"/"gate", "mca" (Ministry of Corporate Affairs), "beta" ("beta
    # version"), "webinar"/"workshop" (every B2B marketer runs them).
    r"masterclass(?:es)?", r"mba", r"bba", r"bca", r"b\.?\s?tech", r"m\.?\s?tech", r"mbbs",
    r"cuet", r"clat", r"test series", r"mock tests?", r"upskill(?:ing|s)?", r"bete", r"beti",
    r"pathshala",
    r"padh(?:ai|aai|na|ne|te|ta|ti|o)", r"bach(?:cha|che|chon|chi)", r"bac(?:cha|che|chon)",
    r"vidyarthi", r"vidyalaya", r"chhatra", r"shiksha", r"kaksha", r"pariksha",
    r"gurukul",
)

# Indic scripts: stems matched as substrings — Python's \b is unreliable inside
# Devanagari (vowel signs are not \w), and a stem catches every inflection
# (बच्चा/बच्चे/बच्चों). Compared after NFC, which also splits the nukta
# letters (ढ़ -> ढ + ़) the same way on both sides.
EDUCATION_TERMS_INDIC = (
    # Hindi / Marathi (Devanagari)
    "बच्च", "पढ़", "पढा", "पढ़ा", "क्लास", "कक्षा", "छात्र", "विद्यार्थ", "स्टूडेंट", "स्टुडंट",
    "स्कूल", "शाळा", "पाठशाला", "विद्यालय", "कॉलेज", "कोचिंग", "ट्यूशन", "शिकवणी",
    "एडमिशन", "दाखिला", "परीक्षा", "एग्जाम", "एग्ज़ाम", "एक्जाम", "मार्क्स", "शिक्षा",
    "शिक्षक", "शैक्षणिक", "टीचर", "अध्यापक", "कोर्स", "सिलेबस", "पाठ्यक्रम", "अभ्यासक्रम",
    "अभिभावक", "माता-पिता", "पैरेंट", "पालक", "बैच", "इयत्ता", "छात्रवृत्ति", "स्कॉलरशिप",
    "लेक्चर", "ट्यूटर", "अकादमी", "एकेडमी", "लर्निंग", "सब्जेक्ट", "काउंसलर", "काउंसलिंग",
    "बेटा", "बेटी", "बेटे", "बेटों", "ट्रेनिंग", "मास्टरक्लास", "टेस्ट सीरीज",
    # Gujarati, Bengali, Punjabi — the common few, for agents in those languages
    "શાળા", "વિદ્યાર્થી", "স্কুল", "ছাত্র", "ਸਕੂਲ", "ਵਿਦਿਆਰਥੀ",
)

_LATIN_RE = re.compile(r"\b(?:" + "|".join(EDUCATION_TERMS_LATIN) + r")\b", re.IGNORECASE)
_INDIC = tuple(unicodedata.normalize("NFC", t) for t in EDUCATION_TERMS_INDIC)


def _items(value: Any) -> Iterable[str]:
    if value is None:
        return ()
    if isinstance(value, (list, tuple)):
        return (str(v) for v in value if v is not None)
    return (str(value),)


def education_hits(text: str) -> list:
    """Every education term found in `text` (for diagnostics and tests)."""
    norm = unicodedata.normalize("NFC", str(text or "")).replace("_", " ")
    hits = [m.group(0) for m in _LATIN_RE.finditer(norm)]
    hits += [t for t in _INDIC if t in norm]
    return hits


def has_education_signal(text: str) -> bool:
    norm = unicodedata.normalize("NFC", str(text or "")).replace("_", " ")
    return bool(_LATIN_RE.search(norm)) or any(t in norm for t in _INDIC)


def agent_domain(agent: Dict[str, Any] | None) -> str:
    """EDUCATION or GENERAL, from the agent's OWN script: system prompt, opening
    line, questions to find out, call outcomes and name. Never from the
    institute, the lead or anything the platform adds."""
    agent = agent or {}
    prompt = str(agent.get("systemPrompt") or "").strip()
    if not prompt or prompt == _BLANK_PROMPT_STAND_IN:
        return EDUCATION
    parts = [agent.get("name"), prompt, agent.get("openingLine")]
    parts += list(_items(agent.get("extractionQuestions")))
    parts += list(_items(agent.get("dispositions")))
    text = "\n".join(str(p) for p in parts if p)
    return EDUCATION if has_education_signal(text) else GENERAL


def is_general_agent(agent: Dict[str, Any] | None) -> bool:
    return agent_domain(agent) == GENERAL
