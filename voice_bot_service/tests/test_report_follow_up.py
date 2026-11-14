"""Follow-up gist + measured caller engagement (V510) — report.py.

The gist is ONE sentence for the counsellor deciding whether to call this lead
themselves: the recommendation and the concrete reason from the call. It is not
a grade of our agent and not the disposition restated. followUp only colours it
and feeds a filter; it is never shown as a word on its own.

Lives in its own module on purpose. test_call_behavior.py is appended to by
several people a day, and a block of tests at its tail conflicted with main on
every rebase (three times in 24 h for this change alone). Nothing here depends
on that file: the outcome stub below is a local copy of its _ConvOutcome.

Run inside the service container, or locally per the voice-bot test notes:

    PYTHONUTF8=1 python -m pytest tests/test_report_follow_up.py -q
"""
import time

import pytest

import app.report as rpt


class _ConvOutcome:
    """Minimal CallOutcome stand-in — the fields report.py reads and nothing else."""

    def __init__(self, transcript):
        self.corr = "c"
        self.transcript = transcript
        self.crashed = False
        self.context = {"agent": {}, "instituteId": "i"}
        self.connected_at = time.time() - 10
        self.ended_at = time.time()
        self.transfer_requested = False
        self.transfer_registered = False

    def duration_seconds(self):
        return 10


def test_follow_up_is_a_closed_vocabulary_and_null_means_not_assessed():
    for spoken, want in (("CALL", "CALL"), ("call", "CALL"), ("call later", "CALL_LATER"),
                         ("Call-Later", "CALL_LATER"), ("SKIP", "SKIP")):
        a = {"followUp": spoken, "followUpGist": "Worth a call."}
        rpt._sanitize_follow_up(a, "c")
        assert a["followUp"] == want, spoken
    # An invented level must become NULL (not assessed) — never reach the UI as a
    # mystery string, and never be coerced UP to CALL.
    for bad in ("MAYBE", "yes", "", None, 7):
        a = {"followUp": bad, "followUpGist": "x"}
        rpt._sanitize_follow_up(a, "c")
        assert a["followUp"] is None, bad


def test_follow_up_gist_is_one_line_and_capped():
    a = {"followUp": "CALL",
         "followUpGist": "  Worth a call —\n runs a 50-member hybrid studio,\n\nasked about pricing.  "}
    rpt._sanitize_follow_up(a, "c")
    assert a["followUpGist"] == "Worth a call — runs a 50-member hybrid studio, asked about pricing."
    long = {"followUp": "SKIP", "followUpGist": "x" * 500}
    rpt._sanitize_follow_up(long, "c")
    assert len(long["followUpGist"]) <= rpt._GIST_MAX_CHARS
    assert long["followUpGist"].endswith("…")
    empty = {"followUp": "CALL", "followUpGist": "   "}
    rpt._sanitize_follow_up(empty, "c")
    assert empty["followUpGist"] is None


def test_caller_word_count_is_measured_from_real_caller_turns_only():
    o = _ConvOutcome([
        {"role": "assistant", "text": "Hi, is this Shweta? Aarushi from Vacademy."},
        {"role": "user", "text": "Hello."},
        {"role": "user", "text": "[unclear sound from the caller]"},   # synthetic cue
        {"role": "user", "text": "Yes, we run hybrid classes on Zoom."},
    ])
    assert rpt._caller_word_count(o) == 8
    assert rpt._caller_word_count(_ConvOutcome([])) == 0
    assert rpt._caller_word_count(_ConvOutcome([{"role": "assistant", "text": "a b c"}])) == 0


@pytest.mark.asyncio
async def test_report_always_carries_follow_up_and_word_count(monkeypatch):
    """Every path — analysed, gated, degraded — must emit the keys explicitly, so a
    missing key is never mistaken downstream for an assessed-and-empty one."""
    posted = []

    async def capture(inst, tok, payload):
        posted.append(payload)
        return True

    monkeypatch.setattr(rpt.admin_core, "post_report", capture)

    # 1. Analysed path: the model's recommendation flows through, sanitised.
    async def analysed(o):
        return {"disposition": "Not_Interested", "followUp": "skip",
                "followUpGist": "Skip — runs in-person only and said online is not for them."}
    monkeypatch.setattr(rpt, "_analyze", analysed)
    await rpt.build_and_post_report(_ConvOutcome([
        {"role": "user", "text": "no thanks, we only do in-person classes here"}]), "cu1")
    p = posted[-1]
    assert p["followUp"] == "SKIP"
    assert p["followUpGist"].startswith("Skip —")
    assert p["callerWordCount"] == 8

    # 2. Substance-gated path: no analysis ran, so no recommendation (null), the
    #    gist says in plain words why and what happens next, and the measured count
    #    is still present.
    async def never(o):
        raise AssertionError("classifier must not run on a greeting-only call")
    monkeypatch.setattr(rpt, "_analyze", never)
    await rpt.build_and_post_report(_ConvOutcome([{"role": "user", "text": "Hello."}]), "cu2")
    p = posted[-1]
    assert p["followUp"] is None
    assert p["followUpGist"].startswith("Nothing to go on")
    assert "no manual call needed yet" in p["followUpGist"]
    assert p["callerWordCount"] == 1
    assert "callerWordCount" in p and "followUp" in p and "followUpGist" in p
