"""An English agent the caller asks to speak Hindi (call a4ce0279, 2026-10-13, Riya).

Riya's script says: English for the whole call, switch to Hindi only when asked.
The bot's own SCRIPT rule for English agents said "Latin letters only, never
Devanagari", so when the caller asked, the model wrote "main ab Hindi mein baat
karungi" in Latin letters and the English voice read it as gibberish — the caller
said "I don't understand you" and the call was lost. Navana reads Devanagari in
Hindi on its own (lang_corrected on her earlier calls), so for a Navana agent the
Hindi the caller asked for goes out in Devanagari. Other engines keep the rule.
"""
import app.bot as b


def _prompt(tts_model: str, language: str = "english") -> str:
    agent = {"id": "a1", "name": "Riya", "language": language, "voice": "ipsita",
             "tts_model": tts_model, "systemPrompt": "Speak English. Switch to Hindi only if asked. " * 20,
             "direction": "OUTBOUND", "openingLine": "Hi! This is Riya."}
    return b.build_system_prompt({"agent": agent, "instituteName": "Tutezy", "direction": "OUTBOUND"})


def test_navana_english_agent_writes_requested_hindi_in_devanagari():
    p = _prompt("navana")
    assert "write every Hindi sentence in DEVANAGARI" in p
    assert "NEVER write Hindi in Latin letters" in p
    # Still English by default: the exception is only for Hindi the caller asked for.
    assert "Write your replies in English (Latin letters)" in p
    assert "Write every reply in English (Latin letters) only" not in p


def test_other_engines_keep_the_latin_only_rule():
    for engine in ("smallest_pro", "sarvam", "rumik"):
        p = _prompt(engine)
        assert "Write every reply in English (Latin letters) only" in p, engine
        assert "write every Hindi sentence in DEVANAGARI" not in p, engine


def test_hinglish_agents_are_untouched():
    p = _prompt("navana", language="hinglish")
    assert "Write Hindi words in DEVANAGARI" in p
    assert "ONE exception: if the caller has asked you to speak Hindi" not in p


def test_english_calls_stay_english_whatever_the_script_pairs():
    # Calls 3bc5f884 / f8d8478b / be51d77f / 5b88b55c (2026-10-22, Arushi CRM): a script
    # with Hinglish twins of every line made the model speak them unasked.
    for engine in ("navana", "smallest_pro", "sarvam", "rumik"):
        p = _prompt(engine)
        assert "This is an English call." in p, engine
        assert "never end an English reply with a Hindi sentence" in p, engine
        # Placement is the fix: as the LAST line it held 12/12 on Vertex, inside the
        # rules block it lost to the script's Hinglish question 8/8.
        assert p.rstrip().splitlines()[-1].startswith("- LANGUAGE: This is an English call."), engine
    assert "rewritten in Devanagari before you say it" in _prompt("navana")
    assert "rewritten in Devanagari" not in _prompt("sarvam")


def test_thin_prompt_english_agents_end_on_the_lock_too():
    agent = {"id": "a2", "name": "Riya", "language": "english", "voice": "ipsita",
             "tts_model": "navana", "systemPrompt": "", "direction": "OUTBOUND"}
    p = b.build_system_prompt({"agent": agent, "instituteName": "Tutezy", "direction": "OUTBOUND"})
    assert p.rstrip().splitlines()[-1].startswith("- LANGUAGE: This is an English call.")


def test_language_lock_is_not_added_to_hinglish_agents():
    assert "This is an English call." not in _prompt("navana", language="hinglish")
