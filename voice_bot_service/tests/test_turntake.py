"""Table tests for the PURE mid-reply turn decisions (app/turntake.py) and the
duck timing branches in app/callstate.py.

The word-list decisions are the product behavior the founder signed off
("absorb but never lose", 2026-08-05): every row below is reviewable as data.
The asymmetry under test: when unsure, INTERRUPT — wrongly stopping the bot
costs a moment; wrongly steamrolling the caller costs the call.
"""
from app.turntake import (mid_reply_action, ABSORB, INTERRUPT, is_carrier_announcement, is_repeat,
                          suppresses_opening, strip_echo_opener, caller_asked_a_question)
from app.callstate import (
    CallState, WatchdogConfig, watchdog_decide, apply_decision,
    NONE, DUCK_RESUME, CAP_FAREWELL, ARM_STOP, ORPHAN_ASK, NUDGE,
)

T0 = 1000.0


def cfg(**over):
    base = dict(connected_at=T0, cap_secs=600.0, idle_timeout_secs=8.0,
                stall_recovery_enabled=True, graceful_stop_deadline_secs=25.0)
    base.update(over)
    return WatchdogConfig(**base)


# ── classifier: ABSORB rows (the live ANSWER_DELETED samples must all pass) ──

def test_absorbs_live_deleted_backchannels():
    # Straight from prod diagnostics answersDeletedSamples (2026-08-04/05 calls,
    # incl. the founder's own 8e1e00ad test call).
    for t in ("हाँ।", "अच्छा।", "बोलिए।", "जी हाँ", "ठीक है।", "हांजी",
              "अच्छा बढ़िया है।", "बहुत बढ़िया।"):
        assert mid_reply_action(t) == ABSORB, t


def test_absorbs_roman_and_english_acks():
    for t in ("haan", "haan ji", "hmm", "okay", "theek hai", "yes sir",
              "accha", "ok ok", "right", "बिल्कुल"):
        assert mid_reply_action(t) == ABSORB, t


def test_absorbs_empty_text():
    assert mid_reply_action("") == ABSORB
    assert mid_reply_action("   ") == ABSORB


def test_extra_backchannels_param():
    assert mid_reply_action("zabardast") == INTERRUPT
    assert mid_reply_action("zabardast", extra_backchannels=frozenset({"zabardast"})) == ABSORB


# ── classifier: INTERRUPT rows ──

def test_interrupts_negations_even_with_acks():
    for t in ("नहीं", "नहीं।", "haan nahi", "no no", "ठीक है लेकिन",
              "हाँ पर", "nahi chahiye"):
        assert mid_reply_action(t) == INTERRUPT, t


def test_interrupts_questions():
    for t in ("आप AI हो क्या?", "haan?", "kya?", "कौन？"):
        assert mid_reply_action(t) == INTERRUPT, t


def test_interrupts_content_words():
    # One-word REAL answers — the exact class pipecat's min-words path deleted
    # (live losses: IGCSE, Symbiosis, Monday). These must become real turns.
    #
    # "hello"/"हैलो" were in this list until 2026-08-06 and were MOVED to the
    # absorb set on purpose: see test_hello_mid_reply_absorbs_so_the_sentence_
    # can_resume. Interrupting on them cost call 77cb4b47 — the reply was
    # cancelled, the model re-asked the same question, the caller said "hello?"
    # at the silence, and round it went. "रुको"/"suniye" (stop / listen) stay
    # here: those really are instructions to stop.
    for t in ("IGCSE", "Symbiosis", "Monday", "अगर आप रिकॉर्ड योर।",
              "मुझे दो minute दीजिए", "रुको", "suniye"):
        assert mid_reply_action(t) == INTERRUPT, t


def test_interrupts_past_word_cap():
    # The cap was 3 until 2026-09-23. The 22 Sep paid batch had "हाँ जी। नमस्ते
    # जी। जी।" and "ठीक है जी। हम्म।" stopping the bot as real interruptions —
    # a run of acknowledgement words is still an acknowledgement. Six is the cap.
    assert mid_reply_action("haan haan haan") == ABSORB
    assert mid_reply_action("haan haan haan haan") == ABSORB
    assert mid_reply_action("haan haan haan haan haan haan") == ABSORB
    assert mid_reply_action("haan haan haan haan haan haan haan") == INTERRUPT


# ── duck timing (pure watchdog branches) ──

def test_duck_resumes_after_wordless_sound():
    """VAD heard a cough over the reply; no transcript ever arrives. The hold
    releases duck_no_words_resume_secs after the sound ended — not at the idle
    nudge, not at the orphan ask."""
    s = CallState(t=T0, ducked_since=T0 + 1.0, user_speaking=False,
                  user_stopped_t=T0 + 1.5, bot_spoke_once=True)
    c = cfg()
    assert watchdog_decide(s, T0 + 2.0, c).kind == NONE      # 0.5s since stop
    d = watchdog_decide(s, T0 + 3.6, c)                       # 2.1s since stop
    assert d.kind == DUCK_RESUME
    apply_decision(s, d, T0 + 3.6)
    assert s.ducked_since == 0.0


def test_duck_holds_while_caller_still_speaking():
    """No resume while the caller is mid-utterance — they are the turn now."""
    s = CallState(t=T0, ducked_since=T0 + 1.0, user_speaking=True,
                  user_started_t=T0 + 1.0)
    c = cfg()
    assert watchdog_decide(s, T0 + 5.0, c).kind == NONE
    # ...until the absolute ceiling: a lost transcript can never mute the bot.
    assert watchdog_decide(s, T0 + 13.5, c).kind == DUCK_RESUME


def test_duck_pauses_idle_machinery():
    """While ducked the silence is OURS — no nudge, no orphan re-ask."""
    s = CallState(t=T0, ducked_since=T0 + 1.0, user_speaking=False,
                  user_started_t=T0 + 0.5, user_stopped_t=T0 + 1.4,
                  bot_spoke_once=True)
    c = cfg(duck_no_words_resume_secs=60.0, duck_max_hold_secs=120.0)
    for t in range(2, 12):
        assert watchdog_decide(s, T0 + t, c).kind == NONE, t


def test_cap_still_fires_while_ducked():
    """The duration cap is a spend bound — a hold must not defer it."""
    s = CallState(t=T0, ducked_since=T0 + 599.0, user_speaking=True)
    c = cfg(cap_secs=600.0)
    assert watchdog_decide(s, T0 + 600.5, c).kind == CAP_FAREWELL


def test_no_arm_stop_while_farewell_tail_is_ducked():
    """Goodbye said, caller backchannels over it, tail held: the line must not
    close while the held tail could still play."""
    s = CallState(t=T0, ducked_since=T0 + 10.0, end_pending_since=T0 + 9.0,
                  user_speaking=True)
    c = cfg()
    assert watchdog_decide(s, T0 + 12.0, c).kind == NONE


def test_unducked_flow_unchanged():
    """ducked_since == 0 must be byte-identical to the old decision flow."""
    s = CallState(t=T0, bot_spoke_once=True)
    c = cfg()
    decisions = []
    for t in range(1, 12):
        d = watchdog_decide(s, T0 + t, c)
        apply_decision(s, d, T0 + t)
        decisions.append(d.kind)
    assert NUDGE in decisions            # idle nudge at 8s, exactly as before
    assert DUCK_RESUME not in decisions


# ── Rumik term normalization (providers.normalize_for_rumik is import-safe:
# pipecat imports in providers.py are module-level and CI installs them) ──

def test_normalize_for_rumik_replaces_transliterated_terms():
    from app.providers import normalize_for_rumik
    m = (("लाइव क्लासेस", "Live Classes"), ("क्लासेस", "classes"))
    out = normalize_for_rumik("हमारी लाइव क्लासेस के बारे में।", term_map=m)
    assert out == "हमारी Live Classes के बारे में।"
    # longest key wins; bare word still handled on its own
    assert normalize_for_rumik("क्लासेस अच्छी हैं", term_map=m) == "classes अच्छी हैं"
    # untouched text passes through byte-identical
    assert normalize_for_rumik("नमस्ते जी", term_map=m) == "नमस्ते जी"


def test_default_term_map_is_longest_first():
    from app.config import Settings
    lens = [len(k) for k, _ in Settings().rumik_term_map]
    assert lens == sorted(lens, reverse=True)
    assert ("लाइव क्लासेस", "Live Classes") in Settings().rumik_term_map


# ── call 77cb4b47 (2026-08-06): the restart loop and its trigger ───────────
def test_hello_mid_reply_absorbs_so_the_sentence_can_resume():
    """The founder heard the same question four times in eleven seconds because
    every "hello?" cancelled the reply and the model re-asked from the top.
    Interrupting never restored their audio; resuming the held sentence does."""
    for word in ("hello", "Hello.", "हेलो", "hello hello", "haan hello"):
        assert mid_reply_action(word) == ABSORB, word


def test_a_real_question_mid_reply_still_interrupts():
    """Absorbing "hello" must not swallow actual questions — "क्या पूछा आपने?"
    on the same call WAS a real turn and had to stop the bot."""
    assert mid_reply_action("क्या पूछा आपने?") == INTERRUPT
    assert mid_reply_action("hello, fees kitni hai?") == INTERRUPT
    assert mid_reply_action("nahi") == INTERRUPT


def test_carrier_announcements_are_not_the_callee():
    """Verbatim from the Sarvam finals on call 77cb4b47 — including the
    truncated form, since partial finals are what actually arrive."""
    for t in ("Your call has been forwarded to voicemail.",
              "Your call has been forwarded to voicemai",
              "The person you're trying to reach is not available.",
              "The subscriber you have dialled is currently busy.",
              "आप जिस नंबर पर संपर्क कर रहे हैं वह इस समय उपलब्ध नहीं है।"):
        assert is_carrier_announcement(t), t


def test_real_callers_are_not_mistaken_for_the_network():
    for t in ("Haan ji main parent bol raha hoon", "Raman", "Class eighth mein hai",
              "Hello", "fees kitni hogi?", "68 percent aaye the"):
        assert not is_carrier_announcement(t), t


# ── voicemail fragments (2026-08-06, calls 0d61b32a / 9668da21) ───────────
def test_every_fragment_that_killed_a_live_opening_is_caught():
    """Sarvam splits the SAME operator sentence differently on different calls.
    One call gave 'Your call has been forwarded to voicemail.' (matched); the
    next gave 'Your call.' + 'Has been forwarded to voicemail.' — the first
    fragment matched nothing, counted as the callee, and killed our opening."""
    for frag in ("Your call.", "Has been forwarded to voicemail.",
                 "If you record your", "forwarded to voicemail",
                 "The person you're", "trying to reach"):
        assert is_carrier_announcement(frag), frag


def test_a_greeting_or_fragment_never_suppresses_our_opening():
    for t in ("Hi.", "Hello.", "Your call.", "If you record your", "हेलो", ""):
        assert not suppresses_opening(t), t


def test_a_caller_who_really_takes_over_still_suppresses_it():
    """The greet-skip exists for a reason: someone who answers with a real
    question should get an answer, not a scripted pitch over the top of it."""
    for t in ("aap kaun bol rahe hain bhai",
              "main abhi busy hoon baad mein call karein",
              "haan ji main parent bol raha hoon"):
        assert suppresses_opening(t), t


# ── parroting the caller's answer back (founder, 2026-08-12) ─────────────────
# "Every time the person answers, the AI again says okay. It asked how many
# marks, the person said ninety-four, and it comes back 'okay, you got
# ninety-four'. There is no need to reconfirm every time. It looks like an AI."
#
# Every LIVE row below is a real turn from call c7bf5ff5 — the parroting is at
# CLAUSE level and shares its sentence with the real question, which is why a
# sentence-level gate could never have fixed it.

def _trim(sentence, caller, question=""):
    return strip_echo_opener(sentence, caller, question)


def test_the_parroted_opener_is_dropped_and_the_question_survives():
    out = _trim(
        "ओके, सुबोध अभी आठवीं क्लास में है, तो श्रेयाश जी सुबोध के लास्ट एनुअल एक्ज़ाम में "
        "कितने मार्क्स आए थे?",
        "सुबोध अभी आठवीं में है।", "सुबोध अभी कौन से क्लास में है?")
    assert "आठवीं क्लास में है" not in out, "still restating the answer"
    assert out.endswith("कितने मार्क्स आए थे?"), out


def test_what_the_bot_ADDED_survives_the_trim():
    """The caller's own words go; the bot's reaction to them stays. A counsellor
    really does say "that's a great score" — they just don't read the number
    back first."""
    out = _trim("सुबोध के लास्ट बहुत अच्छे, तिरानवे प्रतिशत मार्क्स, बहुत बढ़िया स्कोर है।",
                "तिरानवे प्रतिशत।",
                "सुबोध के लास्ट एनुअल एक्ज़ाम में कितने मार्क्स आए थे?")
    assert "तिरानवे" not in out, "the marks were read back again"
    assert "बढ़िया स्कोर" in out, "the human reaction must not be swallowed"


def test_the_ack_only_opener_goes_but_real_content_after_it_stays():
    out = _trim("जी हाँ, सुबोध आठवीं में है तो उसके लिए Insight program सही रहेगा।",
                "सुबोध अभी आठवीं में है।", "कौन से क्लास में है?")
    assert not out.startswith("जी हाँ")
    assert "Insight program" in out, "the pitch is not a repetition"


def test_a_real_answer_to_a_question_is_never_trimmed():
    """The clause reuses the caller's word ("fees") but says something new. Only
    a clause that introduces NOTHING is parroting."""
    s = ("Fees teen cheezon par depend karti hai, subah ki class performance, "
         "program aur scholarship.")
    assert _trim(s, "fees kitni hai", "kya aap fees ke baare mein jaanna chahenge?") == s


def test_reflecting_a_QUESTION_back_is_left_alone():
    """The prompt asks for this and it is good practice — it is reflecting an
    ANSWER that the founder flagged. Sarvam does not reliably punctuate, so the
    caller's interrogative has to carry the decision."""
    s = "अच्छा, आप timing को लेकर पूछ रहे हैं, तो classes शाम को होती हैं।"
    assert _trim(s, "timing क्या है?", "") == s
    assert _trim(s, "timing kya hai", "") == s, "no '?' from the STT must still count"


def test_a_required_read_back_is_never_trimmed():
    """CLOSE CONCRETELY makes reading a number back digit by digit mandatory —
    the one echo we DO want. Two digit groups in a clause is the guard."""
    s = "आपका number nau do teen chaar, paanch chhe saat aath nau shunya, सही है?"
    assert _trim(s, "nau do teen chaar paanch chhe saat aath nau shunya", "") == s


def test_a_single_clause_reply_is_untouched():
    """Nothing to trim without a clause boundary, and a reply must never vanish."""
    for s in ("तिरानवे प्रतिशत बहुत अच्छा है।", "आठवीं क्लास।"):
        assert _trim(s, "तिरानवे प्रतिशत।", "कितने मार्क्स आए थे?") == s


def test_the_trim_never_leaves_a_stub_behind():
    """If all that survives is two words, the parroting was the reply — say it
    rather than emit something that cannot stand on its own."""
    s = "सुबोध आठवीं में है, अच्छा है।"
    assert _trim(s, "सुबोध आठवीं में है।", "") == s


def test_an_order_read_back_before_a_confirmation_tag_is_kept():
    """Call a6849d85: "quantity पांच।" → "पांच pieces, सही है?" was cut to a bare
    "सही है?" — a question about nothing. The caller said "Hello." 3.6 s later."""
    s = "पांच pieces, सही है?"
    assert _trim(s, "quantity पांच।", "उसकी quantity कितनी रखनी है?") == s
    s = "Five mm, right?"
    assert _trim(s, "five mm.", "which size do you need?") == s
    # A real question after the parroting still loses the parroting.
    out = _trim("पांच pieces, pattern कौन सा रहेगा?", "quantity पांच।",
                "उसकी quantity कितनी रखनी है?")
    assert out == "pattern कौन सा रहेगा?", out


def test_no_caller_turn_means_nothing_to_parrot():
    s = "ओके, तो main aapko details bhej deti hoon."
    assert _trim(s, "") == s


def test_caller_asked_a_question_reads_cues_not_just_punctuation():
    for q in ("fees kitni hai", "क्या ये online है", "how much is it", "timing क्या है?"):
        assert caller_asked_a_question(q), q
    for a in ("सुबोध अभी आठवीं में है।", "तिरानवे प्रतिशत।", "हाँ।", ""):
        assert not caller_asked_a_question(a), a


# ── is_repeat: the quick_ratio screen must not change a single answer ────────
# The screen exists for cost (10ms/sentence at 150 spoken sentences, in the audio
# path, on a 1-vCPU box carrying ten calls). real_quick_ratio/quick_ratio are
# documented UPPER BOUNDS on ratio(), so skipping below the threshold is exact —
# these rows pin the behaviour either side of the 0.80 boundary anyway.

def test_is_repeat_still_catches_the_real_re_renders():
    """Verbatim from the calls this gate was built for: the model re-renders its
    own question slightly differently every time."""
    spoken = ["kya aap iski fees ke baare mein jaanna chahenge",
              "raman abhi kaun si class mein hai?"]
    for s in ("Kya aap iski fees ke baare mein jaanna chahengi?",
              "kya aap iski fees ke baare mein jaanna chahenge",
              "Raman abhi kaun si class mein hai?"):
        assert is_repeat(s, spoken), s


def test_is_repeat_lets_genuinely_new_content_through():
    spoken = ["kya aap iski fees ke baare mein jaanna chahenge",
              "raman abhi kaun si class mein hai?"]
    for s in ("MGP ki fees chalis hazaar se saath hazaar ke beech hai.",
              "Shreyash ji, main Shiksha Nation se baat kar rahi hoon.",
              "Koi subject jisme zyada dikkat aati hai?"):
        assert not is_repeat(s, spoken), s


def test_is_repeat_ignores_short_fragments_and_empty_history():
    # Acknowledgements legitimately recur; suppressing them would strip the bot
    # of every ack it has.
    for s in ("Achha.", "Theek hai.", "Hmm…", "Ji."):
        assert not is_repeat(s, ["achha.", "theek hai."]), s
    assert not is_repeat("a long enough sentence to be considered at all", [])
    assert not is_repeat("", ["something"])


def test_strip_echo_opener_only_ever_deletes():
    """Seeded fuzz over the shapes a live reply can take. This runs on every
    reply in the audio path: it must never raise, never blank a reply, never
    swallow the caller's question, and never invent words."""
    import random
    rng = random.Random(20260813)
    alphabets = ["अआइईउऊएऐओऔकखगघचछजझटठडढतथदधनपफबभमयरलवशषसह ािीुूेैोौंँ्",
                 "abcdefghijklmnopqrstuvwxyz ", ",;—–.?!।॥ ", "0123456789 "]
    seps = ",;—– \t\n\r"

    def bare(s):
        return "".join(c for c in (s or "").casefold() if c not in seps)

    def subsequence(small, big):
        it = iter(big)
        return all(c in it for c in small)

    cases = ["", " ", ",", ",,,,", "?", "।", "a" * 3000, "हाँ, हाँ, हाँ?",
             ",".join(["शब्द"] * 200)]
    for _ in range(1500):
        alpha = "".join(rng.sample(alphabets, rng.randint(1, len(alphabets))))
        cases.append("".join(rng.choice(alpha) for _ in range(rng.randint(0, 300))))
    for sent in cases:
        caller = rng.choice(cases) or "सुबोध अभी आठवीं में है।"
        out = strip_echo_opener(sent, caller, rng.choice(cases))
        assert sent.strip() == "" or out.strip(), f"blanked a reply: {sent!r}"
        assert "?" not in sent or "?" in out, f"swallowed a question: {sent!r}"
        assert subsequence(bare(out), bare(sent)), f"invented text from {sent!r}"



def test_hindi_hang_up_requests_end_the_call():
    """Call f1368e22 (2026-10-01): the parent said "काट कर रख दो" and "cut करो";
    neither matched, and the bot talked for another 4.5 minutes."""
    from app.turntake import caller_wants_to_end
    for t in ("वो सब छोड़ो आप वो सब छोड़ो छोड़ो छोड़ो आप मुझे। काट कर रख दो", "cut करो।",
              "काट दो", "phone रख दो", "फोन रख दीजिए", "call cut कर दो", "फोन बंद करो",
              "मत call करो", "गलत नंबर है", "मुझे नहीं चाहिए", "ज़रूरत नहीं है", "Cut the call."):
        assert caller_wants_to_end(t), t
    for t in ("रहने दो।", "अरे वो सब बताने को रहने दो।", "उसके मार्क्स कट गए थे", "कृष्णा दसवीं class में है।",
              "call back कर लेना", "फोन पर बात कर लेते हैं", "हाँ जी।"):
        assert not caller_wants_to_end(t), t


def test_a_reply_ends_on_its_question_with_a_short_sentence_after_it():
    """Call 71d0d5bd (2026-10-02): the scripted close puts a short sentence after
    the question. A "हाँ" over that sentence answers the question; past the
    8-word tolerance the sentence stands on its own."""
    from app.turntake import ends_on_question, QUESTION_TAIL_WORDS
    assert QUESTION_TAIL_WORDS == 8
    for t in ("ठीक है। क्या मैं Scholarship Quiz का link भी WhatsApp कर दूँ? "
              "पंद्रह questions हैं, सिर्फ पंद्रह मिनट लगते हैं।",
              "क्या आप जुड़ना चाहेंगे?", "क्या आप जुड़ना चाहेंगे？", "Who is it right now? Is that ",
              "Who is it right now? one two three four five six seven eight"):
        assert ends_on_question(t), t
    for t in ("", "   ", "ठीक है, मैं भेज देती हूँ।",
              "क्या मैं link भेज दूँ? पंद्रह questions हैं, सिर्फ पंद्रह मिनट लगते हैं, और result "
              "उसी दिन आपके WhatsApp पर आ जाता है।",
              "Who is it right now? one two three four five six seven eight nine"):
        assert not ends_on_question(t), t


# ── call on hold (call 6d81124d, 2026-10-14) ───────────────────────────────

def test_hold_announcements_enter_the_hold():
    from app.turntake import is_hold_announcement
    for line in ("आप जिस व्यक्ति से बात कर रहे हैं।", "hold पर रखा है।", "कृपया लाइन पर बने रहें।",
                 "has put your call on hold.", "Stay on the line.", "Please hold.",
                 "The person you are speaking with has put your call on hold"):
        assert is_hold_announcement(line), line


def test_ordinary_answers_are_not_hold_lines():
    from app.turntake import is_hold_announcement, is_hold_fragment
    for line in ("हाँ जी बताइए", "Hello.", "मैं बच्चे का पिता बोल रहा हूँ", "नाम ऋषभ है",
                 "seventh में है", "ठीक है", "Yes, tell me", "हां जी बताइए अभी वापस।"):
        assert not is_hold_announcement(line), line
        assert not is_hold_fragment(line), line


def test_pieces_of_the_recording_are_fragments():
    from app.turntake import is_hold_fragment
    for piece in ("उन्होंने आपके।", "होल्ड।", "कृपा।", "The person you are", "Speaking with."):
        assert is_hold_fragment(piece), piece
    # Recording words, but none only the recording says: a person can say it too.
    assert not is_hold_fragment("आपके call को")
