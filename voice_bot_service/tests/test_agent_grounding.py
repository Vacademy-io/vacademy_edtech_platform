"""Non-education agents: industry-neutral platform rules + a grounding rule.

AAIBUZZ/IRPL calls c43e9ce7 and e6cb5f47 (2026-10-16): a 512-character generic
script ("explain why you are calling", never why, never what AAIBUZZ sells). The
bot told the caller "we are an edtech company… class 1 to 12" and booked a 5 PM
demo that does not exist — both lifted from the platform's own education
examples. app/agent_domain decides EDUCATION vs GENERAL from the agent's own
script; an EDUCATION agent's prompt must not change by one byte.

Every agent here is synthetic. Real agent configs never enter the repo.
"""
import re

import app.bot as b
import app.report as rpt
from app.agent_domain import (EDUCATION, GENERAL, agent_domain, education_hits,
                              is_general_agent)

# Generic, the shape of the incident's script, no business named.
_THIN_GENERAL = ("You are a friendly, professional calling assistant for Acme. Confirm you "
                 "are speaking with the right person, briefly explain why you are calling, "
                 "answer their questions politely and concisely, and capture their interest "
                 "level. Never invent prices, dates or facts. If the person is busy, ask for "
                 "a convenient callback time. End the call politely.")
_LONG_GENERAL = _THIN_GENERAL + " " + ("Keep every turn short and warm. " * 30)


def _agent(prompt, **kw):
    a = {"name": "Acme Caller", "language": "hinglish", "voice": "ipsita", "tts_model": "navana",
         "speech_cache_mode": "OFF", "openingLine": "Hello, is this {{name}}? I am calling from Acme.",
         "systemPrompt": prompt, "extractionQuestions": ["Is the person interested?"],
         "dispositions": ["Interested", "Callback", "Not_Interested"]}
    a.update(kw)
    return a


def _ctx(agent, **kw):
    c = {"agent": agent, "instituteName": "Acme Pvt Ltd", "direction": "OUTBOUND",
         "leadName": "Rahul Sharma", "leadPhone": "919800000000",
         "handoff": {"enabled": False, "numbers": []}}
    c.update(kw)
    return c


def _platform_part(prompt: str, ctx: dict) -> str:
    """The rendered prompt minus everything the agent or the lead supplied."""
    agent = ctx["agent"]
    own = [b._fill_placeholders(agent["systemPrompt"], ctx),
           b._clean_opening(b._fill_placeholders(agent["openingLine"], ctx, full_name=True)),
           b._lead_enquiry_line(ctx), b._lead_fields_line(ctx), agent["name"],
           ctx["instituteName"], ctx["leadName"], *agent["extractionQuestions"],
           *agent["dispositions"]]
    for o in sorted((o for o in own if o), key=len, reverse=True):
        prompt = prompt.replace(o, " ")
    # Not education: punctuation "marks", and the ban that names the demo it forbids.
    prompt = prompt.replace("These marks are for your voice only", "")
    return re.sub(r"NEVER OFFER WHAT YOUR INSTRUCTIONS DO NOT OFFER:[^\n]*", "", prompt)


# ── classifier ────────────────────────────────────────────────────────────────

def test_any_education_signal_in_the_agents_own_script_is_education():
    cases = [
        _agent("You call parents who enquired about our live classes."),
        _agent("आप अभिभावकों से बात करती हैं — आपके बच्चे की पढ़ाई के बारे में।"),
        _agent("Aap bachche ki padhai ke baare mein poochti hain."),
        _agent("तुमच्या मुलाच्या शाळा आणि अभ्यासक्रमाबद्दल विचारा."),   # Marathi
        _agent(_THIN_GENERAL, dispositions=["Demo_Class_Booked", "Not_Interested"]),
        _agent(_THIN_GENERAL, extractionQuestions=["Which exam is the student preparing for?"]),
        _agent(_THIN_GENERAL, name="Admissions Desk"),
        _agent(_THIN_GENERAL, openingLine="Hello, I am calling from Bright Coaching."),
        _agent("We sell an LMS to coaching institutes."),
    ]
    for a in cases:
        assert agent_domain(a) == EDUCATION, a


def test_blank_scripts_keep_todays_behaviour():
    assert agent_domain(_agent("")) == EDUCATION
    assert agent_domain(_agent("   ")) == EDUCATION
    # admin_core's stand-in for a blank system prompt (registryAgentMap)
    assert agent_domain(_agent("You are a friendly, concise phone assistant.")) == EDUCATION
    assert agent_domain({}) == EDUCATION
    assert agent_domain(None) == EDUCATION


def test_a_script_with_no_education_signal_is_general():
    assert agent_domain(_agent(_THIN_GENERAL)) == GENERAL
    # Sales words that lean educational but are in every script.
    assert agent_domain(_agent(_THIN_GENERAL + " Offer to share a case study if they want to "
                                               "learn more about our 360 degree view.")) == GENERAL
    # "classic" / "upgrade" / "trademarks" are not class / grade / marks.
    assert agent_domain(_agent("We restore classic cars and upgrade trademarks.")) == GENERAL


def test_education_hits_reports_what_it_found():
    hits = education_hits("बच्चे की class और exam marks")
    assert "class" in hits and "exam" in hits and "marks" in hits and "बच्च" in hits


# ── EDUCATION: nothing changes ────────────────────────────────────────────────

def test_education_agent_prompt_keeps_every_education_rule_and_gets_no_grounding():
    a = _agent("You are Shreya, calling a parent about live classes for their child.")
    ctx = _ctx(a)
    p = b.build_system_prompt(ctx)
    assert "GROUNDING" not in p
    for original in ("steer toward your goal (demo/next step)", "a real counsellor",
                     "'Do you take live classes?'", "'Robotics Programs for Schools'",
                     "a ten-minute demo at a specific time", "a counsellor will call them right back",
                     "आठवीं क्लास"):
        assert original in p, original
    # admin_core's booking flag is read for GENERAL agents only.
    assert b.build_system_prompt(_ctx(dict(a, bookingEnabled=True))) == p


# ── GENERAL: neutral examples + grounding, in every prompt shape ──────────────

def _general_variants():
    yield "thin hinglish", _agent(_THIN_GENERAL)
    yield "authored hinglish", _agent(_LONG_GENERAL)
    yield "thin english navana", _agent(_THIN_GENERAL, language="english")
    yield "thin english sarvam", _agent(_THIN_GENERAL, language="english", tts_model="sarvam")
    yield "rumik + cache", _agent(_THIN_GENERAL, tts_model="rumik", voice="ira",
                                  speech_cache_mode="FIXED")
    yield "authored rumik + cache", _agent(_LONG_GENERAL, tts_model="rumik", voice="ira",
                                           speech_cache_mode="FIXED")


def test_general_agent_gets_grounding_and_no_education_words_in_any_shape():
    for label, a in _general_variants():
        assert is_general_agent(a), label
        for extra in ({}, {"leadEnquiry": {"sourceType": "WALK_IN", "dateKnown": True,
                                           "submittedAt": "2026-10-16T05:00:00Z"}}):
            ctx = _ctx(a, **extra)
            p = b.build_system_prompt(ctx)
            assert "GROUNDING — NEVER INVENT YOUR BUSINESS" in p, label
            assert "never offer, propose or book a demo, meeting" in p, label
            plat = _platform_part(p, ctx)
            assert education_hits(plat) == [], (label, education_hits(plat))
            assert not re.search(r"\bdemo\b", plat, re.I), label
            assert "counsellor" not in plat.lower(), label


def test_the_enquiry_line_is_real_data_and_stays():
    ctx = _ctx(_agent(_THIN_GENERAL), leadEnquiry={"sourceType": "WALK_IN", "dateKnown": True,
                                                   "submittedAt": "2026-10-16T05:00:00Z"})
    p = b.build_system_prompt(ctx)
    assert "WHEN AND WHERE THEY ENQUIRED" in p and "visiting Acme Pvt Ltd in person" in p


def test_grounding_sits_with_the_non_negotiable_rules_and_before_the_lead_facts():
    ctx = _ctx(_agent(_THIN_GENERAL), leadEnquiry={"sourceType": "WEBSITE", "dateKnown": False})
    p = b.build_system_prompt(ctx)
    assert p.index("NON-NEGOTIABLE RULES") < p.index("GROUNDING") < p.index("WHEN AND WHERE")
    authored = b.build_system_prompt(_ctx(_agent(_LONG_GENERAL)))
    assert authored.index("AUTHORITATIVE") < authored.index("GROUNDING") < authored.index("RIGHT NOW")


def test_a_booking_page_lets_a_general_agent_offer_a_meeting_but_not_a_demo():
    p = b.build_system_prompt(_ctx(_agent(_THIN_GENERAL, bookingEnabled=True)))
    assert "you may offer to book a meeting with the team" in p
    assert "never offer or book a demo, trial or visit unless" in p
    assert "never offer, propose or book a demo, meeting" not in p


def test_general_rules_keep_their_teaching_purpose():
    p = b.build_system_prompt(_ctx(_agent(_THIN_GENERAL)))
    for kept in ("NEVER repeat a sentence", "FRUSTRATION = STOP", "LISTEN AND RESPOND",
                 "SPEAK PHONE HINDI, NOT TEXTBOOK HINDI", "enquiry (never पूछताछ)",
                 "ASK LIKE A PERSON, NOT A FORM", "DON'T ACCEPT THE FIRST BRUSH-OFF",
                 "CLOSE CONCRETELY", "DEVANAGARI", "IDENTITY LOCK",
                 "say a colleague from the team will call them back"):
        assert kept in p, kept


# ── spoken lines outside the prompt ───────────────────────────────────────────

def test_a_copied_name_slot_is_never_your_child_for_a_general_agent():
    assert b.fill_template_slots("Is <name> free now?")[0] == "Is your child free now?"
    out, n = b.fill_template_slots("Is <name> free now?", child_slots=False)
    assert n == 1 and "child" not in out and "<" not in out
    out, _ = b.fill_template_slots("क्या <name> के साथ भी ऐसा है?", child_slots=False)
    assert "बच्च" not in out


def test_transfer_failure_line_promises_the_team_not_a_counsellor():
    assert "counsellor" in b.TRANSFER_FAIL_CLOSING           # unchanged for education
    assert "counsellor" not in b.TRANSFER_FAIL_CLOSING_GENERAL
    assert "team" in b.TRANSFER_FAIL_CLOSING_GENERAL


class _Outcome:
    def __init__(self, agent):
        self.corr = "c"
        self.transcript = [{"role": "assistant", "text": "Hello."},
                           {"role": "user", "text": "Haan, boliye."}]
        self.context = {"agent": agent, "instituteId": "i"}


async def _analysis_prompt(monkeypatch, agent) -> str:
    seen = {}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            seen["prompt"] = json["messages"][0]["content"]
            raise RuntimeError("no network in tests")

    monkeypatch.setattr(rpt.httpx, "AsyncClient", _Client)
    await rpt._analyze(_Outcome(agent))
    return seen["prompt"]


async def test_post_call_analysis_names_a_team_member_for_a_general_agent(monkeypatch):
    general = await _analysis_prompt(monkeypatch, _agent(_THIN_GENERAL))
    assert "counsellor" not in general and "HUMAN team member" in general
    edu = await _analysis_prompt(monkeypatch, _agent("Call parents about live classes."))
    assert "HUMAN counsellor" in edu and "written for the counsellor" in edu


# ── follow-up review fixes (2026-10-16) ───────────────────────────────────────

def test_more_education_scripts_stay_education():
    # Exam prep, degrees, "your son" — education without any of the first words.
    for prompt in ("Invite them to our MBA Masterclass on Sunday.",
                   "Aapke bete ke liye mock test series hai.",
                   "आपकी बेटी की ट्रेनिंग के बारे में बात करें।",
                   "B.Tech and MBBS aspirants: CUET and CLAT crash plans."):
        assert agent_domain(_agent(prompt)) == EDUCATION, prompt
    # Business words that only look like them.
    assert agent_domain(_agent(_THIN_GENERAL + " Sign the NDA; try the beta version; MCA "
                                               "filing.")) == GENERAL


def test_grounding_gives_a_no_reason_fallback_and_wins_over_rule_one():
    p = b.build_system_prompt(_ctx(_agent(_THIN_GENERAL)))
    assert "the NON-NEGOTIABLE rules included" in p
    assert "a fact about your business still comes only from GROUNDING below" in p
    assert "If there is no reason to give, do not make one up" in p
    assert "ask whether it is a good time to talk" in p
    # The admin's own send offers are part of the script, not "offers it never made".
    assert "unless your instructions above or THINGS YOU CAN SEND offer one" in p
    assert "the reason for calling that your instructions give (see GROUNDING" in p


def test_the_enquiry_is_a_reason_only_when_it_is_a_real_one():
    real = b.build_system_prompt(_ctx(_agent(_THIN_GENERAL), leadEnquiry={
        "sourceType": "WALK_IN", "dateKnown": True, "submittedAt": "2026-10-16T05:00:00Z"}))
    assert "that this person enquired, exactly as the enquiry details in these rules say" in real
    # A bulk import: source unknown, date unknown — the block's own "only if they ask" holds.
    imported = b.build_system_prompt(_ctx(_agent(_THIN_GENERAL), leadEnquiry={
        "sourceType": "BULK_IMPORT", "dateKnown": False}))
    assert "never claim this person enquired" in imported
    assert "exactly as the enquiry details in these rules say" not in imported


def test_general_first_sentence_examples_carry_no_facts():
    p = b.build_system_prompt(_ctx(_agent(_THIN_GENERAL)))
    for fact in ("No charge at all", "Sunday ko hai", "shivir"):
        assert fact not in p, fact
    edu = b.build_system_prompt(_ctx(_agent("Call parents about live classes.")))
    assert "No charge at all" in edu and "Sunday ko hai" in edu


def test_enquiry_line_without_an_institute_name_says_company_for_general_only():
    ctx = _ctx(_agent(_THIN_GENERAL), instituteName="",
               leadEnquiry={"sourceType": "WEBSITE", "dateKnown": False})
    assert "the company's website" in b._lead_enquiry_line(ctx, general=True)
    assert "the institute's website" in b._lead_enquiry_line(ctx)
    assert "the institute" not in b.build_system_prompt(ctx)


def test_who_and_hold_cues_keep_the_education_text_byte_for_byte():
    assert b.WHO_CUE == ("[They asked who is calling. FIRST sentence: your name and "
                         "your institute. SECOND: one short line on why you called. "
                         "Nothing before that — no filler, no question.]")
    assert b.HOLD_FIRST_CUE == ("[A person has just come on the line after a recorded "
                                "hold/queue message. They have NOT heard anything you said "
                                "before. Answer what they say first, then introduce yourself "
                                "briefly — your name, your institute and why you are calling.]")
    for cue in (b.WHO_CUE_GENERAL, b.HOLD_FIRST_CUE_GENERAL):
        assert education_hits(cue) == [], cue
        assert "your company" in cue and "do not make one up" in cue


async def test_a_general_agent_asked_who_is_calling_gets_the_company_cue(monkeypatch):
    from tests.test_hold import _Clock, _Rec, _collector, _noop_super, _say
    clock = _Clock(10_000.0)
    monkeypatch.setattr(b, "time", clock)
    monkeypatch.setattr(b.FrameProcessor, "process_frame", _noop_super)
    for general, want in ((False, b.WHO_CUE), (True, b.WHO_CUE_GENERAL)):
        rec = _Rec()
        tc = _collector(rec)
        tc._general_agent = general
        await _say(tc, clock, 5.0, "Aap kaun bol rahi hain?")
        assert want in rec.cues(), (general, rec.cues())
    # An IVR took the call before the bot spoke (test_hold's call 9519f8c6 path):
    # the person who comes on gets the introduction cue in the agent's shape.
    for general, want in ((False, b.HOLD_FIRST_CUE), (True, b.HOLD_FIRST_CUE_GENERAL)):
        rec = _Rec()
        tc = _collector(rec, bot_spoke_once=False, machine=True)
        tc._general_agent = general
        await _say(tc, clock, 101.57, "Welcome to New Light Institute.")
        await _say(tc, clock, 103.65, "Stay on the line.")
        rec.clear()
        await _say(tc, clock, 120.4, "Hello.")
        assert rec.cues()[0] == want, (general, rec.cues())


async def test_post_call_gist_examples_are_neutral_for_a_general_agent(monkeypatch):
    general = await _analysis_prompt(monkeypatch, _agent(_THIN_GENERAL))
    assert education_hits(general.split("Transcript:")[0]) == []
    assert "yoga" not in general and "member count" not in general
    edu = await _analysis_prompt(monkeypatch, _agent("Call parents about live classes."))
    assert "a school reception, not a yoga trainer" in edu and "member count" in edu
