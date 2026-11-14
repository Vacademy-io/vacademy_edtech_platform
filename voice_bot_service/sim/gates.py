"""What the caller would HEAR: the agent's raw text after the real production
gates — marker canonicalisation, tool-call stripping, END/TRANSFER/SEND
extraction (SentinelGate) and the once-per-call / no-repeat sentence filter
(NoRepeatGate). Imported from app.bot so the simulator tests the code that
ships, not a copy of it."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

from app import bot as b
from app.turntake import is_echo_of_answer, normalize_spoken, question_topic

_SEND_RE = re.compile(re.escape(b.SEND_MARKER_OPEN) + r"([^<>]+)" + re.escape(b.SEND_MARKER_CLOSE))


@dataclass
class Spoken:
    text: str
    dropped: List[str]
    ended: bool
    transfer: bool
    sends: List[str]
    raw: str
    had_markup: bool = False
    # Production asks the model for its NEXT line instead of speaking a reply
    # that said nothing new (NoRepeatGate → _ask_for_next_step): "restatement"
    # (the whole reply was the caller's answer said back), "all-repeat" (every
    # sentence already said, after a caller answer). sim/run.py mirrors the
    # re-run, twice per call, with the same cue words (bot.next_step_cue).
    next_step: str = ""
    held: str = ""


class TextGates:
    def __init__(self):
        self._last_user = ""
        self.gate = b.NoRepeatGate(enabled=lambda: True, last_caller_text=lambda: self._last_user)

    def note_user(self, text: str):
        self._last_user = text

    def pass_reply(self, raw: str) -> Spoken:
        buf = raw or ""
        had_markup = False
        if "<" in buf:
            buf = b._canonical_markers(buf)
            if "<tool_call>" in buf or "<arg_" in buf or "</tool_call>" in buf:
                had_markup = True
                buf = b._TOOL_CALL_RE.sub("", buf)
                buf = re.sub(r"<tool_call>.*$", "", buf, flags=re.S)
        transfer = b.TRANSFER_MARKER in buf
        ended = b.END_MARKER in buf
        buf = buf.replace(b.TRANSFER_MARKER, "").replace(b.END_MARKER, "")
        sends = _SEND_RE.findall(buf)
        buf = _SEND_RE.sub("", buf)
        # A half-written marker at the end is held back, never spoken.
        emit, _held = b.SentinelGate._split_safe(buf)
        kept, dropped = [], []
        for sent in _sentences(emit):
            if not any(ch.isalnum() for ch in sent):
                continue
            if self.gate._keep(sent):
                kept.append(sent.strip())
                norm = normalize_spoken(sent)
                self.gate._spoken.append(norm)
                topic = question_topic(sent)
                if topic:
                    self.gate._asked[topic] = norm
            else:
                dropped.append(sent.strip())
        # Mirror NoRepeatGate._echo_held: an opening sentence that only says
        # the caller's answer back is dropped when anything real follows it,
        # spoken when it is the whole reply. (The wrapper never ran the gate's
        # process_frame, so until 2026-09-13 the text sim could not see this.)
        next_step, held = "", ""
        if kept and self.gate._no_echo():
            last_q = next((x for x in reversed(self.gate._spoken[:-len(kept)]) if "?" in x), "")
            if is_echo_of_answer(kept[0], self._last_user, last_q):
                if len(kept) >= 2:
                    dropped.append(kept[0])
                    kept = kept[1:]
                elif not ended and not transfer:
                    # The restatement IS the reply (call 71e8f39b): production
                    # asks for the next step instead of speaking it.
                    next_step, held = "restatement", kept[0]
                    dropped.append(kept[0])
                    kept = []
        if (not kept and dropped and not next_step and not ended and not transfer
                and self._last_user.strip() and not self._last_user.startswith("[")):
            next_step, held = "all-repeat", dropped[-1]
        return Spoken(text=" ".join(kept), dropped=dropped, ended=ended, transfer=transfer,
                      sends=sends, raw=raw, had_markup=had_markup or ("<" in emit and ">" in emit),
                      next_step=next_step, held=held)


def _sentences(text: str) -> List[str]:
    out, pos = [], 0
    for m in b.NoRepeatGate._SENT_END.finditer(text):
        out.append(text[pos:m.end()])
        pos = m.end()
    if text[pos:].strip():
        out.append(text[pos:])
    return out
