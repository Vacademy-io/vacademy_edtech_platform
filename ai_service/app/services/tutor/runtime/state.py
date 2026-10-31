"""Pure state machine over a compiled plan (design §6.3). No I/O.

A LessonPlan is the READY plan of one slide loaded into plain dicts; a
Pointer is where the learner is; `advance`, `remediate`, `skip` return the
next Pointer plus the events the socket should emit. Everything here is unit
testable without a database or a model.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Dict, List, Optional

MAX_REMEDIATIONS = 2

# Phases
TEACH = "teach"                 # concept board + narration just sent; waiting for continue/answer
AWAIT_ANSWER = "await_answer"   # a check was asked
REMEDIATE = "remediate"         # hint given, waiting for a second try
MEDIA_TASK = "media_task"       # learner is watching / reading
TOPIC_SUMMARY = "topic_summary"
SLIDE_DONE = "slide_done"
# Predict-then-reveal: the teacher asked for a guess before this concept's
# board appears; any answer (or a skip) moves on to the teaching.
PREDICT = "predict"
# A weak concept is being re-asked at a topic summary or slide end (design
# §6.6). Never persisted: a session that ends mid-revisit resumes on the
# summary, and the revisit runs again because the concept is still weak.
REVISIT = "revisit"
# At most this many revisit questions per summary, so a bad day never turns
# into an exam.
REVISIT_MAX = 3


@dataclass
class Concept:
    id: str
    title: str
    order: int
    tags: List[str]
    board_ops: List[Dict[str, Any]]
    say: str
    say_i18n: Dict[str, str]
    teach_notes: Optional[str]
    check: Optional[Dict[str, Any]]
    # A one-line guess question asked before the board (first concept of a topic).
    predict: Optional[str] = None
    predict_i18n: Dict[str, str] = field(default_factory=dict)

    def _spoken(self, base: Optional[str], i18n: Dict[str, str], lang: str, course_lang: str) -> Optional[str]:
        """A spoken line in the session language: the compiled translation
        when the learner switched language, else the course-language line.
        None when the translation is missing — callers fall back to a canned
        line rather than speaking the wrong language."""
        if lang and lang != course_lang:
            return (i18n or {}).get(lang) or None
        return (base or "").strip() or None

    def predict_text(self, lang: str, course_lang: str = "en") -> Optional[str]:
        return self._spoken(self.predict, self.predict_i18n, lang, course_lang)

    def check_prompt(self, lang: str, course_lang: str = "en") -> Optional[str]:
        chk = self.check or {}
        return self._spoken(chk.get("prompt"), chk.get("prompt_i18n") or {}, lang, course_lang) or (chk.get("prompt") or None)

    def hint_for(self, lang: str, course_lang: str = "en") -> Optional[str]:
        chk = self.check or {}
        h = self._spoken(chk.get("hint"), chk.get("hint_i18n") or {}, lang, course_lang)
        if h:
            return h
        if lang == course_lang:
            return self.hint
        return None

    @property
    def hint(self) -> Optional[str]:
        h = ((self.check or {}).get("hint") or "").strip()
        if h:
            return h
        for m in (self.check or {}).get("misconceptions") or []:
            if isinstance(m, dict) and (m.get("hint") or "").strip():
                return str(m["hint"]).strip()
        return None

    @property
    def has_check(self) -> bool:
        return bool(self.check) and (self.check or {}).get("type", "none") != "none" and bool((self.check or {}).get("prompt"))

    @property
    def is_media_task(self) -> bool:
        return any(op.get("op") == "media_task" for op in self.board_ops)

    def narration(self, lang: str) -> str:
        if lang and self.say_i18n and self.say_i18n.get(lang):
            return self.say_i18n[lang]
        return self.say


@dataclass
class Topic:
    id: str
    title: str
    order: int
    concepts: List[Concept]
    summary_ops: List[Dict[str, Any]]
    estimated_seconds: Optional[int] = None
    # The spoken recap that closes the topic (compiled); None = canned line.
    summary_say: Optional[str] = None
    summary_say_i18n: Dict[str, str] = field(default_factory=dict)

    def recap(self, lang: str, course_lang: str = "en") -> Optional[str]:
        if lang and lang != course_lang:
            return (self.summary_say_i18n or {}).get(lang) or None
        return (self.summary_say or "").strip() or None


@dataclass
class LessonPlan:
    plan_id: str
    slide_id: str
    version: int
    language: str
    objectives: List[str]
    topics: List[Topic]
    slide_title: str = ""
    # {"knowledge_base_id", "mode"} when the plan was compiled from a KB.
    kb: Optional[Dict[str, Any]] = None
    # lesson | interview | practice — set at compile time; drives the greeting
    # and the live persona.
    style: str = "lesson"

    def concept_at(self, p: "Pointer") -> Optional[Concept]:
        if 0 <= p.topic < len(self.topics):
            t = self.topics[p.topic]
            if 0 <= p.concept < len(t.concepts):
                return t.concepts[p.concept]
        return None

    def topic_at(self, p: "Pointer") -> Optional[Topic]:
        return self.topics[p.topic] if 0 <= p.topic < len(self.topics) else None

    def find(self, concept_id: Optional[str]) -> Optional["Pointer"]:
        """Pointer at a concept, with `done` = the concepts before it so a
        resumed session shows real progress rather than 0%."""
        seen = 0
        for ti, t in enumerate(self.topics):
            for ci, c in enumerate(t.concepts):
                if c.id == concept_id:
                    return Pointer(topic=ti, concept=ci, phase=TEACH, done=seen)
                seen += 1
        return None

    @property
    def total_concepts(self) -> int:
        return sum(len(t.concepts) for t in self.topics)


@dataclass
class Pointer:
    topic: int = 0
    concept: int = 0
    phase: str = TEACH
    remediations: int = 0
    # The predict question of the current concept was answered (or skipped).
    predicted: bool = False
    # Concepts completed in this slide (for progress and weak flags).
    done: int = 0
    weak: List[str] = field(default_factory=list)
    skipped: List[str] = field(default_factory=list)

    def progress(self, plan: LessonPlan) -> Dict[str, Any]:
        total = plan.total_concepts or 1
        topic = plan.topic_at(self)
        return {
            "topic_index": self.topic, "topic_count": len(plan.topics),
            "concept_index": self.concept, "concepts_in_topic": len(topic.concepts) if topic else 0,
            "done": self.done, "total": total, "percent": int(100 * min(self.done, total) / total),
        }


def from_plan_view(view: Dict[str, Any]) -> LessonPlan:
    """plan_store.plan_view() dict → LessonPlan."""
    topics: List[Topic] = []
    for t in view.get("topics", []):
        concepts = [
            Concept(
                id=c["id"], title=c["title"], order=c["order"], tags=list(c.get("concept_tags") or []),
                board_ops=list(c.get("board_ops") or []), say=c.get("say") or "",
                say_i18n=dict(c.get("say_i18n") or {}), teach_notes=c.get("teach_notes"),
                check=c.get("check"), predict=(c.get("predict") or None),
                predict_i18n=dict(c.get("predict_i18n") or {}),
            )
            for c in t.get("concepts", [])
        ]
        topics.append(Topic(id=t["id"], title=t["title"], order=t["order"], concepts=concepts,
                            summary_ops=list(t.get("summary_ops") or []), estimated_seconds=t.get("estimated_seconds"),
                            summary_say=(t.get("summary_say") or None),
                            summary_say_i18n=dict(t.get("summary_say_i18n") or {})))
    return LessonPlan(
        plan_id=view["plan_id"], slide_id=view["slide_id"], version=int(view.get("version") or 1),
        language=view.get("language") or "en", objectives=list(view.get("objectives") or []), topics=topics,
        slide_title=str(view.get("slide_title") or ""),
        kb=view.get("kb") if isinstance(view.get("kb"), dict) and view["kb"].get("knowledge_base_id") else None,
        style=str(view.get("style") or "lesson"),
    )


def pointer_at_topic_end(plan: LessonPlan, ti: int) -> Pointer:
    """Resume on a topic's summary: every concept up to and including that
    topic counts as done."""
    ti = min(max(ti, 0), max(len(plan.topics) - 1, 0))
    done = sum(len(t.concepts) for t in plan.topics[: ti + 1])
    n = len(plan.topics[ti].concepts) if plan.topics else 0
    return Pointer(topic=ti, concept=n, phase=TOPIC_SUMMARY, done=done)


def pointer_at_slide_end(plan: LessonPlan) -> Pointer:
    return Pointer(topic=len(plan.topics), concept=0, phase=SLIDE_DONE, done=plan.total_concepts)


def replay_ops(plan: LessonPlan, p: Pointer) -> List[Dict[str, Any]]:
    """Board ops of the concepts BEFORE the pointer in its topic: what a
    resumed session must put back on the board so the narration's "look at
    the arrow" still points at something."""
    topic = plan.topic_at(p)
    if topic is None:
        return []
    out: List[Dict[str, Any]] = []
    for c in topic.concepts[:max(0, p.concept)]:
        out.extend(c.board_ops)
    return out


# ── transitions ──────────────────────────────────────────────────────────────

@dataclass
class Step:
    """What the socket should do next."""
    pointer: Pointer
    kind: str                      # teach | ask | topic_summary | slide_done | media_task
    concept: Optional[Concept] = None
    topic: Optional[Topic] = None
    clear_board: bool = False      # a new topic starts: wipe the board first
    board_ops: List[Dict[str, Any]] = field(default_factory=list)


def enter(plan: LessonPlan, p: Pointer) -> Step:
    """Teach the concept at the pointer (or summarise / finish)."""
    if p.topic >= len(plan.topics):
        return Step(pointer=replace(p, phase=SLIDE_DONE), kind="slide_done")
    topic = plan.topics[p.topic]
    if p.concept >= len(topic.concepts):
        return Step(pointer=replace(p, phase=TOPIC_SUMMARY), kind="topic_summary", topic=topic,
                    board_ops=list(topic.summary_ops))
    concept = topic.concepts[p.concept]
    if concept.predict and not p.predicted and not concept.is_media_task:
        # Ask for a guess first; the board is drawn after the answer.
        return Step(pointer=replace(p, phase=PREDICT, remediations=0), kind="predict", concept=concept, topic=topic,
                    clear_board=(p.concept == 0))
    phase = MEDIA_TASK if concept.is_media_task else TEACH
    return Step(pointer=replace(p, phase=phase, remediations=0), kind="media_task" if concept.is_media_task else "teach",
                concept=concept, topic=topic, clear_board=(p.concept == 0 and not p.predicted), board_ops=list(concept.board_ops))


def after_predict(plan: LessonPlan, p: Pointer) -> Step:
    """The guess was made (or skipped): teach the concept, board and all."""
    return enter(plan, replace(p, predicted=True))


def after_teach(plan: LessonPlan, p: Pointer) -> Step:
    """The narration finished (or the learner pressed continue): ask the
    concept's check, or move on when it has none."""
    concept = plan.concept_at(p)
    if concept is not None and concept.has_check:
        return Step(pointer=replace(p, phase=AWAIT_ANSWER), kind="ask", concept=concept, topic=plan.topic_at(p))
    return advance(plan, p, mark_done=True)


def advance(plan: LessonPlan, p: Pointer, *, mark_done: bool = True, weak: bool = False, skipped: bool = False) -> Step:
    concept = plan.concept_at(p)
    q = replace(p, weak=list(p.weak), skipped=list(p.skipped))
    if concept is not None and mark_done:
        q.done += 1
        if weak and concept.id not in q.weak:
            q.weak.append(concept.id)
        if skipped and concept.id not in q.skipped:
            q.skipped.append(concept.id)
    topic = plan.topic_at(p)
    if topic is not None and p.concept + 1 < len(topic.concepts):
        return enter(plan, replace(q, concept=p.concept + 1, remediations=0, predicted=False))
    # end of topic → summary (then the socket calls next_topic)
    return Step(pointer=replace(q, concept=len(topic.concepts) if topic else 0, phase=TOPIC_SUMMARY),
                kind="topic_summary", topic=topic, board_ops=list(topic.summary_ops) if topic else [])


def next_topic(plan: LessonPlan, p: Pointer) -> Step:
    if p.topic + 1 < len(plan.topics):
        return enter(plan, replace(p, topic=p.topic + 1, concept=0, remediations=0, predicted=False))
    return Step(pointer=replace(p, phase=SLIDE_DONE), kind="slide_done")


def remediate(plan: LessonPlan, p: Pointer) -> Step:
    """A wrong answer: give a hint and ask again, at most MAX_REMEDIATIONS
    times, then advance with the concept flagged weak."""
    if p.remediations + 1 >= MAX_REMEDIATIONS:
        return advance(plan, p, mark_done=True, weak=True)
    return Step(pointer=replace(p, phase=REMEDIATE, remediations=p.remediations + 1), kind="ask",
                concept=plan.concept_at(p), topic=plan.topic_at(p))


def repeat(plan: LessonPlan, p: Pointer) -> Step:
    concept = plan.concept_at(p)
    if concept is None:
        return enter(plan, p)
    return Step(pointer=replace(p, phase=MEDIA_TASK if concept.is_media_task else TEACH, predicted=True), kind="teach",
                concept=concept, topic=plan.topic_at(p), board_ops=list(concept.board_ops))


def skip(plan: LessonPlan, p: Pointer) -> Step:
    return advance(plan, p, mark_done=True, skipped=True)


# ── weak-concept revisits (design §6.6) ──────────────────────────────────────

def clear_weak(p: Pointer, concept_id: str) -> Pointer:
    """The learner answered a revisit correctly: the concept is no longer
    weak (or skipped)."""
    return replace(p, weak=[c for c in p.weak if c != concept_id], skipped=[c for c in p.skipped if c != concept_id])


def revisit_candidates(
    plan: LessonPlan, p: Pointer, *, stage: str, weak_ids, skipped_ids=(), revisited=(), scores=None,
    limit: int = REVISIT_MAX,
) -> List[Concept]:
    """Which concepts to re-ask now. Stage "topic": the concepts of the topic
    just finished that are flagged weak (this session or an earlier one).
    Stage "slide": the weakest concepts across the slide, weak or skipped,
    not already revisited this session. Lowest score first; a concept with
    no score (skipped, or weak from an earlier session) counts as 0. Media
    tasks are never re-asked."""
    scores = scores or {}
    weak, skipped, seen = set(weak_ids or ()), set(skipped_ids or ()), set(revisited or ())
    if stage == "topic":
        topic = plan.topic_at(p)
        pool = [c for c in (topic.concepts if topic else []) if c.id in weak]
    else:
        pool = [c for t in plan.topics for c in t.concepts if c.id in weak or c.id in skipped]
    pool = [c for c in pool if c.id not in seen and not c.is_media_task]
    pool.sort(key=lambda c: (float(scores.get(c.id) or 0.0), c.order))
    return pool[:max(0, int(limit))]
