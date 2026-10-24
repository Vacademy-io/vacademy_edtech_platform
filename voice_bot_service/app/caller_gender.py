"""The caller's gender — from their voice and from their own words. SHADOW MODE.

WHY (founder, 2026-10-01): Hindi grammar makes the bot pick a gender for the
person it is talking to ("सर"/"मैम", "आप बता सकते/सकती हैं"), so agents open by
asking "माता-पिता में से किससे बात कर रही हूँ?". If the system can tell from the
voice, that question can go — but only once it is shown to be accurate on real
calls. So this module MEASURES and REPORTS; nothing here reaches the model yet.

Two signals:
  * PITCH. Adult male speech centres around ~85-180 Hz, female ~165-255 Hz. The
    phone line cuts below ~300 Hz, but the fundamental is still recoverable from
    the harmonic spacing (YIN on the 8 kHz caller stream). Only voiced caller
    frames count, never while the bot is talking (its own female TTS voice can
    echo back from the handset), and only until enough speech is in.
  * WORDS. Hindi marks the speaker's gender in their own verbs and self-
    references: "मैं बच्चे का पिता बोल रहा हूँ" (call 62af8895), "मैं उसकी बुआ जी बोल
    रही हूँ". Near-certain when present — the ground truth the pitch is graded
    against in shadow mode.

Gender is not role: a male voice may be the father, grandfather, uncle, a
brother or the student. This decides the FORM OF ADDRESS only.
"""
from __future__ import annotations

import re
from typing import Optional

import numpy as np

F0_MIN, F0_MAX = 70.0, 400.0
# Median F0 boundary between typical adult male and female speech; the band
# around it is "unsure". Tuned against shadow-mode data before anything acts on it.
BOUNDARY_HZ = 165.0
UNSURE_HALF_BAND_HZ = 15.0
MIN_VOICED_SECS = 1.0        # no decision below this much voiced caller speech
MAX_VOICED_SECS = 8.0        # enough: stop spending CPU after this


def yin_f0(x: np.ndarray, sr: int, threshold: float = 0.15) -> Optional[float]:
    """Fundamental frequency of one window by YIN (de Cheveigné & Kawahara
    2002): cumulative-mean-normalised difference, first dip under `threshold`,
    parabolic interpolation. None = unvoiced / no clear period."""
    n = len(x)
    tau_min = max(2, int(sr / F0_MAX))
    tau_max = min(n // 2, int(sr / F0_MIN))
    if tau_max <= tau_min + 2:
        return None
    w = n - tau_max
    x0 = x[:w]
    # Difference function d(tau) for tau in [0, tau_max)
    d = np.empty(tau_max, dtype=np.float64)
    d[0] = 0.0
    for tau in range(1, tau_max):
        diff = x0 - x[tau:tau + w]
        d[tau] = float(np.dot(diff, diff))
    cmnd = np.empty_like(d)
    cmnd[0] = 1.0
    running = np.cumsum(d[1:])
    taus = np.arange(1, tau_max)
    with np.errstate(divide="ignore", invalid="ignore"):
        cmnd[1:] = np.where(running > 0, d[1:] * taus / running, 1.0)
    below = np.where(cmnd[tau_min:] < threshold)[0]
    if below.size == 0:
        return None
    tau = int(below[0] + tau_min)
    while tau + 1 < tau_max and cmnd[tau + 1] < cmnd[tau]:
        tau += 1                                       # walk down to the local minimum
    if 1 <= tau < tau_max - 1:                         # parabolic interpolation
        a, b, c = cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]
        denom = a - 2 * b + c
        shift = 0.5 * (a - c) / denom if denom != 0 else 0.0
        tau_f = tau + max(-1.0, min(1.0, shift))
    else:
        tau_f = float(tau)
    f0 = sr / tau_f
    return f0 if F0_MIN <= f0 <= F0_MAX else None


class PitchTracker:
    """Accumulates caller audio (int16 mono PCM) and the F0 of its voiced windows.
    40 ms windows, 20 ms hop; a window counts only if it is loud enough to be
    speech and YIN finds a clear period."""

    WIN_SECS, HOP_SECS = 0.040, 0.020

    def __init__(self, min_rms: float = 300.0):
        self.min_rms = min_rms
        self.f0s: list = []
        self._buf = np.zeros(0, dtype=np.float32)
        self._sr: Optional[int] = None
        self.done = False

    @property
    def voiced_secs(self) -> float:
        return len(self.f0s) * self.HOP_SECS

    def add(self, pcm: bytes, sr: int) -> None:
        if self.done or not pcm:
            return
        if self._sr is not None and sr != self._sr:
            self._buf = np.zeros(0, dtype=np.float32)     # a rate change: start the window over
        self._sr = sr
        x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
        self._buf = np.concatenate([self._buf, x])
        win, hop = int(sr * self.WIN_SECS), int(sr * self.HOP_SECS)
        while len(self._buf) >= win:
            w = self._buf[:win]
            self._buf = self._buf[hop:]
            rms = float(np.sqrt(np.mean(w * w)))
            if rms < self.min_rms:
                continue
            f0 = yin_f0(w - float(np.mean(w)), sr)
            if f0 is not None:
                self.f0s.append(f0)
                if self.voiced_secs >= MAX_VOICED_SECS:
                    self.done = True
                    self._buf = np.zeros(0, dtype=np.float32)
                    return

    def reset_partial(self) -> None:
        """Drop a half-filled window (e.g. when the bot starts speaking)."""
        self._buf = np.zeros(0, dtype=np.float32)

    def estimate(self) -> dict:
        n = len(self.f0s)
        out = {"voicedSecs": round(self.voiced_secs, 2), "frames": n,
               "medianHz": None, "iqrHz": None, "gender": None, "confidence": 0.0}
        if self.voiced_secs < MIN_VOICED_SECS:
            return out
        f = np.asarray(self.f0s, dtype=np.float64)
        # Octave errors (half / double the true F0) are the classic pitch-tracker
        # failure (TTS sanity set: IQRs of 130-180 Hz on three female voices).
        # Fold each value onto the octave nearest the first-pass median, then
        # take the median again.
        med0 = float(np.median(f))
        f = np.where(f > med0 * 1.6, f / 2.0, np.where(f < med0 / 1.6, f * 2.0, f))
        med = float(np.median(f))
        q1, q3 = np.percentile(f, [25, 75])
        out["medianHz"], out["iqrHz"] = round(med, 1), round(float(q3 - q1), 1)
        dist = abs(med - BOUNDARY_HZ)
        if dist < UNSURE_HALF_BAND_HZ:
            out["gender"] = "unsure"
            out["confidence"] = 0.0
            return out
        out["gender"] = "f" if med > BOUNDARY_HZ else "m"
        # Distance past the unsure band (saturating ~45 Hz beyond it) × amount of speech.
        sep = min(1.0, (dist - UNSURE_HALF_BAND_HZ) / 45.0)
        amount = min(1.0, self.voiced_secs / 3.0)
        out["confidence"] = round(0.5 + 0.5 * sep * amount, 2)
        return out


# ── From their own words ─────────────────────────────────────────────────────
# First-person verb gender and self-references. Precision over recall: these
# label the shadow-mode ground truth, so a wrong cue is worse than none.
# No \b around Devanagari: vowel signs (ा ी) are not \w, so "पिता\b" never
# matches. And FIRST person only — "वो पढ़ रहा था" is about the child.
_MALE_WORDS = re.compile(
    r"(मैं|मै)\s+[^।?!.]{0,40}?(पिता|पापा|पिताजी|चाचा|मामा|दादा|नाना|भैया|भाई|father|papa|daddy|dad)(जी|ji)?(\s|।|$|,|\.)"
    r"|(बोल|कह|पूछ|सुन|बता|कर|आ|जा|रह)\s*रहा\s*(हूँ|हूं|हु)"
    r"|(मैं|मै)\s+[^।?!.]{0,30}?(सकता|चाहता|करता|बोलता|रहता)\s*(हूँ|हूं)", re.I)
_FEMALE_WORDS = re.compile(
    r"(मैं|मै)\s+[^।?!.]{0,40}?(माँ|मां|मम्मी|माता|बुआ|मौसी|चाची|मामी|दादी|नानी|दीदी|बहन|mother|mummy|mommy|mom|mumma)(जी|ji)?(\s|।|$|,|\.)"
    r"|(बोल|कह|पूछ|सुन|बता|कर|आ|जा|रह)\s*रही\s*(हूँ|हूं|हु)"
    r"|(मैं|मै)\s+[^।?!.]{0,30}?(सकती|चाहती|करती|बोलती|रहती)\s*(हूँ|हूं)", re.I)
_EN_MALE = re.compile(r"\bi(?:'m| am) (?:his |her |the )?(?:father|dad|uncle|grandfather|brother)\b", re.I)
_EN_FEMALE = re.compile(r"\bi(?:'m| am) (?:his |her |the )?(?:mother|mom|mum|aunt|grandmother|sister)\b", re.I)


# The agent ASKED who is on the line ("…माता-पिता में से किससे बात कर रही हूँ?",
# "am I speaking with the father or the mother?") — the next caller turn is
# usually just the role: "पापा।", "मम्मी जी।", "Father." — or "हाँ जी" first and
# the role as a second STT final, so every caller entry up to the agent's next
# turn counts (the played transcript keeps one entry per agent turn, one per
# caller final). Counted only when the
# whole answer IS the role (+ हूँ/हैं/जी/बोल रहा/बोल रही/ack words, or "<role>
# से", below): "पापा अभी घर
# पर नहीं हैं" names someone ELSE and must not label the caller.
_ROLE_QUESTION_RE = re.compile(
    r"माता-पिता|माता पिता|मम्मी या पापा|पापा या मम्मी|पिता या माता|माता या पिता|"
    r"किससे बात कर|parent से|parents में से|father or (the )?mother|mother or (the )?father|"
    r"who am i speaking|whom am i speaking|am i speaking with the (father|mother|parent)|"
    r"आई-वडिल|आई वडिल", re.I)
_ROLE_M = frozenset({"पापा", "पिता", "पिताजी", "father", "papa", "daddy", "dad", "fatherji",
                     "वडील", "बाबा"})
_ROLE_F = frozenset({"मम्मी", "माँ", "मां", "माता", "माताजी", "mother", "mummy", "mommy", "mom",
                     "mumma", "mummyji", "आई"})
_ROLE_FILLER = frozenset({"जी", "ji", "हूँ", "हूं", "हैं", "है", "मैं", "मै", "उसका", "उसकी", "उनका",
                          "उनकी", "बच्चे", "का", "की", "बोल", "रहा", "रही", "हाँ", "हां", "हम्म",
                          "सर", "मैम", "मैडम", "yes", "haan", "i", "am", "his", "her", "the",
                          "speaking", "this", "is", "here", "बोलतोय", "बोलतेय", "आहे", "मी"})
# "<role> से" answers the question in its own shape: asked "…माता-पिता में से
# किससे बात कर रही हूँ?" (with WHOM), the mother said "माता से।" (live call
# 34452119). से is NOT a filler: it counts only right after the role (or role +
# जी) with nothing but a polite word after it — a verb after it ("पापा से बात
# करो", "मम्मी से बोल") asks for someone ELSE.
_ROLE_SE_TAIL = frozenset({"जी", "ji", "सर", "मैम", "मैडम"})


def _strip_role_se(ws: list) -> Optional[list]:
    """ws without its "से" when that से closes a "<role> से" answer; None when
    the से is anything else (someone else, a verb after it)."""
    if ws.count("से") != 1:
        return None
    i = ws.index("से")
    if any(w not in _ROLE_SE_TAIL for w in ws[i + 1:]):
        return None
    j = i - 1
    if j >= 1 and ws[j] in ("जी", "ji"):               # "माता जी से"
        j -= 1
    if j < 0 or (ws[j] not in _ROLE_M and ws[j] not in _ROLE_F):
        return None
    return ws[:i] + ws[i + 1:]


def _role_answer(text: str) -> Optional[str]:
    ws = [w.strip("।.,!?;:\"'()").casefold() for w in (text or "").split()]
    ws = [w for w in ws if w]
    if not ws or len(ws) > 6:
        return None
    if "से" in ws:
        ws = _strip_role_se(ws)
        if ws is None:
            return None
    rest = [w for w in ws if w not in _ROLE_FILLER]
    if len(rest) != 1:
        return None
    w = rest[0]
    if w in _ROLE_M:
        return "m"
    if w in _ROLE_F:
        return "f"
    return None


def gender_from_transcript(transcript) -> tuple:
    """Like gender_from_words over the caller's turns, plus the caller's ANSWER
    to a role question the agent asked (opening or a later turn)."""
    callers = [t.get("text") or "" for t in transcript or () if t.get("role") == "user"]
    g, ev = gender_from_words(callers)
    m_hit = f_hit = None
    last_bot = ""
    for t in transcript or ():
        role, text = t.get("role"), t.get("text") or ""
        if role == "assistant":
            last_bot = text
        elif role == "user":
            if _ROLE_QUESTION_RE.search(last_bot):
                r = _role_answer(text)
                if r == "m" and not m_hit:
                    m_hit = text
                elif r == "f" and not f_hit:
                    f_hit = text
    if g:                                    # a self-reference: check it against the role answer
        if (g == "m" and f_hit) or (g == "f" and m_hit):
            return None, ev
        return g, ev
    if m_hit and not f_hit:
        return "m", m_hit
    if f_hit and not m_hit:
        return "f", f_hit
    return None, (ev or m_hit or f_hit)


def gender_from_words(texts) -> tuple:
    """(gender, evidence) from the caller's turns: 'm' / 'f' / None. A call with
    cues BOTH ways (two people on the line, or an STT slip) returns None."""
    m_hit = f_hit = None
    for t in texts or ():
        t = t or ""
        if not m_hit:
            mm = _MALE_WORDS.search(t) or _EN_MALE.search(t)
            if mm:
                m_hit = mm.group(0)
        if not f_hit:
            ff = _FEMALE_WORDS.search(t) or _EN_FEMALE.search(t)
            if ff:
                f_hit = ff.group(0)
    if m_hit and not f_hit:
        return "m", m_hit
    if f_hit and not m_hit:
        return "f", f_hit
    return None, (m_hit or f_hit)



def make_probe(is_bot_speaking, echo_tail_secs: float = 0.3):
    """A pass-through FrameProcessor for right after transport.input(): feeds the
    caller's audio to a PitchTracker, never while the bot is speaking or within
    `echo_tail_secs` after (the bot's own voice echoes back from the handset).
    Forwards every frame FIRST — it can never delay the audio path."""
    import time as _time
    from pipecat.frames.frames import InputAudioRawFrame
    from pipecat.processors.frame_processor import FrameProcessor

    class CallerGenderProbe(FrameProcessor):
        def __init__(self):
            super().__init__()
            self.tracker = PitchTracker()
            self._bot_was_speaking = False
            self._bot_stopped_t = 0.0
            self._failed = False

        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            await self.push_frame(frame, direction)
            if self._failed or self.tracker.done or not isinstance(frame, InputAudioRawFrame):
                return
            try:
                speaking = bool(is_bot_speaking())
                now = _time.monotonic()
                if speaking:
                    if not self._bot_was_speaking:
                        self.tracker.reset_partial()
                elif self._bot_was_speaking:
                    self._bot_stopped_t = now
                self._bot_was_speaking = speaking
                if not speaking and now - self._bot_stopped_t >= echo_tail_secs:
                    self.tracker.add(frame.audio, frame.sample_rate)
            except Exception:
                import logging
                logging.getLogger(__name__).exception("caller-gender: probe failed — off for this call")
                self._failed = True

    return CallerGenderProbe()


def summarize(pitch: dict, transcript) -> dict:
    """The call's verdict for the report: the pitch estimate, the words cue (the
    caller's self-references and their answer to a role question), and whether
    they agree (None when either is missing) — shadow-mode evidence."""
    words, evidence = gender_from_transcript(transcript)
    p = pitch.get("gender")
    agree = None if (not words or p not in ("m", "f")) else (words == p)
    return {**pitch, "words": words, "wordsEvidence": (evidence or "")[:60], "agree": agree}
