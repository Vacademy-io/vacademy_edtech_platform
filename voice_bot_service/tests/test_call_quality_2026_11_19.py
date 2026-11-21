"""Call-quality fixes from the 2026-11-18/19 VoomSales batches (issues 8-18).

  * stage directions the model writes as its reply never reach the TTS;
  * a time only the ASSISTANT proposed is not a booking;
  * a caller who asked for a callback is not a failed call (and a voicemail's
    "call back later" is not a callback);
  * a failed analysis retries, falls back, and says why;
  * a company's own recorded greeting is not the person.

Own module, like test_report_follow_up.py, so it never conflicts with the
files everyone appends to. Local run:

    PYTHONUTF8=1 python -m pytest tests/test_call_quality_2026_11_19.py -q
"""
import dataclasses
import time

import httpx
import pytest

import app.report as rpt
from app.bot import drop_spoken_directions as strip_stage_directions
from app.turntake import is_company_ivr


class _Outcome:
    def __init__(self, transcript, dispositions=None):
        self.corr = "c"
        self.transcript = transcript
        self.crashed = False
        self.context = {"agent": {"dispositions": dispositions or []}, "instituteId": "i"}
        self.connected_at = time.time() - 10
        self.ended_at = time.time()
        self.transfer_requested = False
        self.transfer_registered = False

    def duration_seconds(self):
        return 10


def _a(text):
    return {"role": "assistant", "text": text}


def _u(text):
    return {"role": "user", "text": text}


# ── 1. stage directions ──────────────────────────────────────────────────────

@pytest.mark.parametrize("said", [
    "(silence)", "(Stay silent)", "(stays silent)",
    "(Stay silent and wait for a live person)",
    "(Stay silent and wait for the person to be connected)",
    "(Wait silently for a human to answer)", "(Wait silently for a human)",
    "Wait for a human.", "Silence.", "Stay quiet.", "[pause]",
])
def test_every_direction_seen_on_the_calls_is_dropped(said):
    assert strip_stage_directions(said) == ""


@pytest.mark.parametrize("said", [
    "Wait, let me check that for you. ",
    "One moment please.",
    "Please wait for a moment.",
    "The fee is 5000 rupees (including GST). ",
    "Hello? Are you still there?",
    "जी, मैं यहीं हूँ। ",
    "How quickly does your team call a new one back today?",
])
def test_real_speech_is_untouched(said):
    assert strip_stage_directions(said) == said


def test_a_direction_in_front_of_speech_leaves_the_speech():
    assert strip_stage_directions("(silence) Hello, are you there?") == "Hello, are you there?"
    assert strip_stage_directions("[pause] Haan ji, boliye.") == "Haan ji, boliye."


# ── 3a. a time only the assistant proposed ───────────────────────────────────

def _case_a():
    # 8d4ba02f (2026-11-19): the call ended on the bot's proposal.
    return _Outcome([
        _a("…आपके यहाँ ये सब अभी register पे होता है या किसी app पे?"),
        _u("अभी तो नहीं है।"),
        _a("…दस मिनट दिखा दूँ, कल Friday दोपहर तीन बजे?"),
    ])


def test_unanswered_proposal_is_not_a_booking():
    a = {"disposition": "Demo_Booked", "meetingRequested": True,
         "meetingDatetimeIso": "2026-11-20T15:00:00+05:30"}
    rpt._drop_unanswered_proposal(a, _case_a())
    assert a["disposition"] == "Incomplete"
    assert a["dispositionDowngradedFrom"] == "Demo_Booked"
    assert a["meetingRequested"] is False and a["meetingDatetimeIso"] is None


def test_unanswered_proposal_clears_auto_book_fields_under_any_label():
    a = {"disposition": "Interested", "meetingRequested": True,
         "meetingDatetimeIso": "2026-11-20T15:00:00+05:30"}
    rpt._drop_unanswered_proposal(a, _case_a())
    assert a["disposition"] == "Interested"
    assert a["meetingRequested"] is False and a["meetingDatetimeIso"] is None


@pytest.mark.parametrize("reply", ["haan, 5 baje theek hai", "ok done", "हाँ जी",
                                   "evening better", "Yes."])
def test_an_accepted_proposal_still_books(reply):
    o = _Outcome([_a("Demo kal 5 baje rakh doon?"), _u(reply),
                  _a("Done. Anything else I can help with?")])
    a = {"disposition": "Demo_Booked", "meetingRequested": True,
         "meetingDatetimeIso": "2026-11-20T17:00:00+05:30"}
    rpt._drop_unanswered_proposal(a, o)
    assert a["disposition"] == "Demo_Booked" and a["meetingRequested"] is True


def test_a_slot_the_caller_named_still_books():
    o = _Outcome([_a("When would suit you for a short demo?"), _u("Friday 4 pm"),
                  _a("Booked for Friday 4 pm. Thank you!")])
    a = {"disposition": "Demo_Booked", "meetingRequested": True,
         "meetingDatetimeIso": "2026-11-20T16:00:00+05:30"}
    rpt._drop_unanswered_proposal(a, o)
    assert a["disposition"] == "Demo_Booked"


def test_a_greeting_is_not_a_time_proposal():
    # "Good evening" is not an offer: the window must not open at the greeting.
    o = _Outcome([_a("Good evening, this is Aarushi."), _u("haan"),
                  _a("Can I show you a demo kal 3 baje?")])
    a = {"disposition": "Demo_Booked", "meetingRequested": True,
         "meetingDatetimeIso": "2026-11-20T15:00:00+05:30"}
    rpt._drop_unanswered_proposal(a, o)
    assert a["disposition"] == "Incomplete"


# ── 3b. callbacks ────────────────────────────────────────────────────────────

def test_callback_replaces_incomplete_with_the_agents_own_label():
    # 66e34cec (2026-11-19): callback agreed, saved Incomplete.
    o = _Outcome([_a("Is now a good time?"), _u("I'll revert back, you can call on the same number"),
                  _a("When should I call?"), _u("Tomorrow. Evening.")])
    a = {"disposition": "Incomplete", "callbackRequested": True,
         "callbackTimeText": "tomorrow evening"}
    rpt._promote_callback(a, o, ["Demo_Booked", "Follow_Up_Scheduled", "Not_Interested"])
    assert a["disposition"] == "Follow_Up_Scheduled"


def test_an_explicit_callback_label_outranks_a_generic_follow_up():
    o = _Outcome([_a("Hi"), _u("call me later please, I am driving")])
    a = {"disposition": "Incomplete", "callbackRequested": True}
    rpt._promote_callback(a, o, ["Follow_Up_Scheduled", "Interested_Callback"])
    assert a["disposition"] == "Interested_Callback"


def test_callback_never_overrides_a_decisive_label_or_invents_one():
    o = _Outcome([_a("Hi"), _u("call me later please, I am driving")])
    a = {"disposition": "Not_Interested", "callbackRequested": True}
    rpt._promote_callback(a, o, ["Follow_Up_Scheduled"])
    assert a["disposition"] == "Not_Interested"
    b = {"disposition": "Incomplete", "callbackRequested": True}
    rpt._promote_callback(b, o, ["Demo_Booked", "Not_Interested"])
    assert b["disposition"] == "Incomplete"


def test_a_voicemails_call_back_later_is_not_a_callback():
    o = _Outcome([_u("Your call has been forwarded to voicemail. Please leave a message "
                     "after the tone and we will call you back."),
                  _a("Hi, this is Aarushi from VoomSales.")])
    a = {"disposition": "Incomplete", "callbackRequested": True, "callbackTimeText": "later"}
    rpt._promote_callback(a, o, ["Callback"])
    assert a["callbackRequested"] is False and a["callbackTimeText"] is None
    assert a["disposition"] == "Incomplete"


def test_the_prompt_asks_for_a_callback_with_or_without_a_time(monkeypatch):
    seen = {}

    async def fake(s, base_url, api_key, model, prompt, corr):
        seen["prompt"] = prompt
        return {"disposition": "Incomplete"}

    monkeypatch.setattr(rpt, "_analysis_request", fake)
    import asyncio
    asyncio.run(rpt._analyze(_Outcome([_a("Hi"), _u("I'll give you a call.")])))
    p = seen["prompt"]
    assert "with or without a time" in p
    assert "booking/demo/meeting label requires" in p


# ── 3c. a failed analysis ────────────────────────────────────────────────────

def _http_error(code):
    req = httpx.Request("POST", "http://x/chat/completions")
    return httpx.HTTPStatusError("boom", request=req, response=httpx.Response(code, request=req))


def test_failed_analysis_falls_back_and_records_why(monkeypatch):
    s = dataclasses.replace(rpt.get_settings(), llm_provider="sarvam",
                            llm_fallback_provider="google", gemini_api_key="k")
    monkeypatch.setattr(rpt, "get_settings", lambda: s)
    calls = []

    async def fake(s_, base_url, api_key, model, prompt, corr):
        calls.append(model)
        if len(calls) == 1:
            raise _http_error(429)
        return {"disposition": "Interested"}

    monkeypatch.setattr(rpt, "_analysis_request", fake)
    import asyncio
    out = asyncio.run(rpt._analyze(_Outcome([_a("Hi"), _u("tell me the price")],
                                            dispositions=["Interested"])))
    assert len(calls) == 2
    assert out["disposition"] == "Interested"
    assert "HTTP 429" in out["analysisError"]


def test_analysis_failing_everywhere_says_so(monkeypatch):
    s = dataclasses.replace(rpt.get_settings(), llm_fallback_provider="")
    monkeypatch.setattr(rpt, "get_settings", lambda: s)

    async def fake(*a, **k):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(rpt, "_analysis_request", fake)
    import asyncio
    out = asyncio.run(rpt._analyze(_Outcome([_a("Hi"), _u("tell me the price")])))
    assert out["disposition"] == "Incomplete"
    assert out["analysisError"].endswith("timeout")
    assert out["followUp"] is None            # not assessed — never read as CALL
    assert "analysis failed" in out["followUpGist"]


def test_only_transient_errors_are_retried_on_the_same_model():
    assert rpt._is_transient(_http_error(429))
    assert rpt._is_transient(_http_error(503))
    assert not rpt._is_transient(_http_error(401))
    assert not rpt._is_transient(httpx.ReadTimeout("slow"))


# ── 2. the company's own recording ───────────────────────────────────────────

@pytest.mark.parametrize("line", [
    "Welcome to Alma Better, a one-stop destination",
    "This call will be recorded for monitoring and training purposes.",
    "Thank you for calling Learnbay.",
    "Your call is important to us.",
    "Press 1 for admissions.",
])
def test_company_recordings_are_recognised(line):
    assert is_company_ivr(line)


@pytest.mark.parametrize("line", [
    "Hello, welcome to Sunrise School, how may I help you?",
    "Thank you for calling, boliye",
    "Hello?",
    "हाँ जी बोलिए",
    "We are in the queue for admissions",
])
def test_a_person_is_never_a_company_recording(line):
    assert not is_company_ivr(line)


def test_fallback_is_skipped_once_the_primary_used_the_budget(monkeypatch):
    # A pod restart during a long analysis loses the report outright: the fallback
    # only runs while there is time left, so the worst case stays near the old one.
    s = dataclasses.replace(rpt.get_settings(), llm_provider="sarvam",
                            llm_fallback_provider="google", gemini_api_key="k")
    monkeypatch.setattr(rpt, "get_settings", lambda: s)
    clock = [1000.0]
    monkeypatch.setattr(rpt.time, "monotonic", lambda: clock[0])
    calls = []

    async def fake(*a, **k):
        calls.append(1)
        clock[0] += rpt._FALLBACK_BUDGET_SECS + 1
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(rpt, "_analysis_request", fake)
    import asyncio
    out = asyncio.run(rpt._analyze(_Outcome([_a("Hi"), _u("tell me the price")])))
    assert len(calls) == 1
    assert out["disposition"] == "Incomplete"
    assert "skipped" in out["analysisError"]


def test_a_receptionist_greeting_then_hello_ends_the_hold():
    # "Welcome to Sunrise School." alone reads as the recording, but the person's
    # next "Hello?" is never absorbed into the hold: they get the opening again.
    from app.turntake import hold_absorbs, sounds_like_person
    assert is_company_ivr("Welcome to Sunrise School.")
    for line in ("Hello?", "Hello, who is this?", "जी बोलिए", "Yes, tell me"):
        assert not hold_absorbs(line, 1.0)
        assert sounds_like_person(line) or "?" in line or len(line.split()) > 2


# ── "Interested" the caller never showed ─────────────────────────────────────

_PITCH = "Main Vidya Academy se bol rahi hoon, hamare naye NEET batch ke baare mein batana tha."


def _interest(caller_lines, label="Interested", **extra):
    turns = [_a(_PITCH)]
    for line in caller_lines:
        turns += [_u(line), _a("Ji, bilkul.")]
    analysis = {"disposition": label, **extra}
    rpt._drop_unevidenced_interest(analysis, _Outcome(turns))
    return analysis


@pytest.mark.parametrize("caller", [
    ["Hello?", "Haan ji", "Kaun bol raha hai?", "Okay."],          # listened, asked who
    ["Hello", "Where are you calling from?", "Hmm, okay"],
    ["Abhi main busy hoon, baad mein call karna."],                 # busy is a callback
    ["Main driving kar raha hoon", "Haan"],
    ["Not interested, thank you."],                                 # refusal
    ["Nahi chahiye ji, already joined somewhere else."],
    ["हाँ जी", "कौन बोल रहा है?", "अभी नहीं, बाद में"],
    ["नहीं चाहिए"],
])
def test_interested_without_the_callers_interest_is_dropped(caller):
    out = _interest(caller)
    assert out["disposition"] == "Incomplete"
    assert out["dispositionDowngradedFrom"] == "Interested"


@pytest.mark.parametrize("caller", [
    ["Fees kitni hai?"],
    ["Haan", "WhatsApp pe details bhej do"],
    ["Mujhe NEET coaching chahiye beta ke liye"],
    ["Online hai ya offline?"],
    ["Interested hoon, bataiye"],
    ["Abhi busy hoon, but course ki details send kar dijiye"],     # busy AND interest
    ["फीस कितनी है?"],
    ["मुझे जानकारी भेज दीजिए"],
    # A long, substantive answer with no keyword is left to the model.
    ["Mera beta abhi class eleven mein hai aur woh pichle saal se ghar pe khud padh raha hai"],
])
def test_real_interest_keeps_the_label(caller):
    assert _interest(caller)["disposition"] == "Interested"


def test_likely_interested_is_checked_too_and_other_labels_are_not():
    assert _interest(["Hello", "Kaun?"], label="Likely_Interested")["disposition"] == "Incomplete"
    for label in ("Not_Interested", "Uninterested", "Demo_Booked", "Callback", "Incomplete"):
        assert _interest(["Hello", "Kaun?"], label=label)["disposition"] == label


def test_an_agreed_meeting_keeps_interested():
    out = _interest(["Haan", "Theek hai"], meetingRequested=True,
                    meetingDatetimeIso="2026-11-22T16:00:00+05:30")
    assert out["disposition"] == "Interested"


def test_a_busy_caller_downgraded_from_interested_becomes_a_callback():
    turns = [_a(_PITCH), _u("Abhi busy hoon, kal call karna")]
    outcome = _Outcome(turns, dispositions=["Interested", "Callback", "Not_Interested"])
    analysis = {"disposition": "Interested", "callbackRequested": True}
    rpt._drop_unevidenced_interest(analysis, outcome)
    rpt._promote_callback(analysis, outcome, ["Interested", "Callback", "Not_Interested"])
    assert analysis["disposition"] == "Callback"


def test_the_prompt_defines_interest(monkeypatch):
    seen = {}

    async def fake(s_, base_url, api_key, model, prompt, corr):
        seen["prompt"] = prompt
        return {"disposition": "Incomplete"}

    monkeypatch.setattr(rpt, "_analysis_request", fake)
    import asyncio
    asyncio.run(rpt._analyze(_Outcome([_a("Hi"), _u("tell me the price")])))
    assert "asking who is calling" in seen["prompt"]


@pytest.mark.parametrize("caller", [["CBSE"], ["Class 11"], ["Haan", "Delhi"], ["Science stream"]])
def test_a_short_answer_to_a_qualifying_question_keeps_interested(caller):
    # One word answering "which board?" is the caller engaging — only a caller who
    # said nothing beyond hello / ok / who is this / busy loses the label.
    assert _interest(caller)["disposition"] == "Interested"
