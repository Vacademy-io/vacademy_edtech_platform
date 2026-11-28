"""Read the printed Name field at the top of scanned pages with a vision model.

Several header strips go in one call, each preceded by "Image k", and the model
answers one strict JSON array. What matters most is label_kind: a PRINTED
form field (Name / Student name / नाम / Candidate's name, with a box, line or
colon) starts a new student's copy; an answer line that begins "Name the ..."
must not. The handwritten value is read too, for the review screen and the
SAME_NAME check; matching it to a student stays with identify +
StudentNameMatcher downstream.

Also the probe: which pass holds the fronts, and are they upside down? The
first three pages of each pass are read both ways up in ONE call; the
(pass, rotation) with printed-field hits wins.

Model: the 'copy_check_scan_header' use case (super-admin editable), with
grader.DEFAULT_MODEL as the hard fallback; reasoning is switched off for this
pure reading task. A chunk is tried twice, 1.5 s apart; then ScanRetryable
(503 retryable to assessment_service, which retries the load).
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional, Sequence

from . import config

logger = logging.getLogger(__name__)

USE_CASE = "copy_check_scan_header"
PRINTED_FIELD = "PRINTED_FIELD"
QUESTION_TEXT = "QUESTION_TEXT"
NONE = "NONE"
LABEL_KINDS = (PRINTED_FIELD, QUESTION_TEXT, NONE)

TRIES = 2
RETRY_SLEEP_SECONDS = 1.5
PROBE_FIRST = 3
PROBE_NEXT = 6

SYSTEM_PROMPT = """You look at the TOP part of scanned pages from handwritten exam answer sheets. Each image is labelled "Image k".

For EACH image decide whether it carries a PRINTED identification field for the student's name, and read it.

label_kind:
- "PRINTED_FIELD": a form field PRINTED on the sheet near the top - a printed label such as "Name", "Student name", "Name of the student", "Candidate's name", "नाम" - with a box, a line or a colon for the student to write in. Count it even when nothing is written in it.
- "QUESTION_TEXT": the word "Name" appears only inside an answer or a question, handwritten or printed, e.g. "Name the gas that ...", "Name two ...". This is NOT a field.
- "NONE": no name field at all (a continuation page, a blank page, only answers).

name_value: the handwriting INSIDE the printed name field, exactly as written (null when the field is empty or there is no field). Never take a name from an answer.
name_legible: true only when name_value can be read with confidence.
roll_value: a handwritten roll / registration / admission number in a printed field, or null.
confidence: 0.0-1.0 for label_kind.

Return ONLY a JSON array with one object per image, in order:
[{"i": 1, "label_kind": "PRINTED_FIELD", "name_value": "...", "name_legible": true, "roll_value": null, "confidence": 0.9}]"""


class ScanRetryable(Exception):
    """The header read failed in a way a later retry may fix (model outage, budget)."""


class _Mismatch(Exception):
    """The reply parsed but did not answer every image exactly once."""


@dataclass
class HeaderRead:
    label_kind: str = NONE
    name_value: Optional[str] = None
    name_legible: bool = False
    roll_value: Optional[str] = None
    confidence: float = 0.0


@dataclass
class Usage:
    model: str = ""
    model_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {"model": self.model, "model_calls": self.model_calls,
                "prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens}


class _FixedKeys:
    """Pre-resolved API keys (duck-types ApiKeyResolver.resolve_keys, like
    tutor.plan_compiler._FixedKeys), so the client never touches the session
    during the up-to-240 s analysis."""

    def __init__(self, keys: tuple) -> None:
        self._keys = keys

    def resolve_keys(self, institute_id=None, user_id=None, request_model=None, **_ignored):
        return self._keys


def make_llm(db: Any, institute_id: Optional[str] = None) -> Any:
    """The header-read client, with the institute's keys resolved NOW from `db`
    (the same waterfall ChatLLMClient would run on every call: user -> institute
    -> env). The caller may close the session as soon as this returns."""
    from ...api_key_resolver import ApiKeyResolver
    from ...chat_llm_client import ChatLLMClient

    keys = ApiKeyResolver(db).resolve_keys(institute_id=institute_id or "default", user_id=None)
    return ChatLLMClient(_FixedKeys(keys), disable_reasoning=True)


def header_model(db: Any, preferred_model: Optional[str] = None) -> str:
    from ..grader import DEFAULT_MODEL

    try:
        from ...model_selection import resolve_models

        primary, _fallbacks = resolve_models(db, USE_CASE, preferred_model=preferred_model,
                                             hard_fallback=DEFAULT_MODEL)
        return primary if isinstance(primary, str) and primary else DEFAULT_MODEL
    except Exception as exc:  # noqa: BLE001
        logger.warning("scan header model lookup failed (%s); using %s", type(exc).__name__, DEFAULT_MODEL)
        return DEFAULT_MODEL


_NONE_WORDS = {"null", "none", "n/a", "na", "not found", "not visible", "unknown", "-", "illegible", "unreadable"}


def _clean(value: Any) -> Optional[str]:
    if value is None or isinstance(value, bool):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text or text.lower() in _NONE_WORDS:
        return None
    return text[:120]


def _confidence(value: Any) -> float:
    try:
        c = float(value)
    except (TypeError, ValueError):
        return 0.0
    if 1.0 < c <= 100.0:
        c /= 100.0
    return max(0.0, min(1.0, c))


def _legible(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "yes", "1")


def parse_reply(content: str, count: int) -> list[HeaderRead]:
    """Strict: a JSON array answering images 1..count exactly once each."""
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end <= start:
        raise ValueError("no JSON array in the reply")
    data = json.loads(text[start:end + 1])
    if not isinstance(data, list) or not all(isinstance(x, dict) for x in data):
        raise ValueError("the reply is not an array of objects")
    if len(data) != count:
        raise _Mismatch(f"{len(data)} answers for {count} images")
    out: dict[int, HeaderRead] = {}
    for pos, item in enumerate(data, start=1):
        try:
            i = int(item.get("i", pos))
        except (TypeError, ValueError):
            raise _Mismatch("bad index")
        if i < 1 or i > count or i in out:
            raise _Mismatch("index out of range or repeated")
        kind = str(item.get("label_kind") or NONE).strip().upper()
        name = _clean(item.get("name_value"))
        out[i] = HeaderRead(
            label_kind=kind if kind in LABEL_KINDS else NONE,
            name_value=name,
            name_legible=bool(name) and _legible(item.get("name_legible")),
            roll_value=_clean(item.get("roll_value")),
            confidence=_confidence(item.get("confidence")),
        )
    return [out[i] for i in range(1, count + 1)]


def _message(strips: Sequence[bytes]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = [{
        "type": "text",
        "text": f"{len(strips)} images follow, each the top of one scanned page. Answer for every image.",
    }]
    for k, data in enumerate(strips, start=1):
        parts.append({"type": "text", "text": f"Image {k}"})
        b64 = base64.b64encode(data).decode("ascii")
        parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": parts}]


class HeaderReader:
    def __init__(self, llm: Any, model: str, institute_id: Optional[str] = None,
                 concurrency: int = 3,
                 sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep):
        self.llm = llm
        self.model = model
        self.institute_id = institute_id
        self.usage = Usage(model=model)
        self._sem = asyncio.Semaphore(max(1, concurrency))
        self._sleep = sleep

    async def _call(self, strips: Sequence[bytes]) -> list[HeaderRead]:
        async with self._sem:
            self.usage.model_calls += 1
            resp = await self.llm.chat_completion(
                messages=_message(strips),
                temperature=0.0,
                max_tokens=max(800, 100 * len(strips)),
                institute_id=self.institute_id,
                model=self.model,
            )
        usage = (resp or {}).get("usage") or {}
        self.usage.prompt_tokens += int(usage.get("prompt_tokens") or 0)
        self.usage.completion_tokens += int(usage.get("completion_tokens") or 0)
        return parse_reply((resp or {}).get("content") or "", len(strips))

    async def _chunk(self, strips: Sequence[bytes], split_on_mismatch: bool) -> list[HeaderRead]:
        last: Optional[BaseException] = None
        for attempt in range(TRIES):
            try:
                return await self._call(strips)
            except _Mismatch as e:
                if split_on_mismatch and len(strips) > 1:
                    reads = await asyncio.gather(*(self._chunk([s], False) for s in strips))
                    return [r[0] for r in reads]
                last = e
            except Exception as e:  # noqa: BLE001 - provider errors, bad JSON
                last = e
            logger.warning("scan header read: chunk of %d, attempt %d failed: %s",
                           len(strips), attempt + 1, type(last).__name__)
            if attempt + 1 < TRIES:
                await self._sleep(RETRY_SLEEP_SECONDS)
        raise ScanRetryable(f"header read failed twice ({type(last).__name__})")

    async def read(self, strips: Sequence[bytes], chunk: int = config.HEADER_CHUNK) -> list[HeaderRead]:
        """One HeaderRead per strip, in order. Raises ScanRetryable."""
        if not strips:
            return []
        groups = [list(strips[i:i + chunk]) for i in range(0, len(strips), chunk)]
        results = await asyncio.gather(*(self._chunk(g, True) for g in groups))
        return [r for group in results for r in group]


@dataclass
class ProbeResult:
    found: bool
    fronts_pass: Optional[int] = None
    fronts_rotation: int = 0
    # page index in the fronts pass -> its read at fronts_rotation
    reads: dict[int, HeaderRead] = field(default_factory=dict)


def _decide(hits: dict[tuple[int, int], list[tuple[int, HeaderRead]]]) -> Optional[tuple[int, int]]:
    scored = []
    for key, reads in hits.items():
        n = sum(1 for _i, r in reads if r.label_kind == PRINTED_FIELD)
        conf = sum(r.confidence for _i, r in reads if r.label_kind == PRINTED_FIELD)
        if n:
            # more hits, then more confidence, then upright, then the lower pass number
            scored.append(((n, conf, -key[1], -key[0]), key))
    if not scored:
        return None
    scored.sort(reverse=True)
    return scored[0][1]


async def probe(reader: HeaderReader, strips_by_pass: dict[int, list[Optional[tuple[bytes, bytes]]]]) -> ProbeResult:
    """strips_by_pass: pass_no -> per page (strip_up, strip_down) or None (unreadable).
    Reads the first 3 pages of each pass both ways up in one call; with no
    printed field anywhere, the next 6 pages."""
    hits: dict[tuple[int, int], list[tuple[int, HeaderRead]]] = {}
    for start, count in ((0, PROBE_FIRST), (PROBE_FIRST, PROBE_NEXT)):
        items: list[tuple[int, int, int, bytes]] = []
        for pass_no in sorted(strips_by_pass):
            for idx in range(start, min(start + count, len(strips_by_pass[pass_no]))):
                s = strips_by_pass[pass_no][idx]
                if s is None:
                    continue
                items.append((pass_no, idx, 0, s[0]))
                items.append((pass_no, idx, 180, s[1]))
        if not items:
            continue
        reads = await reader.read([it[3] for it in items], chunk=config.PROBE_CHUNK)
        for (pass_no, idx, rot, _b), r in zip(items, reads):
            hits.setdefault((pass_no, rot), []).append((idx, r))
        choice = _decide(hits)
        if choice is not None:
            return ProbeResult(found=True, fronts_pass=choice[0], fronts_rotation=choice[1],
                               reads={i: r for i, r in hits[choice]})
    return ProbeResult(found=False)
