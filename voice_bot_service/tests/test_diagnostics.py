"""Tests for the per-call technical diagnostics (app/diagnostics.py).

Verdicts are driven directly like the callstate harness; metrics routing also
exercises the Pipecat observer. Each verdict test encodes a flagged call, so the panel can
never silently stop naming the fault that call actually had.
"""
import pytest
import app.diagnostics as dg


# ── the fault vocabulary is a STORED contract ────────────────────────────────

def test_fault_codes_are_frozen_and_append_only():
    """Renaming a code silently breaks every row already persisted, and every
    saved filter. Adding is fine; changing/removing must fail here."""
    assert set(dg.ALL_FAULTS) >= {
        "CRASH", "TTS_WEDGE", "REPLY_UNPLAYED", "ANSWER_DELETED", "DEAD_AIR",
        "FALSE_REASK", "LIKELY_MACHINE", "STT_DEAF", "SLOW_TTS", "SLOW_LLM",
        "TRANSFER_FAILED", "PROMPT_UNFILLED",
    }
    assert len(set(dg.ALL_FAULTS)) == len(dg.ALL_FAULTS)   # no duplicates
    assert set(dg.HEADLINE_PRIORITY) == set(dg.ALL_FAULTS)  # priority is total
    for code in dg.ALL_FAULTS:
        assert code in dg._HEADLINE_TEXT, f"{code} has no human-readable headline"


def test_clean_call_is_green_with_no_faults():
    d = dg.CallDiagnostics(user_turns=6, bot_turns=6, replies_generated=6)
    v = dg.verdict(d)
    assert v["health"] == dg.GREEN
    assert v["faults"] == {} and v["headline"] is None


# ── the founder's call 19 (Kyoto): TTS wedge -> 10.4s dead air ───────────────

def test_kyoto_call_is_red_tts_wedge():
    d = dg.CallDiagnostics(
        tts_wedges=3, tts_wedge_reconnects=3, tts_stalls=3,
        tts_silent_generations=3, user_turns=7, bot_turns=7,
    )
    d.sample("dead_air", 10.39)
    d.sample("dead_air", 8.11)
    v = dg.verdict(d)
    assert v["health"] == dg.RED
    assert v["headline"] == dg.TTS_WEDGE          # outranks DEAD_AIR
    assert v["faults"][dg.DEAD_AIR] == dg.RED     # …but both are reported
    p = dg.to_payload(d)
    assert p["tts"]["stalls"] == 3
    assert p["latency"]["deadAirMax"] == 10.39
    assert "Voice synthesis stalled" in p["headlineText"]


# ── the founder's call 20 (Nia): announcement generated, never played ────────

def test_unplayed_reply_is_flagged():
    d = dg.CallDiagnostics(replies_generated=4, replies_never_played=2,
                           user_turns=3, bot_turns=2)
    v = dg.verdict(d)
    assert v["health"] == dg.RED and v["headline"] == dg.REPLY_UNPLAYED


# ── "answers need to be repeated" ───────────────────────────────────────────

def test_deleted_answers_named_not_just_counted():
    d = dg.CallDiagnostics(user_turns=5, bot_turns=5)
    for ans in ("IGCSE", "Symbiosis.", "Monday."):
        d.note_deleted_answer(ans)
    v = dg.verdict(d)
    assert v["health"] == dg.RED and v["headline"] == dg.ANSWER_DELETED
    p = dg.to_payload(d)
    assert p["turnTaking"]["answersDeleted"] == 3
    assert "IGCSE" in p["turnTaking"]["answersDeletedSamples"]
    assert p["turnTaking"]["answersDeletedSrc"] == "measured"


def test_unmeasured_answers_are_null_never_zero():
    """The single most important honesty rule: 'we did not check' must never
    render as 'we checked and it was fine'."""
    d = dg.CallDiagnostics(user_turns=4, bot_turns=4)
    assert d.answers_deleted is None
    v = dg.verdict(d)
    assert dg.ANSWER_DELETED not in v["faults"]      # cannot fire when unknown
    p = dg.to_payload(d)
    assert p["turnTaking"]["answersDeleted"] is None
    assert p["turnTaking"]["answersDeletedSrc"] is None


# ── the 72% false re-asks ───────────────────────────────────────────────────

def test_false_reasks_flagged_and_true_reasks_are_not():
    d = dg.CallDiagnostics(orphan_reasks=4, orphan_false_reasks=3)
    assert dg.verdict(d)["faults"][dg.FALSE_REASK] == dg.RED
    honest = dg.CallDiagnostics(orphan_reasks=2, orphan_false_reasks=0)
    assert dg.FALSE_REASK not in dg.verdict(honest)["faults"]


# ── voicemail: evidence only, never a disposition change in v1 ──────────────

def test_machine_score_and_amber():
    d = dg.CallDiagnostics(user_turns=1, bot_turns=3, longest_user_secs=9.0,
                           machine_markers=["forwarded to voicemail"])
    assert dg.machine_score(d) >= 0.7
    v = dg.verdict(d)
    assert dg.LIKELY_MACHINE in v["faults"]
    assert dg.to_payload(d)["machine"]["src"] == "inferred"


def test_human_call_is_not_flagged_as_machine():
    d = dg.CallDiagnostics(user_turns=8, bot_turns=8, longest_user_secs=2.5,
                           barge_ins=2)
    assert dg.machine_score(d) < 0.5
    assert dg.LIKELY_MACHINE not in dg.verdict(d)["faults"]


def test_screener_then_a_person_is_not_a_machine():
    """Calls b5b43ae1 / 34452119 (2026-10-02): Google's call screen spoke
    first, then a parent talked through a 2-minute call — and both were AMBER
    "Probably an answering machine" on the screener's marker alone."""
    d = dg.CallDiagnostics(user_turns=18, bot_turns=12, longest_user_secs=3.1,
                           barge_ins=2, tts_chars=1800,
                           machine_markers=["record your name", "reason for calling"],
                           person_turns=8)
    assert dg.machine_score(d) < 0.5
    v = dg.verdict(d)
    assert dg.LIKELY_MACHINE not in v["faults"] and v["health"] == dg.GREEN, v
    p = dg.to_payload(d)
    # the screener is still on record as evidence, with what outweighed it
    assert p["machine"]["markers"] == ["record your name", "reason for calling"]
    assert p["machine"]["personTurns"] == 8


def test_marker_still_counts_when_nobody_answered_past_it():
    """A screen with nobody behind it still relays a line or two (787aa111
    scored 2), and an unmeasured count must not read as a person."""
    for person in (None, 0, 2):
        d = dg.CallDiagnostics(user_turns=8, bot_turns=3, tts_chars=300,
                               machine_markers=["record your name"], person_turns=person)
        assert dg.verdict(d)["faults"].get(dg.LIKELY_MACHINE) == dg.AMBER, person
    assert dg.to_payload(dg.CallDiagnostics())["machine"]["personTurns"] is None


# ── latency needs a sample floor before it accuses anyone ───────────────────

def test_slow_faults_require_enough_samples():
    d = dg.CallDiagnostics()
    for _ in range(3):
        d.sample("tts_ttfb", 9.0)          # awful, but only 3 samples
    assert dg.SLOW_TTS not in dg.verdict(d)["faults"]
    for _ in range(5):
        d.sample("tts_ttfb", 9.0)
    assert dg.verdict(d)["faults"][dg.SLOW_TTS] == dg.RED


def test_prompt_unfilled_is_amber_never_red():
    d = dg.CallDiagnostics(user_turns=5, bot_turns=5)
    d.note_unfilled("child_name")
    v = dg.verdict(d)
    assert v["faults"][dg.PROMPT_UNFILLED] == dg.AMBER
    assert v["health"] == dg.AMBER          # a config bug never reads as breakage


def test_crash_always_red_and_outranks_everything():
    d = dg.CallDiagnostics(crash="RuntimeError: boom", tts_stalls=3)
    v = dg.verdict(d)
    assert v["health"] == dg.RED and v["headline"] == dg.CRASH


# ── bounds + totality: this runs on a 1-vCPU box during live calls ──────────

def test_reservoirs_and_lists_are_bounded():
    d = dg.CallDiagnostics()
    for i in range(5000):
        d.sample("dead_air", i * 0.001)
        d.note_unfilled(f"k{i}")
        d.note_deleted_answer("x" * 200)
    assert len(d.dead_air) <= dg._MAX_SAMPLES
    assert len(d.prompt_unfilled) <= dg._MAX_UNFILLED_KEYS
    assert len(d.answers_deleted_samples) <= dg._MAX_DELETED_ANSWERS
    assert d.answers_deleted == 5000                  # counted, not stored
    assert all(len(x) <= 60 for x in d.answers_deleted_samples)


def test_hooks_never_raise_on_bad_input():
    d = dg.CallDiagnostics()
    d.bump("does_not_exist")
    d.sample("does_not_exist", 1.0)
    d.sample("dead_air", "not-a-number")
    d.note_unfilled(None)
    assert isinstance(dg.to_payload(d), dict)


def test_to_payload_is_total_even_on_corrupt_state():
    d = dg.CallDiagnostics()
    d.tts_ttfb = "corrupt"                            # type: ignore[assignment]
    p = dg.to_payload(d)
    assert isinstance(p, dict) and "rulesVersion" in p


def test_payload_is_json_serialisable_and_small():
    import json
    d = dg.CallDiagnostics(user_turns=9, bot_turns=9, tts_stalls=1)
    for i in range(300):
        d.sample("tts_ttfb", 0.2)
        d.sample("dead_air", 1.0)
    blob = json.dumps(dg.to_payload(d))
    assert len(blob) < 4096, f"diagnostics blob too fat: {len(blob)}B"


# ── slice 2: reconciliation — the ground truth for "answers need repeating" ──

def test_reconcile_names_the_deleted_answer():
    """The live shape: caller said IGCSE, the aggregator deleted it, the model
    never saw it, and the bot carried on as if nothing was said."""
    heard = ["Yes", "IGCSE", "Symbiosis."]
    delivered = ["Yes", "Symbiosis."]          # IGCSE never reached the model
    n, samples = dg.reconcile_answers(heard, delivered)
    assert n == 1 and samples == ["IGCSE"]


def test_reconcile_is_punctuation_and_case_insensitive():
    n, _ = dg.reconcile_answers(["SSC."], ["ssc"])
    assert n == 0, "a formatting difference must not read as a deleted answer"


def test_reconcile_multiset_handles_genuine_repeats():
    # Caller said it twice, model got it once -> exactly one was lost.
    n, samples = dg.reconcile_answers(["SSC.", "SSC."], ["SSC."])
    assert n == 1 and samples == ["SSC."]
    # Both delivered -> nothing lost.
    assert dg.reconcile_answers(["SSC.", "SSC."], ["SSC.", "ssc"])[0] == 0


def test_reconcile_clean_call_reports_zero_not_none():
    n, samples = dg.reconcile_answers(["CBSE", "DPS"], ["CBSE", "DPS"])
    assert n == 0 and samples == []


def test_reconcile_ignores_empty_and_whitespace():
    n, _ = dg.reconcile_answers(["", "   ", "CBSE"], ["CBSE"])
    assert n == 0


def test_reconciled_count_drives_the_fault():
    d = dg.CallDiagnostics(user_turns=5, bot_turns=5)
    n, samples = dg.reconcile_answers(["IGCSE", "Symbiosis.", "Monday."], [])
    d.answers_deleted, d.answers_deleted_samples = n, samples
    v = dg.verdict(d)
    assert v["health"] == dg.RED and v["headline"] == dg.ANSWER_DELETED
    assert dg.to_payload(d)["turnTaking"]["answersDeletedSrc"] == "measured"


# ── REGRESSION 2026-08-03: a false SLOW_TTS on the founder's own call ────────
# "ResilientSarvamSTTService".lower() CONTAINS the substring "tts"
# (...sarvams-TTS-ervice), so routing that tested "tts" before "stt" filed every
# STT latency into the TTS reservoir. The panel's first live call reported
# SLOW_TTS while the real TTS times were all ~0.2s.

@pytest.mark.asyncio
@pytest.mark.parametrize("processor,bucket", [
    ("ResilientSarvamSTTService#0", "stt_ttfb"),
    ("SarvamSTTService#1", "stt_ttfb"),
    ("SmallestSTTService#0", "stt_ttfb"),
    ("SmallestTTSService#1", "tts_ttfb"),
    ("ResilientSarvamTTSService#0", "tts_ttfb"),
    ("GoogleTTSService#1", "tts_ttfb"),
    ("OpenAILLMService#2", "llm_ttfb"),
])
async def test_ttfb_routing_discriminates_stt_from_tts(processor, bucket):
    from types import SimpleNamespace
    from app.bot import TtfbObserver
    from pipecat.frames.frames import MetricsFrame
    from pipecat.metrics.metrics import TTFBMetricsData
    diag = dg.CallDiagnostics()
    observer = TtfbObserver("test", diag).observer
    data = SimpleNamespace(frame=MetricsFrame(data=[TTFBMetricsData(processor=processor, value=0.25)]))
    await observer.on_push_frame(data)
    await observer.on_push_frame(data)  # another pipeline hop must not duplicate it
    for name in ("stt_ttfb", "tts_ttfb", "llm_ttfb"):
        assert getattr(diag, name) == ([0.25] if name == bucket else [])


# ── a dial nobody answered is NOT a broken call ─────────────────────────────
# Live: userTurns=0, bot greeted + nudged + hung up, deadAirMax 8.8s -> verdict
# RED "Long silence during the call". The status already says no-answer; calling
# it Broken makes every unanswered dial look like a system failure.

def test_no_caller_turn_means_dead_air_is_not_a_fault():
    d = dg.CallDiagnostics(user_turns=0, bot_turns=3, replies_generated=3,
                           idle_hangup=True, nudges=1)
    d.sample("dead_air", 8.806)
    v = dg.verdict(d)
    assert dg.DEAD_AIR not in v["faults"]
    assert v["health"] == dg.GREEN, "an unanswered dial is not a broken bot"


def test_dead_air_still_fires_in_a_real_conversation():
    d = dg.CallDiagnostics(user_turns=4, bot_turns=4)
    d.sample("dead_air", 8.8)
    assert dg.verdict(d)["faults"][dg.DEAD_AIR] == dg.RED


def test_cannot_hear_outranks_a_tts_stall_in_the_headline():
    """Live 393859bc read "Voice synthesis stalled" while the real story was that
    the caller repeated "hybrid model" four times and we never transcribed it."""
    d = dg.CallDiagnostics(user_turns=10, bot_turns=14,
                           hearing_failures=1, stt_reconnects=4, tts_stalls=2)
    v = dg.verdict(d)
    assert v["faults"][dg.STT_DEAF] == dg.RED
    assert v["headline"] == dg.STT_DEAF, "the caller's experience was 'it cannot hear me'"
    assert "could not hear" in dg.to_payload(d)["headlineText"]


def test_giving_up_on_hearing_is_always_red():
    d = dg.CallDiagnostics(user_turns=3, bot_turns=5, hearing_failures=1)
    assert dg.verdict(d)["faults"][dg.STT_DEAF] == dg.RED


def test_spoke_but_never_transcribed_is_red_not_green():
    """Live call 2dcad5f2 scored GREEN "No faults detected" while the caller said
    "Hello" SEVEN times and STT returned nothing: user_turns==0 suppressed
    DEAD_AIR (right for an unanswered dial) and no reconnect ever happened."""
    d = dg.CallDiagnostics(user_turns=0, bot_turns=2, unheard_utterances=1,
                           stt_reconnects=0, hearing_failures=0)
    d.sample("dead_air", 7.64)
    v = dg.verdict(d)
    assert v["health"] == dg.RED
    assert v["headline"] == dg.STT_DEAF
    assert dg.to_payload(d)["infra"]["unheardUtterances"] == 1


def test_genuinely_unanswered_dial_stays_green():
    """The case the suppression exists for must still work: no caller speech at
    all — no VAD utterances, nothing to transcribe."""
    d = dg.CallDiagnostics(user_turns=0, bot_turns=3, unheard_utterances=0)
    d.sample("dead_air", 8.8)
    assert dg.verdict(d)["health"] == dg.GREEN

def test_vendor_meter_of_zero_is_not_reported_as_free():
    """Rumik returns credits_used: 0 on our current key. 0 and "unmetered" are
    indistinguishable, and reporting a 0 as real spend would be a lie we then
    bill on — so credits stay None while the metered-request count still proves
    the frames arrived."""
    d = dg.CallDiagnostics()
    d.note_tts_spend(0.0, 5.8, 96)
    d.note_tts_spend(0.0, 4.9, 80)
    out = dg.to_payload(d)["tts"]
    assert out["vendorCredits"] is None, "a zero meter must not read as zero cost"
    assert out["meteredRequests"] == 2, "but we must show the meter DID report"
    assert out["audioSecs"] == 10.7 and out["chars"] == 176


def test_vendor_meter_accumulates_when_real():
    d = dg.CallDiagnostics()
    d.note_tts_spend(0.55, 5.8, 96)
    d.note_tts_spend(0.21, 2.0, 40)
    assert dg.to_payload(d)["tts"]["vendorCredits"] == 0.76


def test_note_tts_spend_never_raises_into_the_call():
    d = dg.CallDiagnostics()
    d.note_tts_spend("junk", None, "x")   # must not raise
    d.note_tts_spend(None, None)
    assert dg.to_payload(d)["health"] is not None


def test_reconcile_join_aware_fragments_are_not_deleted():
    """Live ae7d3069: Saaras split 'नहीं जान सकते हैं आप' into fragment finals;
    the aggregator joined them into ONE context message; per-final matching
    counted every fragment deleted on a call the model demonstrably followed."""
    heard = ["नहीं जान।", "सकते हैं आप।", "IGCSE"]
    delivered = ["नहीं जान। सकते हैं आप।"]      # joined; IGCSE truly lost
    n, samples = dg.reconcile_answers(heard, delivered)
    assert n == 1 and samples == ["IGCSE"]


def test_reconcile_containment_consumes_spans():
    # The joined message can cover each fragment once — a REPEATED fragment
    # still needs its own copy.
    n, samples = dg.reconcile_answers(
        ["Symbiosis.", "Symbiosis."], ["haan Symbiosis. accha"])
    assert n == 1 and samples == ["Symbiosis."]


def test_reconcile_short_keys_never_containment_match():
    # 'हाँ।' normalizes to a 2-char key; containment would find it inside half
    # the transcript and hide REAL deletions of short acks.
    n, _ = dg.reconcile_answers(["हाँ।"], ["हाय। इफ यू रिकॉर्ड योर नेम।"])
    assert n == 1


def test_reconcile_short_answers_inside_a_joined_message_are_delivered():
    """Live ee6f561c (2026-09-11): four saaras finals joined by the aggregator
    into one message the model demonstrably answered ("fifth class") — and
    'ठीक।' was reported DELETED because its 2-char key is below the substring
    floor. Whole-word matching places it. Over 7 days 'Yes.' x8 / 'हाँ।' x3 /
    'Yeah.' x3 were the top "deleted answers" for the same reason."""
    heard = ["But.", "बच्चा भी।", "ठीक।", "fifth class में पढ़ रहा है।"]
    delivered = ["But. बच्चा भी। ठीक। fifth class में पढ़ रहा है।"]
    lost = dg.split_lost(heard, delivered)
    assert (lost.answers, lost.fragments) == (0, 0), lost
    assert dg.reconcile_answers(["Yes, speak.", "Yes."], ["Yes, speak. Yes."])[0] == 0
    assert dg.reconcile_answers(["हाँ।", "जी।", "दीदी से।"], ["हाँ। जी। दीदी से।"])[0] == 0


def test_reconcile_short_answers_are_whole_words_and_consumed_once():
    # A word is spoken for once: a second 'Yes.' still needs its own copy...
    n, samples = dg.reconcile_answers(["Yes.", "Yes."], ["Okay. Yes."])
    assert (n, samples) == (1, ["Yes."])
    # ...and a genuinely undelivered 'Yes.' is still a loss.
    assert dg.reconcile_answers(["Yes."], ["I will call you back tomorrow."])[0] == 1
    # Whole words only: 'yes' is not inside 'yesterday'.
    assert dg.reconcile_answers(["Yes."], ["I said yesterday."])[0] == 1


def test_reconcile_exact_matched_message_not_reused_as_span():
    # A delivered message consumed by exact matching is spoken for — it must
    # not ALSO absorb a fragment via containment.
    n, _ = dg.reconcile_answers(
        ["Symbiosis school", "Symbiosis"], ["Symbiosis school"])
    assert n == 1


def test_bot_silent_fires_when_the_caller_spoke_but_we_never_did():
    """The pipecat 1.4 migration shipped a MUTE bot (Rumik run_tts signature
    drift) and the panel blamed LIKELY_MACHINE — the actual story, "we never
    said a word", was nowhere. This fault makes that class of outage loud."""
    d = dg.CallDiagnostics(user_turns=4, bot_turns=0, tts_chars=0)
    v = dg.verdict(d)
    assert v["health"] == dg.RED
    assert v["headline"] == dg.BOT_SILENT
    assert "never spoke" in dg.to_payload(d)["headlineText"]


def test_bot_silent_outranks_likely_machine():
    d = dg.CallDiagnostics(user_turns=4, bot_turns=0, tts_chars=0,
                           longest_user_secs=6.3,
                           machine_markers=["record your name"])
    v = dg.verdict(d)
    assert dg.LIKELY_MACHINE in v["faults"]      # still reported…
    assert v["headline"] == dg.BOT_SILENT        # …but not the headline


def test_bot_silent_never_fires_on_an_unanswered_dial():
    """No caller turn = nobody to speak to; the status already says no-answer."""
    d = dg.CallDiagnostics(user_turns=0, bot_turns=0, tts_chars=0)
    assert dg.BOT_SILENT not in dg.verdict(d)["faults"]


def test_bot_silent_quiet_on_a_healthy_call():
    d = dg.CallDiagnostics(user_turns=5, bot_turns=5, tts_chars=800)
    assert dg.BOT_SILENT not in dg.verdict(d)["faults"]


# ── REPLY_LOOP (call 77cb4b47, 2026-08-06) ────────────────────────────────
_REAL_LOOP = [
    "Hello? Kya aap sun paa rahe hain?",
    "Shreyash ji, main pooch raha tha ki Raman ke last annual exam mein kitne marks aaye the?",
    "Shreyash ji, main puch raha tha ki Raman ke last annual exam mein kitne marks aaye the?",
    "Shreyash ji, main pooch raha tha ki Raman ke last annual exam mein kitne marks aaye the?",
    "Hmm…",
    "Shreyash ji, main pooch raha tha ki Raman ke last annual exam mein kitne marks aaye the?",
]


def test_max_reply_restarts_catches_the_call_it_was_built_for():
    """Verbatim bot utterances from the Mumbai box log, 08:27:00.9-08:27:14.4.
    An exact-prefix version of this scored ZERO here (the model rendered one as
    'main puch' instead of 'main pooch') and a 'Hmm…' in the middle reset the
    run — both had to be handled or the detector was decorative."""
    t = [{"role": "assistant", "text": x} for x in _REAL_LOOP]
    assert dg.max_reply_restarts(t) == 4


def test_a_normal_conversation_scores_one():
    t = [{"role": "assistant", "text": x} for x in [
        "Theek hai, Raman abhi kis class mein hai?",
        "Eighth class mein hai, theek hai. Last annual exam mein uske kitne marks aaye the?",
        "Achha, maths aur science dono mein dikkat hai. 60-75% sabse common situation hai.",
    ]]
    assert dg.max_reply_restarts(t) == 1


def test_reply_loop_fault_fires_red_on_that_call():
    diag = dg.CallDiagnostics()
    diag.max_reply_restarts = 4
    v = dg.verdict(diag)
    assert v["faults"][dg.REPLY_LOOP] == dg.RED
    assert dg._HEADLINE_TEXT[dg.REPLY_LOOP]


def test_every_bump_call_site_names_a_real_counter():
    """bump() is getattr/setattr inside a bare except: a misspelled counter
    counts NOTHING, raises nothing, and every test still passes. This bit for
    real on 2026-08-06 — the new carrier counter was written camelCase at the
    call site against a snake_case field and a green suite said nothing.

    So read the ACTUAL call sites out of bot.py (and providers.py, whose
    service wrappers bump through set_diagnostics) rather than restating a list
    here, which would just be a second place to make the same typo."""
    import pathlib
    import re
    app = pathlib.Path(__file__).resolve().parents[1] / "app"
    names = set()
    for module in ("bot.py", "providers.py"):
        src = (app / module).read_text()
        found = set(re.findall(r'\.bump\(\s*["\']([A-Za-z_]+)["\']', src))
        assert found, f"found no bump() call sites in {module} — the regex broke, not the code"
        names |= found
    assert "tts_silent_resumes" in names
    diag = dg.CallDiagnostics()
    for name in sorted(names):
        before = getattr(diag, name, None)
        assert before is not None, f"bot.py bumps {name!r} but no such counter exists"
        diag.bump(name)
        assert getattr(diag, name) == before + 1, name


def test_silent_resumes_reach_the_payload():
    """providers._silent_context_resume (call c6847f91): a paused TTS ended a
    line with no audio and was resumed so the reply could play."""
    diag = dg.CallDiagnostics()
    assert dg.to_payload(diag)["tts"]["silentResumes"] == 0
    diag.bump("tts_silent_resumes")
    assert dg.to_payload(diag)["tts"]["silentResumes"] == 1


def test_carrier_and_restart_counters_reach_the_payload():
    diag = dg.CallDiagnostics()
    diag.carrier_announcements = 2
    diag.max_reply_restarts = 4
    p = dg.to_payload(diag)
    assert p["turnTaking"]["carrierAnnouncements"] == 2
    assert p["turnTaking"]["maxReplyRestarts"] == 4


def test_headline_never_picks_an_amber_over_a_red():
    """Call 14029bd6: banner said RED (LIKELY_MACHINE) while the sentence under
    it described an AMBER two-restart blip, because REPLY_LOOP sits higher in
    HEADLINE_PRIORITY. Severity has to win first."""
    diag = dg.CallDiagnostics()
    diag.max_reply_restarts = 2                     # -> REPLY_LOOP AMBER
    diag.machine_score, diag.machine_markers = 0.7, ["voicemail"]
    v = dg.verdict(diag)
    if v["health"] == dg.RED:
        assert v["faults"][v["headline"]] == dg.RED, v


def test_headline_still_follows_caller_experience_within_a_severity():
    diag = dg.CallDiagnostics()
    diag.user_turns, diag.bot_turns, diag.tts_chars = 3, 0, 0   # BOT_SILENT RED
    diag.max_reply_restarts = 4                                  # REPLY_LOOP RED
    v = dg.verdict(diag)
    assert v["headline"] == dg.BOT_SILENT, v


def test_dead_air_carries_its_cause_into_the_report():
    """Call 597aeb3f had 8.2s of dead air and the container restart that shipped
    the next build destroyed the logs before it could be diagnosed. The cause
    has to travel with the REPORT, which survives restarts."""
    diag = dg.CallDiagnostics()
    diag.note_silence(8.2, "awaiting_playout_8.0s")
    diag.note_silence(3.1, "ducked_3.0s")
    p = dg.to_payload(diag)
    assert p["silences"] == [{"secs": 8.2, "cause": "awaiting_playout_8.0s"},
                             {"secs": 3.1, "cause": "ducked_3.0s"}]


def test_silence_notes_are_bounded():
    """A pathological call must not post a megabyte of silence notes."""
    diag = dg.CallDiagnostics()
    for i in range(200):
        diag.note_silence(3.0, "both_quiet")
    assert len(diag.silences) == 20


def test_a_clean_call_reports_no_silences_key_value():
    assert dg.to_payload(dg.CallDiagnostics())["silences"] is None


# ── a lost SCRAP is not a lost ANSWER (founder, live call c7bf5ff5) ──────────
# The panel went AMBER and said "1 answer never reached the agent, the transcript
# or the report". The whole verbatim was "वो।" — one syllable of an utterance the
# caller broke off. Two things were wrong: it was not an answer, and it WAS in
# the transcript and the report (heard is derived from outcome.transcript).
#
# It was also structural, not luck: _norm_answer keeps only alphanumerics and
# Devanagari vowel signs are not alphanumeric, so "वो।" is the single char "व" —
# under _CONTAIN_MIN_CHARS, where pass 2 is off. Below that floor a final could
# NEVER be matched, so it was certain to be reported as a deleted answer.

def test_a_sub_word_scrap_is_reported_but_fires_no_fault():
    lost = dg.split_lost(["वो।"], [])
    assert lost.answers == 0, "a syllable is not a discarded answer"
    assert lost.fragments == 1 and lost.fragment_samples == ["वो।"]

    d = dg.CallDiagnostics(user_turns=6, bot_turns=6)
    d.answers_deleted, d.answers_deleted_samples = lost.answers, lost.answer_samples
    d.fragments_lost, d.fragments_lost_samples = lost.fragments, lost.fragment_samples
    v = dg.verdict(d)
    assert dg.ANSWER_DELETED not in v["faults"], v["faults"]
    assert v["health"] == dg.GREEN
    # Measured and still on the page — hiding it would be the other failure.
    assert dg.to_payload(d)["turnTaking"]["fragmentsLost"] == 1


def test_a_lost_consent_or_refusal_still_counts_however_short():
    """"absorb but never lose" exists because consent said mid-pitch is the whole
    call. These are one char after normalization and must NOT be carved out."""
    for word in ("हाँ।", "नहीं।", "ok", "no", "जी"):
        assert dg.split_lost([word], []).answers == 1, word


def test_a_lost_number_counts_even_as_one_word():
    # "94" is the answer to "kitne marks aaye the?" — the case the founder cared
    # about most; it must never fall into the scrap bucket.
    assert dg.split_lost(["94"], []).answers == 1
    assert dg.split_lost(["तिरानवे"], []).answers == 1


def test_a_lost_question_counts_even_as_one_word():
    lost = dg.split_lost(["kya?"], [])
    assert lost.answers == 1 and lost.fragments == 0


def test_a_phrase_is_never_a_scrap():
    """Two words is a phrase. "इसमें ब" may be cut off, but it was going
    somewhere and the model never got the chance to find out where."""
    assert dg.split_lost(["इसमें ब"], []).answers == 1


def test_real_answers_and_scraps_are_split_not_merged():
    lost = dg.split_lost(["IGCSE", "वो।", "Monday.", "तो।"], [])
    assert lost.answers == 2 and lost.answer_samples == ["IGCSE", "Monday."]
    assert lost.fragments == 2 and lost.fragment_samples == ["वो।", "तो।"]


def test_reconcile_answers_is_the_answers_view_of_split_lost():
    n, samples = dg.reconcile_answers(["IGCSE", "वो।"], [])
    assert (n, samples) == (1, ["IGCSE"])


def test_the_scrap_floor_is_not_the_containment_floor():
    """Regression on my own fix: the first version reused _CONTAIN_MIN_CHARS (4)
    and would have reclassified real one-word answers as scraps. Devanagari vowel
    signs are dropped by _norm_answer, so genuine answers normalize SHORT."""
    for answer in ("SSC.", "DPS", "आठवीं", "पाँच", "CBSE"):
        assert dg.split_lost([answer], []).answers == 1, answer


# ── the bot and the admin UI share a fault vocabulary; nothing enforced it ────

def _fe_fault_codes():
    """The admin dashboard's CALL_FAULT_CODES, parsed out of the TS source."""
    import os
    import re
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ts = os.path.join(os.path.dirname(here), "frontend-admin-dashboard", "src", "routes",
                      "audience-manager", "call-log", "-services", "call-log-service.ts")
    if not os.path.exists(ts):          # bot deployed without the monorepo
        return None
    with open(ts, encoding="utf-8") as fh:
        src = fh.read()
    block = src.split("export const CALL_FAULT_CODES = [")[1].split("]")[0]
    return re.findall(r"'([A-Z_]+)'", block)


def test_fe_fault_list_matches_headline_priority():
    """A fault the UI has never heard of renders as "Unrecognised fault code",
    and the ORDER decides which headline a row shows from diag_faults alone.

    Both halves have burned us: REPLY_LOOP shipped in the bot and not the UI
    (call 597aeb3f), and the order had drifted so far that BOT_SILENT +
    TTS_WEDGE showed "Voice synthesis stalled" in the UI while the bot's own
    headline said "The agent never spoke" — the exact inversion the BOT_SILENT
    and STT_DEAF comments in this module exist to prevent. This is a
    cross-language contract with no compiler; it needs a test.
    """
    fe = _fe_fault_codes()
    if fe is None:
        import pytest
        pytest.skip("frontend not present next to the bot")
    missing = [c for c in dg.HEADLINE_PRIORITY if c not in fe]
    assert not missing, f"faults the admin UI cannot render: {missing}"
    assert fe == list(dg.HEADLINE_PRIORITY), (
        "CALL_FAULT_CODES order must equal HEADLINE_PRIORITY — the UI derives a "
        f"row's headline from it.\n  bot: {list(dg.HEADLINE_PRIORITY)}\n   ui: {fe}")


def test_every_fault_has_headline_text():
    """A fired fault with no sentence renders as an empty headline."""
    for code in dg.ALL_FAULTS:
        d = dg.CallDiagnostics()
        text = dg._HEADLINE_TEXT.get(code)
        assert text, f"{code} has no headline sentence"
        assert len(text) < 90, f"{code} headline too long for a row hover: {text!r}"
        del d


def test_max_reply_restarts_skips_the_openings_deliberate_resays():
    """Replay of 7fb703a4 (2026-10-14): the opening and its two re-says sat next
    to each other once an ack over them stopped splitting the entries — three
    deliveries of the opening are not a REPLY_LOOP; a real loop still is."""
    opening = "Namaste ji, main Asha bol rahi hoon Example Academy se, aapne classes ke baare mein poocha tha"
    t = [{"role": "assistant", "text": opening}, {"role": "assistant", "text": opening},
         {"role": "assistant", "text": opening}, {"role": "user", "text": "haan ji"},
         {"role": "assistant", "text": "Bachche ka naam kya hai aur woh kis class mein padhta hai?"}]
    assert dg.max_reply_restarts(t) == 3
    assert dg.max_reply_restarts(t, skip_like=opening) == 1
    loop = "Kya main jaan sakti hoon ki pichhli class mein kitne marks aaye the?"
    t2 = t + [{"role": "assistant", "text": loop}] * 3
    assert dg.max_reply_restarts(t2, skip_like=opening) == 3
