"""PURE mid-reply turn-taking decisions (the "duck" path).

Why this exists: with pipecat 0.0.95's MinWordsInterruptionStrategy, a caller
who speaks while the bot is talking is only acted on after their WHOLE turn
ends (utterance + VAD stop + STT final + aggregation wait ≈ 2.5-4s of the bot
talking over them), and a turn under the word minimum is silently DISCARDED —
the ANSWER_DELETED fault on 67% of the last 30 days' calls, and the founder's
"the bot takes ages to stop" complaint. Both are one mechanism.

The fix (founder-approved 2026-08-05, "absorb but never lose"): DuckGate in
bot.py pauses the bot's audio ~instantly at VAD onset; when the transcript
arrives, THIS module decides what the utterance was:

  ABSORB    — a bare acknowledgment ("haan", "achha", "theek hai"): the held
              reply resumes mid-sentence and the words are appended to the LLM
              context WITHOUT a generation, so consent said mid-pitch still
              counts. The aggregator never sees the turn, so it cannot delete
              it and cannot run the LLM on it.
  INTERRUPT — anything else (a question, a negation, a real answer like
              "IGCSE"): the reply is formally interrupted and the words become
              a normal turn.

PURE by the callstate.py/diagnostics.py rule: no pipecat imports, no I/O, no
clock — the test table drives every word list decision, and word-list changes
are reviewable as data.
"""
from __future__ import annotations

import re

ABSORB = "absorb"
INTERRUPT = "interrupt"

# Affirmative acknowledgments and audio-checks. NOT here, deliberately:
#   * negations ("nahi", "no") — an objection must stop the pitch;
#   * content words — one-word answers ("IGCSE", "Monday") are real turns.
#
# "hello" USED to be excluded here, on the reasoning that a caller saying hello
# mid-reply has lost the audio and interrupting is the only honest response.
# Call 77cb4b47 (2026-08-06) disproved that. Interrupting does not restore their
# audio — it cancels the sentence, and the model then re-asks the SAME question
# from the top. The founder heard the first second of "Shreyash ji, main pooch
# raha tha ki Raman ke last annual exam mein kitne marks aaye the?" four times
# in eleven seconds, said "आपकी आवाज़ कट हो रही है बार-बार", and the loop was
# self-feeding: cut -> caller says "hello?" -> cut -> caller says "hello?".
# Absorbing lets the held reply RESUME, so the caller finally hears the rest of
# the sentence they were asking for. That is the only outcome that ends the loop.
# Devanagari and romanized forms both listed: saaras/saarika emit either script
# depending on model + mode, and the caller doesn't get to choose which.
_BACKCHANNEL_WORDS = frozenset({
    # Devanagari
    "हाँ", "हां", "हा", "हूँ", "हूं", "हम", "हम्म", "जी", "हाँजी", "हांजी",
    # The STT writes the nasal grunt as "हं"/"हँ" as often as "हम्म" — it cut
    # the opening restart in bd9e6a0d as a "real barge-in".
    "हं", "हँ", "हंजी", "haanji", "hanji", "hmmji",
    # A greeting while we are greeting is not a barge-in (call 8e2041c8: "नमस्ते।"
    # cut the restarted opening at 58 of 221 chars — the identity never played).
    "नमस्ते", "नमस्कार", "namaste", "namaskar", "namaskaar",
    "अच्छा", "अच्छे", "अछा", "ठीक", "है", "ओके", "सही", "बिल्कुल", "बिलकुल",
    "बढ़िया", "बढिया", "बहुत",
    "बोलिए", "बोलो", "बताइए", "बताओ", "सर", "मैम", "मैडम", "भैया", "ओ", "के",
    "बोल", "बोलें", "बोलिये",
    # Marathi "yes" — and how the STT writes some callers' "हाँ". Call 8208166f
    # (2026-10-01): "हो।" then "हो नमस्ते।" each cut the opening ~1.3 s in and
    # restarted it; the caller heard "नमस्ते जी, मैं श्रेया" three times in 4 s
    # and never why we called.
    "हो", "होय", "बरोबर", "आहे", "ho", "hoy",
    # Romanized Hindi / Hinglish
    "haan", "haa", "han", "ha", "hn", "hm", "hmm", "hmmm", "mm", "mhm", "mhmm",
    "ji", "jee", "jii", "achha", "accha", "acha", "achcha", "thik", "theek",
    "hai", "sahi", "bilkul", "badhiya", "badiya", "bahut", "boliye", "bolo",
    "bataiye", "batao",
    "sir", "sar", "madam", "mam", "maam", "bhaiya",
    # English
    "ok", "okay", "okey", "kk", "yes", "yeah", "yah", "ya", "yup", "yep",
    # Audio-checks: "are you there / can you hear me". A resumed sentence
    # answers these; a cancelled-and-restarted one does not.
    # "hi" was missing while hello/helo/hallo/hlo/hey were all here — an
    # oversight that cost call 2fc70065: the operator announcement's first
    # fragment was bare "Hi.", which fell through to INTERRUPT and drove a whole
    # LLM reply. It is the commonest greeting in English there is.
    "hello", "helo", "hallo", "hlo", "hey", "hi", "hii", "हेलो", "हैलो", "हलो", "हाय",
    "right", "correct", "sure", "fine", "good", "great", "cool", "alright",
    # Call 59888de8 (2026-09-22): "Obviously." and "हाँ that's" (the STT cut
    # "that's right") were real barge-ins, five regenerations of one line.
    "obviously", "exactly", "absolutely", "definitely", "true", "thats", "perfect",
    "go", "on", "ahead", "continue", "carry",
})

# Any of these ANYWHERE in the utterance forces INTERRUPT even if every other
# word is an acknowledgment — "haan nahi" is an objection, not consent.
_NEGATION_WORDS = frozenset({
    "नहीं", "नही", "ना", "मत", "नो",
    "nahi", "nahin", "nhi", "na", "no", "not", "dont", "don't", "stop",
    "mat", "but", "lekin", "लेकिन", "पर", "magar", "मगर",
})

# Punctuation stripped before matching — includes the Devanagari danda, which
# Sarvam appends to almost every final ("हाँ।").
# '?' included since 2026-09-15: without it "hello?" tokenised as "hello?" and
# matched NOTHING — is_audio_check never counted a hello, so the two-hello
# escalation ("Can you hear me?", then stop) could never fire in production.
_STRIP = "।॥.,!?？…\"'`~()[]{}:;-–—"


def _words(text: str) -> list:
    out = []
    for raw in (text or "").split():
        # An apostrophe inside a word is not a word boundary and not a letter:
        # "Ma'am." must read as "maam" (call bd9e6a0d, 2026-09-21: every
        # "हाँ Ma'am" was a real barge-in, 21 of them, and the parent said
        # "आपकी आवाज़ अटक रही है").
        w = raw.strip(_STRIP).replace("'", "").replace("\u2019", "").casefold()
        if w:
            out.append(w)
    return out


def mid_reply_action(text: str, extra_backchannels: frozenset = frozenset(),
                     max_words: int = 6) -> str:
    """Classify a caller final that arrived while the bot's reply is ducked.

    ABSORB only when EVERY word is a known acknowledgment, the utterance is
    short, and nothing negates or questions. Anything uncertain INTERRUPTS —
    wrongly stopping the bot costs a moment; wrongly steamrolling the caller
    costs the call (that asymmetry is the whole point of the fix).
    """
    t = (text or "").strip()
    if not t:
        return ABSORB          # nothing was said; nothing to interrupt for
    # "Hello?" mid-reply is a line check, not a question about the content.
    # Smallest puts the '?' on it, which used to route it to INTERRUPT: each
    # hello killed the re-ask that answered the previous hello, so the caller
    # only ever heard "Yes, I'm here." (campaign 2026-09-15, calls b1c4fe4f
    # and 2cfc4732: five hellos each). Absorbing lets the held reply finish —
    # and the second absorbed hello triggers "Can you hear me?" and stops.
    if caller_checking_presence(t):
        return ABSORB
    if "?" in t or "？" in t:
        return INTERRUPT       # a question mid-reply means they didn't follow
    ws = _words(t)
    if not ws or len(ws) > max_words:
        return INTERRUPT
    vocab = _BACKCHANNEL_WORDS | extra_backchannels
    for w in ws:
        if w in _NEGATION_WORDS:
            return INTERRUPT
        if w not in vocab:
            return INTERRUPT
    return ABSORB


# ── carrier announcements ──────────────────────────────────────────────────
# The network, not a person. On call 77cb4b47 the operator played "Your call has
# been forwarded to voicemail. The person you're trying to reach is not
# available." BEFORE the founder picked up, and the bot treated it as the callee
# speaking. Three things went wrong at once, all from that one mis-read:
#   * the scripted opening was SKIPPED ("callee spoke first"), so the call began
#     with silence and the founder said "hello?" twice into it;
#   * it counted as a barge-in, cancelling the reply that was starting;
#   * worst, it became the FIRST USER MESSAGE and stayed in the LLM context for
#     the whole 2.5-minute call — every single generation for the rest of the
#     call was conditioned on being told it had reached a voicemail box.
#
# Substring match on lowercased text, so partial finals ("...forwarded to
# voicemai") still match. Kept deliberately narrow: these are fixed operator
# recordings, and a human saying one of these sentences on a sales call is not a
# thing that happens.
# Match on FRAGMENTS, not whole sentences. Live evidence (call 14029bd6): Sarvam
# rendered "…after the tone" as the complete final "Add the tone." — chasing
# exact operator wording loses to the STT every time, so these are the short
# distinctive pieces that survive a mis-hear.
_CARRIER_PHRASES = (
    # English (Airtel / Jio / Vi / BSNL + generic)
    "forwarded to voicemail", "call has been forwarded", "leave a message after",
    "after the tone", "after the beep", "record your message",
    "the person you're trying to reach", "the person you are trying to reach",
    "is not available", "is currently busy", "the number you have dialled",
    "the number you have dialed", "the subscriber you have dialled",
    "the subscriber you have dialed", "is switched off", "out of coverage",
    "please try again later", "call cannot be completed", "temporarily out of service",
    "is unreachable", "not reachable", "incoming call facility",
    # Fragments — see the note above. Only ever consulted inside the
    # answering-machine window at the very start of a call.
    # Sarvam splits the SAME operator sentence at different points on different
    # calls, so match the pieces, not the sentence. Live evidence 2026-08-06:
    # one call produced 'Your call has been forwarded to voicemail.' (matched)
    # and the next produced 'Your call.' then 'Has been forwarded to voicemail.'
    # — the first fragment matched nothing, counted as the callee, and killed
    # our opening before the second fragment could arm anything.
    "your call", "been forwarded", "forwarded to", "record your", "leave a",
    "the person you", "trying to reach",
    # "record your name and reason for calling" split as "If you record your" +
    # "name and reason." on call 2fc70065 — the tail is three words, so the 1-2
    # word scrap filter cannot reach it, and no human answering a phone says it.
    "name and reason", "your name and", "and reason",
    # Call screening (Google/Pixel style): "If you record your name and reason
    # for calling, I'll see if this person is available." The SECOND fragment
    # matched nothing on calls 612f5e37 / 91d1541e (2026-09-14/15): it cut our
    # opening at 6 of 221 chars and the model replied to the screener.
    "see if this person", "this person is available", "if this person",
    "i'll see if", "ill see if", "person is available",
    # Call-connect bridges. JustDial plays "You are getting connected by Just
    # Dial" to the callee (transcribed as Josh/Job/Jove Dial on 2026-09-15);
    # it counted as the callee speaking first, our opening was SKIPPED on every
    # call of the campaign, and it became the caller's first message in the
    # model's context. The person picked up to silence and said "Hello?" x5.
    "getting connected", "being connected", "connected by", "connecting you",
    "connecting your call", "call is being connected", "just dial", "justdial",
    "the tone", "the beep", "voicemail", "voice mail", "record your message",
    "record your messages", "recording", "hang up", "leave a message",
    "leave your message", "not available", "unavailable", "please try again",
    # The operator's unpaid-number message (call e208c6e8, 2026-10-14): "The
    # number you are trying." / "Trying to reach." / "is not able to receive
    # call due to pending recharge." and the Hindi "आपके द्वारा डायल किए जा रहे
    # नंबर पर कॉल प्राप्त करने में असमर्थ है।" / "क्योंकि recharge बाकी है।". Two
    # of its pieces matched nothing, each cut the opening as a "real barge-in".
    # Operator-only wording: "not able to receive call" is what a person says
    # too ("Sorry, I am not able to receive call right now") and would drop
    # their words from the model's context (review 2026-10-14). The operator's
    # sentence still matches on "pending recharge", whole or as its last piece.
    "the number you are trying", "number you are trying to", "pending recharge",
    # Hindi
    "आप जिस नंबर", "डायल किया गया नंबर", "उपलब्ध नहीं", "स्विच ऑफ",
    "थोड़ी देर बाद", "व्यस्त है", "संपर्क क्षेत्र", "कृपया बाद में",
    "डायल किए जा रहे नंबर", "प्राप्त करने में असमर्थ", "recharge बाकी", "रिचार्ज बाकी",
)


# The call-connect bridges above (JustDial and the like). They play to the
# callee BEFORE the person answers, so a "Hello." just before one is plausibly
# the person — unlike a voicemail, which plays when nobody will (see
# is_call_connect and bot.TranscriptCollector's recording pieces).
_CONNECT_PHRASES = ("getting connected", "being connected", "connected by", "connecting you",
                    "connecting your call", "call is being connected", "just dial",
                    "justdial")


# The voicemail recorder's OWN prompts: it is taking a message, so nobody is on
# the line while it plays. Short "turns" between carrier lines count as pieces
# of the recording only on a call that played one of these
# (bot.TranscriptCollector.looks_like_voicemail). The generic lines ("not
# available", "please try again", the Hindi busy / call-later ones) also play
# when a person may be on the line, and a person's own words can match them —
# hanging up on those in silence is not a price worth a few billed seconds
# (review 2026-10-14). All six voicemails of 2026-10-14 played one.
_VOICEMAIL_PHRASES = ("voicemail", "voice mail", "the tone", "the beep", "record your message",
                      "leave a message", "leave your message", "finished recording",
                      "you may hang up")


_SCREENER_PHRASES = ("record your name", "name and reason", "see if this person",
                     "this person is available", "if this person", "i'll see if",
                     "ill see if", "person is available")


# What Google's call screen relays while the person decides ("Thanks Aarushi.
# Please stay on the line.", "…you're still in."). After the screener prompt
# these are the phone talking, not the callee (call b2f6330a: the model said
# "I will wait for you." and "I am still here." to them, then pitched).
_SCREENER_HOLD_PHRASES = ("stay on the line", "please hold", "hold on the line", "on hold",
                          "you're still in", "you are still in", "connecting you",
                          "one moment please")


# ── call on hold (mid-call) ────────────────────────────────────────────────
# The person put us on hold and the NETWORK plays its announcement, in both
# languages, on a loop: "आप जिस व्यक्ति से बात कर रहे हैं, उन्होंने आपके call को
# hold पर रखा है। कृपया लाइन पर बने रहें। The person you are speaking with has put
# your call on hold. Please stay on the line." (call 6d81124d, 2026-10-14). Read as
# the caller, every fragment was a turn: the bot answered the recording ("कोई बात
# नहीं", fillers, a REPLY_LOOP), then re-introduced itself when the person came
# back. Unlike the machine window, this can start at any point in the call.
#
# A false hold is worse than a missed one: missed, the bot answers a recording
# once; false, it goes SILENT on a real person and their words never reach the
# model. The first cut (53b6e16b04) entered on "दूसरी कॉल पर", "is on another call"
# and "please hold" anywhere in a line, so "पापा अभी दूसरी कॉल पर हैं, बाद में
# कीजिए" — a person asking for a call-back — got silence (review 2026-10-14). So
# ENTRY is the recording's own phrasing only, in two tiers:
#   * third-person recording sentences — nobody on a phone says "has put your
#     call on hold" or "one of our representatives will assist you" in their own
#     voice — enter whatever else the final carries;
#   * the polite requests ("stay on the line", "कृपया प्रतीक्षा करें") enter only
#     when they are the WHOLE final, every word from the recordings' vocabulary.
#     "Stay on the line, I will call my son", "Please hold, what is the fee?",
#     "थोड़ा प्रतीक्षा करें" are a person, and go to the model as a normal turn
#     (wait / busy / call-back is the prompt's job, as for any other answer).
# Nothing that sounds like a person (below) ever enters.
_HOLD_PHRASES = (
    # English (Airtel / Jio / Vi / BSNL), and IVRs ("Welcome to New Light
    # Institute. Stay on the line. One of our representatives will assist…").
    "put your call on hold", "has put your call", "your call is on hold",
    "your call has been put on hold", "your call has been placed on hold",
    "you have been placed on hold", "you have been put on hold",
    "the person you are speaking with", "the person you're speaking with",
    "the person you are speaking to", "the person you're speaking to",
    "the person you are talking to", "the person you're talking to",
    "the subscriber you are", "the subscriber you're",
    "one of our representatives", "one of our executives", "one of our agents",
    "will assist you shortly", "your call is important to us",
    # Hindi
    "आप जिस व्यक्ति से बात कर रहे हैं", "आप जिस व्यक्ति से बात कर रहे है",
    "जिस व्यक्ति से आप बात कर रहे हैं", "आप जिस व्यक्ति से बात कर रहे हो",
    "आप जिनसे बात कर रहे हैं", "hold पर रखा", "होल्ड पर रखा", "hold par rakha",
    "आपकी कॉल होल्ड पर", "आपका call hold पर", "आपकी call hold पर",
)
_HOLD_REQUESTS = (
    "stay on the line", "hold the line", "please hold", "please wait",
    "do not disconnect", "dont disconnect", "don't disconnect",
    "लाइन पर बने", "लाइन पर बनी", "लाइन पे बने", "लाइन पे बनी", "line पर बने",
    "कृपया लाइन पर", "कृपया लाइन पे", "प्रतीक्षा करें",
    "प्रतीक्षा कीजिए", "डिस्कनेक्ट न करें", "कॉल डिस्कनेक्ट न",
)
# Every word the hold recordings say (call 6d81124d's Hindi + English loop, the
# 2026-10-14 IVR "…Stay on the line. One of our representatives will assist.").
# WHOLE words: the first cut matched substrings, and "लाइन" inside "ऑनलाइन",
# "hold" inside "holding", "बात कर रहे" inside "आप कहाँ से बात कर रहे हैं?" kept a
# person who had come back on hold, unheard.
_HOLD_WORDS = frozenset({
    "आप", "जिस", "व्यक्ति", "से", "बात", "कर", "रहे", "हैं", "है", "उन्होंने", "आपके",
    "आपकी", "आपका", "आपको", "call", "कॉल", "को", "hold", "होल्ड", "पर", "रखा", "गया",
    "गई", "कृपया", "कृपा", "लाइन", "line", "बने", "बनी", "रहें", "प्रतीक्षा", "करें",
    "कीजिए", "डिस्कनेक्ट", "disconnect", "न", "ना", "वो", "वह", "अभी", "दूसरी", "दूसरे",
    "the", "person", "you", "youre", "are", "is", "speaking", "with", "to", "has", "have",
    "been", "put", "placed", "your", "on", "please", "kindly", "stay", "wait", "do",
    "not", "dont", "another", "one", "of", "our", "representatives", "representative",
    "executives", "executive", "agents", "agent", "will", "assist", "shortly", "soon",
    "see", "moment", "a", "while", "we", "connect", "connecting", "important", "us",
    # Other operators' wording of the same loop (review 2026-10-14): "…बात कर रहे हो",
    # "लाइन पे बने रहिए", "आप जिनसे…", "The person you are talking to", "The subscriber…".
    "हो", "पे", "रहिए", "रहिये", "जिनसे", "रखी", "करके", "talking", "subscriber",
    "connected", "being",
})
# A whole final counts as the recording only when it carries one of the words
# that ONLY the recordings say. Every word of "आप लाइन पर हैं", "वो अभी बात कर
# रहे हैं" (a child back to say the father is still busy) or "We will see" is
# recording vocabulary too, and those are a person (review 2026-10-14). Short
# generic bits ("रहे हैं।", "लाइन पर") are still caught by the scrap rule.
_HOLD_DISTINCT_WORDS = frozenset({
    "व्यक्ति", "उन्होंने", "जिनसे", "hold", "होल्ड", "कृपया", "कृपा", "बने", "बनी", "रहें",
    "रहिए", "रहिये", "प्रतीक्षा", "डिस्कनेक्ट", "disconnect", "person", "speaking",
    "talking", "subscriber", "stay", "kindly", "representatives", "representative",
    "executives", "executive", "assist", "shortly", "important", "placed", "connecting",
})
# Words the recordings never say and a person coming back does: "Sorry for the
# hold", "Thanks for holding", "I was on another call", "हाँ, लाइन पर हूँ, बोलिए".
# Bare "हाँ"/"yes" are NOT here — the STT hears a lone "हाँ।" in the recording
# itself (54.19 s on 6d81124d, 0.4 s after "Speaking with.").
_HOLD_PERSON_WORDS = frozenset({
    "i", "im", "ive", "ill", "me", "my", "mine", "myself", "sorry", "sory", "thanks",
    "thank", "thankyou", "holding", "tell", "go", "ahead", "back", "speak", "ok",
    "okay", "sir", "madam", "maam", "boliye", "bolo", "bataiye", "batayiye", "batao",
    "main", "mai", "mera", "meri", "mere", "mujhe", "hoon", "wapas",
    "बोलिए", "बोलिये", "बोलो", "बोलें", "बताइए", "बताइये", "बताईए", "बताओ", "बताएं",
    "कहिए", "कहिये", "मैं", "मैंने", "मेरा", "मेरी", "मेरे", "मुझे", "हूँ", "हूं",
    "सॉरी", "माफ़", "माफ", "वापस", "सर", "मैडम", "मैम", "ओके",
    # Past tense: a person explaining the hold ("होल्ड पर रखा था", "hold par rakha
    # tha", "I was on another call"); the recordings say "रखा है" / "has put".
    "था", "थी", "थे", "tha", "thi", "was", "had",
})
# A person's short answer, two or three words long ("हाँ जी", "Yes, sure").
_HOLD_AFFIRM_WORDS = frozenset({
    "हाँ", "हां", "हा", "जी", "हाँजी", "हांजी", "haan", "han", "haa", "ji", "haanji",
    "hanji", "yes", "yeah", "yep", "ya", "अच्छा", "achha", "acha", "ठीक", "theek",
    "thik", "हम्म", "हं", "hmm", "hm",
})
# The STT cuts the recording at a different point on every loop and mishears a
# piece now and then ("See shortly." / "But losing art." on the 2026-10-14 IVR).
# A short scrap this soon after a recognised piece is more of the same.
HOLD_SCRAP_SECS = 3.0


def sounds_like_person(text: str) -> bool:
    """While on hold (or deciding to enter it): words only the person says — a
    hello, a question, who-is-this, a goodbye, busy/call-back, "sorry", "I…",
    "बोलिए". Checked BEFORE any recording match, so "हेलो, आप लाइन पर हैं?" and
    "Who am I speaking with?" can never read as the recording."""
    t = " ".join((text or "").casefold().split())
    if not t or t.startswith("["):
        return False
    if "?" in t or "？" in t:
        return True                        # the recordings never ask anything
    if (caller_checking_presence(t) or is_audio_check(t) or caller_asks_who(t)
            or caller_wants_to_end(t) or caller_is_busy(t)):
        return True
    return any(w in _HOLD_PERSON_WORDS or w in HELLO_VARIANTS for w in _words(t))


def is_hold_announcement(text: str) -> bool:
    """A line that puts the call on hold: the network's hold recording or an IVR
    queue, never a person's own "he is on another call" / "please hold, …"."""
    t = " ".join((text or "").casefold().split())
    if not t or sounds_like_person(t):
        return False
    if any(p in t for p in _HOLD_PHRASES):
        return True
    ws = _words(t)
    return (any(p in t for p in _HOLD_REQUESTS)
            and bool(ws) and all(w in _HOLD_WORDS for w in ws))


# ── a phone menu that loops ──────────────────────────────────────────────────
# Call 5856b13f (2026-10-24): an admissions IVR answered, nobody pressed
# anything, and "You have entered an invalid option. Thank you for calling …
# Press 1 for …" replayed every 21 s for EIGHT minutes while the bot talked
# back to it 34 times. A person never says the same menu line three times.
_IVR_MENU = re.compile(
    r"\b(?:press|dial)\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|zero|star|hash)\b"
    r"|\b(?:invalid|wrong|incorrect)\s+(?:option|input|selection|entry|choice)\b"
    r"|\bnot a valid\s+(?:option|input|selection|entry|choice)\b"
    r"|\b\d\s+(?:dabaye|dabayen|dabayein|dabaiye|dabaen)\b"
    r"|दबाएं|दबाएँ|दबाइए|दबाये")
# How often one menu line may play before the menu counts as looping.
IVR_LOOP_REPEATS = 3


def ivr_menu_key(text: str) -> str:
    """The comparison key of a phone-menu line ("Press 1 for …", "invalid
    option"), or "" when the line is not one. PURE; the live gate counts these."""
    t = " ".join((text or "").casefold().split())
    if not t or not _IVR_MENU.search(t):
        return ""
    return spoken_key(t)


def is_hold_fragment(text: str) -> bool:
    """While on hold: a piece of the looping recording — every word of it is a
    word the recordings say ("उन्होंने आपके।", "Speaking with.", "See shortly.")."""
    ws = _words(text)
    return (bool(ws) and all(w in _HOLD_WORDS for w in ws)
            and any(w in _HOLD_DISTINCT_WORDS for w in ws) and not sounds_like_person(text))


def hold_absorbs(text: str, secs_since_hold_line: float) -> bool:
    """While on hold: is this final more of the recording (True — keep quiet) or
    the person back (False — it goes to the model as their turn)? PURE; the live
    gate (TranscriptCollector) and sim.replay share it."""
    ws = _words(text)
    if not ws:
        return True                        # "।" — nothing anybody said
    if sounds_like_person(text):
        return False
    if is_hold_announcement(text) or is_hold_fragment(text):
        return True
    if secs_since_hold_line < HOLD_SCRAP_SECS:
        # A lone word right after a piece of the recording is the STT hearing
        # the recording ("हाँ।" on 6d81124d); a two-three word scrap is too
        # unless it carries a person's answer ("हाँ जी", "Yes, sure").
        if len(ws) == 1:
            return True
        return len(ws) <= 3 and not any(w in _HOLD_AFFIRM_WORDS for w in ws)
    return False


def is_screener_hold(text: str) -> bool:
    t = (text or "").casefold()
    return any(p in t for p in _SCREENER_HOLD_PHRASES)


def is_call_screener(text: str) -> bool:
    """A screening prompt: the phone answered, NOT the person. Our opening plays
    into the screener's recorder; the human who then picks up has heard none of
    it, so their first "Hello" must get the opening again."""
    t = (text or "").casefold()
    return any(p in t for p in _SCREENER_PHRASES)


def is_call_connect(text: str) -> bool:
    """A call-connect bridge ("You are getting connected by Just Dial"): the
    network talking to someone who may be picking up right now."""
    t = (text or "").casefold()
    return any(p in t for p in _CONNECT_PHRASES)


def is_voicemail_prompt(text: str) -> bool:
    """The voicemail recorder's own prompt ("…forwarded to voicemail.", "Please
    record your message.", "…at the tone."), not merely a carrier line."""
    t = (text or "").casefold()
    return any(p in t for p in _VOICEMAIL_PHRASES)


def is_carrier_announcement(text: str) -> bool:
    """True when a transcript is the OPERATOR's recorded message, not the callee.

    Callers of this must not feed the text to the LLM, must not let it count as
    "the callee spoke first", and must not let it interrupt the bot — but SHOULD
    still keep it in the call transcript, because the answering-machine detector
    reads exactly these markers to raise LIKELY_MACHINE.
    """
    t = (text or "").casefold()
    if not t.strip():
        return False
    return any(p in t for p in _CARRIER_PHRASES)


# ── audio-checks ───────────────────────────────────────────────────────────
# "hello?" mid-reply is its own thing: not consent to carry on (a backchannel)
# and not a new question, but the caller checking whether the line is alive.
# It gets absorbed like a backchannel, but the CALLER'S SECOND one in a row
# means the first response did not work and repeating the sentence again will
# not either — see TranscriptCollector, which switches to a short "can you hear
# me?" and then stops talking.
# "Hello" as the STT spells it across the agents' languages. Call f9b9f575
# (2026-09-25, Shreya-marathi): Marathi "हॅलो" matched nothing, so a pickup
# "hello" read as an answer and the re-said opening was scored a replay.
HELLO_VARIANTS = frozenset({
    "hello", "helo", "hallo", "hlo", "hullo",
    "हेलो", "हैलो", "हलो", "हॅलो", "हॅल्लो", "हेल्लो", "हालो",            # Devanagari (hi, mr)
    "હેલો", "હલો",                                                      # Gujarati
    "হ্যালো", "হেলো",                                                    # Bengali
    "ਹੈਲੋ", "ਹੈਲੋ",                                                      # Gurmukhi
    "ஹலோ", "ஹல்லோ",                                                    # Tamil
    "హలో", "హల్లో",                                                     # Telugu
    "ಹಲೋ", "ಹಲ್ಲೋ",                                                      # Kannada
})
_AUDIO_CHECK_WORDS = frozenset({"hey", "hi", "hii", "हाय"}) | HELLO_VARIANTS


def is_audio_check(text: str, max_words: int = 3) -> bool:
    """True for a bare "hello?"-style line-check (in any of our scripts)."""
    ws = _words(text)
    if not ws or len(ws) > max_words:
        return False
    return any(w in _AUDIO_CHECK_WORDS for w in ws)


def suppresses_opening(text: str, min_words: int = 4) -> bool:
    """Should this caller utterance make us SKIP our scripted opening?

    Only something substantive should. The greet gate used to skip on ANY
    transcript, so a single stray word decided it — and on a voicemail the
    stray words are the operator's own recording arriving in fragments
    ('Hi.', 'Your call.', 'If you record your'). Three calls on 2026-08-06 lost
    their opening that way, and the model improvised a replacement, which is how
    one of them delivered its introduction twice.

    A caller who genuinely opens with "who is this, why are you calling me" is
    substantive and still takes over. "Hello?" is not.
    """
    t = (text or "").strip()
    if not t or is_carrier_announcement(t) or is_audio_check(t):
        return False
    return len(_words(t)) >= min_words


# ── saying the same thing twice ────────────────────────────────────────────
# FOUR prompt-level attempts failed to stop this, each measured over 3+ live
# conversations: style rules in the system prompt (1.7 -> 1.7 repeats, and it
# broke script and gender), no-echo rules with GALAT/SAHI examples in the script
# (3.0 -> 3.0 echoes), removing the scripted acknowledgement lines the model was
# parroting (2.7 -> 2.7), and swapping the model (helps, 1.0 -> 0.3, but the
# founder reverted for latency). The prompt is ~16k characters; it is saturated.
#
# What actually repeats is not the pitch — it is the bot's OWN CLOSING
# QUESTIONS: "kya aap fees ke baare mein jaanna chahenge?" and "kya main is
# WhatsApp number par link bhej doon?", asked again several turns later, because
# nothing tracks which questions have already been put to the caller. That is
# state, and state belongs in code.
_ASK_AGAIN_WORDS = frozenset({
    "repeat", "again", "dobara", "phir", "dubara", "samajh", "sunai", "sunayi",
    "kya", "pardon", "sorry", "दोबारा", "फिर", "समझ", "सुनाई",
})


_END_PHRASES = (
    "cut the call", "end the call", "hang up", "don't call", "dont call", "do not call",
    "stop calling", "not interested", "no interest", "don't need", "dont need", "do not need",
    "wrong number", "galat number", "not required", "remove my number", "unsubscribe",
    "phone rakh", "call rakh", "rakhti hoon", "rakhta hoon", "band karo", "zaroorat nahi",
    "jarurat nahi", "nahi chahiye", "interest nahi", "mat karo call", "call mat",
)
_BYE_WORDS = frozenset({"bye", "goodbye", "byebye", "bbye", "tata", "alvida"})
# The same asks as Sarvam writes them — Devanagari, often mixed with English.
# Call f1368e22 (2026-10-01): "काट कर रख दो", "cut करो", "call cut कर दो" (and
# "phone रख दो" / "काट दो" in the same family) matched nothing above, and the bot
# talked for another 4.5 minutes. Imperatives only ("मार्क्स कट गए" is not a
# request), and "रहने दो" stays OUT — it means "leave that topic".
_END_RE_HI = re.compile(
    r"(call|कॉल|phone|फोन|फ़ोन)\s*(cut|कट|काट)"
    r"|(cut|कट)\s*(करो|कर\s*दो|कर\s*दीजिए|कर\s*दें|कीजिए)"
    r"|काट\s*(कर\s*)?(रख\s*)?(दो|दीजिए|दिजिए|दें)"
    r"|(phone|फोन|फ़ोन|call|कॉल)\s*(रख\s*(दो|दीजिए|दिजिए|दें)|रखो|रखिए)"
    r"|(call|कॉल|phone|फोन|फ़ोन)\s*(बंद|band)\s*(करो|कर\s*दो|कीजिए|कर\s*दीजिए)"
    r"|मत\s*(call|कॉल|phone|फोन|फ़ोन)\s*(करो|करना|कीजिए)"
    r"|(call|कॉल|phone|फोन|फ़ोन)\s*मत\s*(करो|करना|कीजिए)"
    r"|(ग़लत|गलत|रॉन्ग)\s*(नंबर|number)"
    r"|(ज़रूरत|जरूरत|interest|इंटरेस्ट|रुचि)\s*नहीं|नहीं\s*चाहिए", re.I)


_FAREWELL_RE = re.compile(
    r"(namaste|namaskar|good ?bye|bye|take care|have a (good|great|nice) (day|evening|one)|"
    r"shubh din|alvida|dhanyavaad|dhanyawad|नमस्ते|नमस्कार|अलविदा|शुभ दिन|धन्यवाद)", re.I)


def is_farewell(response_text: str) -> bool:
    """Does the bot's response END on a goodbye? PURE.

    Recordings 4acc56a6 / 6fa15c09 (2026-09-09/10): the model said
    "आपके समय के लिए धन्यवाद, नमस्ते" WITHOUT <<END_CALL>>, so nothing closed the
    line; eight seconds later the idle clock nudged "Hello, can you hear me?"
    after the goodbye. A goodbye is a goodbye whether or not the marker came.
    Narrow on purpose: last sentence only, short, no question, and it must
    carry a farewell word — "जी सर, धन्यवाद। क्या मैं…" mid-call is not one."""
    t = " ".join((response_text or "").split())
    if not t or "?" in t or "？" in t:
        return False
    parts = [p for p in re.split(r"(?<=[.!।])\s+", t) if p.strip()]
    last = parts[-1] if parts else t
    if len(last.split()) > 14:
        return False
    return bool(_FAREWELL_RE.search(last))


def caller_wants_to_end(text: str) -> bool:
    """Did the caller just ask us to stop — end the call, don't call, not
    interested, wrong number, or a goodbye? PURE.

    Calls ada2e60c and the simulator (2026-09-12): to "I don't need your
    assistance, cut the call" the model replied "Just to clarify…" — twice on
    Gemini even with a prompt rule saying not to. A prompt rule is a request;
    this is the enforcement: the turn-gate cues a one-line goodbye and the
    sentinel ends the call whatever the model writes. Deliberately narrow —
    "not now" / "busy" / "later" are NOT here (those want a call-back)."""
    t = " ".join((text or "").casefold().split())
    if not t:
        return False
    if any(p in t for p in _END_PHRASES) or _END_RE_HI.search(t):
        return True
    ws = _words(t)
    return bool(ws) and (ws[-1] in _BYE_WORDS or (len(ws) <= 4 and bool(set(ws) & _BYE_WORDS)))


_PRESENCE_WORDS = frozenset({"hi", "haan", "ji", "yes", "yeah"}) | HELLO_VARIANTS
_PRESENCE_PHRASES = ("are you there", "you there", "still there", "can you hear", "sun rahe",
                     "sun rahi", "sun pa rahe", "awaaz aa rahi", "aawaz aa rahi", "hai kya", "koi hai",
                     # Back from a hold (review of 53b6e16b04, 2026-10-14).
                     "are you on the line", "are you still on the line")


def caller_checking_presence(text: str) -> bool:
    """"Hello? Hello, hello?" / "Are you there?" — the caller lost the thread
    and is checking the line, not answering. Call f08f5712 (2026-09-12): after
    the bot's question the caller said "Hello?" and got "Yes, I'm here." with
    the question never repeated; they said hello four more times and hung up."""
    t = (text or "").casefold()
    if t.startswith("["):
        return False                       # a synthetic cue, not speech
    if any(p in t for p in _PRESENCE_PHRASES):
        return True
    # Letters and marks of Latin and every Indic script (U+0900-0DFF), so a
    # Gujarati or Tamil "hello" is a word here too.
    ws = re.findall(r"[a-z\u0900-\u0dff']+", t)   # _words keeps the '?' on 'hello?'
    return (1 <= len(ws) <= 6 and all(w in _PRESENCE_WORDS for w in ws)
            and any(w in HELLO_VARIANTS for w in ws))


def presence_cue(question: str) -> str:
    """The turn-gate's cue when the caller is checking the line: confirm, then
    put the question they lost back on it. Shared with the text simulator."""
    return ("[The caller is checking whether you are still on the line — they did not "
            "hear or lost your question. Reply in ONE breath: confirm in two or three "
            "words, then ask this again in the same words: \"" + question + "\" Nothing else.]")


# How many words may follow the bot's last "?" for an acknowledgement over them
# to still be the ANSWER to that question. Two reasons for the slack, one
# number: text reaches the played transcript per word, so by the time a "yes"
# is transcribed a few words of the next sentence have played ("…right now? Is
# that" — timing sim yes_over_tail, 2026-09-12); and the scripted close puts a
# short sentence after the question ("…कर दूँ? पंद्रह questions हैं, सिर्फ
# पंद्रह मिनट लगते हैं।" — call 71d0d5bd, 2026-10-02, where the mother's "हाँ"
# over it was dropped as "just listening" and both sides waited 29 s).
QUESTION_TAIL_WORDS = 8


def ends_on_question(text: str, tail_words: int = QUESTION_TAIL_WORDS) -> bool:
    """Did this stretch of bot speech end on a question — its last "?" followed
    by at most `tail_words` words? PURE. The one test every turn-gate path uses
    to decide whether a short "हाँ"/"yes" over the end of a reply answered it;
    when they disagreed, the same "हाँ" was an answer on one path and a
    backchannel on another (call 71d0d5bd)."""
    t = (text or "").rstrip()
    if t.endswith(("?", "？")):
        return True
    i = max(t.rfind("?"), t.rfind("？"))
    return i >= 0 and len(t[i + 1:].split()) <= tail_words


def last_question_in(text: str) -> str:
    """The last question sentence in a block of bot speech, skipping the bot's
    own line checks ("Hello? Are you still there?"), or ''."""
    sents = [x.strip() for x in re.split(r"(?<=[.!?।])\s+", text or "") if x.strip()]
    qs = [x for x in sents if x.endswith(("?", "？")) and not caller_checking_presence(x)]
    return qs[-1] if qs else ""


_TERMINAL = (".", "?", "!", "।", "？", "…")


def is_fragment_continuation(prev: str, text: str, dt: float, window: float = 1.0) -> bool:
    """Smallest finalizes the decoded PREFIX at our VAD stop and the remainder
    arrives as its own final 0.3-0.9 s later: "…say somet" + "hing", "frie" +
    "nd", "? It makes" + "some" (call 31763255, 2026-09-12). The second piece is
    the same utterance, not a new one — it must never count as a barge-in."""
    if not prev or not text or dt < 0 or dt > window:
        return False
    t = text.strip()
    if t.startswith("["):
        return False
    if caller_checking_presence(t) or caller_wants_to_end(t):
        return False                      # "Hello." / "cut the call" are never a tail
    if prev.rstrip().endswith(_TERMINAL):
        return False                      # the previous piece was a finished sentence
    first = t[0]
    if first.islower() and first.isascii():
        return True                       # "hing", "nd", "some", "me?" — the engine
                                          # only capitalises a sentence START
    if not first.isascii() and first.isalpha() and len(t.split()) <= 4:
        # Devanagari has no case to read. "आप कौन बोल रहे" + "हैं?", "…पिता बोल
        # रहा" + "हूँ।" (calls 91d1541e, 612f5e37): the tail carries the sentence
        # end, which is exactly why it is the tail.
        return True
    # Neither piece is punctuated as a sentence and the tail is short: one breath.
    return not t.endswith(_TERMINAL) and len(t.split()) <= 4


# Words that carry no content of their own in a restatement: function words,
# acknowledgments, and the generic verbs/time words a confirmation is built from.
_ECHO_STOP = frozenset({
    "so", "okay", "ok", "alright", "right", "now", "then", "all", "just", "currently",
    "at", "the", "moment", "it", "its", "it's", "is", "are", "was", "were", "be", "being",
    "you", "you're", "your", "youre", "we", "they", "they're", "not", "no", "any", "do",
    "does", "doing", "done", "did", "run", "runs", "running", "take", "takes", "taking",
    "have", "has", "having", "only", "and", "or", "of", "a", "an", "in", "on", "for", "to",
    "that", "this", "these", "those", "there", "mostly", "basically", "means", "mean",
    "means", "yes", "yeah", "great", "got", "understood", "i", "see", "as", "with", "by",
    "ji", "haan", "toh", "achha", "theek", "hai", "hain", "aap", "aapka", "aapki", "ka",
    "ki", "ke", "mein", "me", "abhi", "bilkul", "matlab", "sir", "ma'am", "maam", "madam",
})


def _stem(w: str) -> str:
    return w[:5]


def is_echo_of_answer(sentence: str, caller_text: str, bot_question: str = "") -> bool:
    """Is this whole sentence just the caller's answer said back — every content
    word already in what they said or in the question we asked? Calls 15aadcdb
    ("It is offline." → "Okay, so it's all offline right now." / "So no online
    classes at all then?"), 859c20ee ("we maintain Excel sheet" → "You're
    maintaining an Excel sheet."), 08df7128 ("Okay, so they do UPI."). Not when
    the caller asked something (then the sentence is an answer), and never for
    a sentence that brings a new content word."""
    if not sentence or not (caller_text or "").strip():
        return False
    # A question by the caller makes the sentence an answer, not an echo. The
    # loose cue-anywhere test would call "they can do UPI" a question; a '?' or
    # a leading question word is the honest signal on a punctuating engine.
    ct = caller_text.strip()
    cw = _words(ct)
    if "?" in ct or "？" in ct or (cw and cw[0] in _QUESTION_CUES):
        return False
    def _toks(t: str) -> list:
        # _words keeps '?' on the last token ("then?"); strip sentence marks.
        return [w.strip("?？.!,") for w in _words(t) if w.strip("?？.!,")]
    ws = _toks(sentence)
    if not ws or len(ws) > 12:
        return False
    content = [w for w in ws if w not in _ECHO_STOP and w not in _BACKCHANNEL_WORDS]
    if not content:
        return False                      # content-free, handled elsewhere
    ref = {_stem(w) for w in _toks(caller_text)} | {_stem(w) for w in _toks(bot_question)}
    return all(_stem(w) in ref for w in content)


_WHO_PHRASES = ("who is this", "who's this", "who are you", "who is calling", "who's calling",
                "who is speaking", "who am i speaking", "kaun bol", "kon bol", "aap kaun",
                "aap kon", "kaun hai", "kon hai", "kahan se bol", "where are you calling from",
                "which company", "कौन बोल", "आप कौन", "कहाँ से",
                # "Uh, can I know the name of your…" (call b2f6330a) — the model
                # answered with its script line instead.
                "know the name", "name of your", "your name", "naam kya", "आपका नाम", "aapka naam",
                # "हाँ जी, कौन बात कर रहे हैं?" — how a person back from a hold asks.
                "कौन बात कर रहे", "कौन बात कर रही", "kaun baat kar rahe", "kaun baat kar rahi")


_TAKEOVER_WORDS = frozenset({
    "कौन", "क्यों", "कहाँ", "कहां", "किसलिए", "कैसे", "किसने", "किससे",
    "who", "why", "where", "which", "how", "kaun", "kyun", "kyu", "kahan", "kaise",
})


_QUESTION_WORDS = frozenset({
    "क्या", "कौन", "कितना", "कितनी", "कितने", "कब", "कहाँ", "कहां", "क्यों", "कैसे", "किस",
    "what", "who", "how", "when", "where", "why", "which", "kya", "kaun", "kitna", "kab",
    "kahan", "kyun", "kaise",
})


def is_question(text: str) -> bool:
    """Did the caller ask something? A question mark, or a question word."""
    t = (text or "").strip()
    if not t or t.startswith("["):
        return False
    if "?" in t or "？" in t:
        return True
    return any(w in _QUESTION_WORDS for w in _words(t))


_BUSY_PHRASES = (
    "busy", "बिज़ी", "बिजी", "व्यस्त", "time नहीं", "टाइम नहीं", "समय नहीं", "वक्त नहीं", "वक़्त नहीं",
    "बाद में", "baad me", "baad mein", "later", "अभी नहीं", "abhi nahi", "not now", "driving",
    "drive कर", "गाड़ी चला", "गाडी चला", "bike चला", "बाइक चला", "meeting में", "in a meeting",
    "free नहीं", "फ्री नहीं", "urgency", "urgent",
)


def caller_is_busy(text: str) -> bool:
    """"अभी time नहीं है madam" / "I'm driving" / "बाद में call करना" — a real
    answer that wants a call-back, not a pickup "hello". Call 1f2b97ab
    (2026-10-01): said twice over the opening, and both times the opening
    started again from "नमस्ते जी"; they hung up at 15 s."""
    t = " ".join((text or "").casefold().split())
    return bool(t) and not t.startswith("[") and any(p in t for p in _BUSY_PHRASES)


# Measured on live openings (2026-10-01): Shreya's 168 key chars play in
# 12.4 s, Aarushi's 41 in 3.0 s — ~13.6/s. 12/s makes the estimate a little
# LONGER than the audio, so "heard half of it" needs a little more time.
_OPENING_KEY_CHARS_PER_SEC = 12.0


def opening_expected_secs(opening: str) -> float:
    """Roughly how long the scripted opening plays, from its text."""
    return len(spoken_key(opening)) / _OPENING_KEY_CHARS_PER_SEC


def takes_over_opening(text: str) -> bool:
    """Before our opening has been heard, does THIS utterance earn a model
    reply instead? Only a question to us, a refusal, or our own cue does.
    Call 4243a436 (2026-09-22): the callee was mid-conversation with someone
    in the room — "तो गुजर जाएगी", "सेटिंग कम हो जाएगी", "नहीं वो तो ठीक था" —
    and each ran the model or cut the opening; he heard "समझ सकती हूँ, नाम
    क्या है?" from a stranger and asked who was calling at 33 s."""
    t = (text or "").strip()
    if not t:
        return False
    if t.startswith("["):
        return True                    # our own steering cue
    if caller_asks_who(t) or caller_wants_to_end(t) or caller_is_busy(t):
        return True
    if is_audio_check(t) or caller_checking_presence(t):
        return False                   # "Hello?" — the opening IS the answer
    if "?" in t or "？" in t:
        return True
    return any(w in _TAKEOVER_WORDS for w in _words(t))


def caller_asks_who(text: str) -> bool:
    """"Who is calling?" in any of the ways callers say it."""
    t = (text or "").casefold()
    return any(p in t for p in _WHO_PHRASES)


_GOODBYE_WORDS = frozenset({
    "thank", "thanks", "thankyou", "you", "ok", "okay", "bye", "goodbye", "namaste",
    "namaskar", "dhanyavaad", "dhanyawad", "shukriya", "theek", "hai", "sure", "great",
    "fine", "alright", "welcome", "ji", "sir", "ma'am", "maam", "madam", "haan", "yes",
    "धन्यवाद", "नमस्ते", "ठीक", "है", "जी", "शुक्रिया", "ओके",
})


def caller_says_goodbye(text: str) -> bool:
    """After OUR goodbye: "Thank you." / "Okay, bye." / "Theek hai ji" is theirs."""
    if caller_wants_to_end(text):
        return True
    ws = _words(text)
    return 0 < len(ws) <= 5 and all(w in _GOODBYE_WORDS for w in ws)


# "I could not follow you" is a request to say it again, and it is almost never
# five words long. Call 0c42d3a6 (2026-09-18): "क्या बोल रहे हैं समझ नहीं आया"
# is SEVEN words, so the old length cap missed it, the clarification the model
# wrote was dropped as already-said, and the parent got an apology and 7.6 s of
# silence before having to say "Hello." to unstick the call.
#
# The cap existed to keep "समझ आ गया" (I DID understand) out, so the test is the
# NEGATION, not the length: a hearing/understanding word next to a negation.
_NOT_HEARD_WORDS = frozenset({
    "समझ", "समझा", "समझी", "समझे", "समझमें", "सुनाई", "सुना", "सुनी", "सुन",
    "आवाज", "आवाज़", "clear", "samajh", "samjha", "sunai", "suna",
    "understand", "understood", "hear", "heard", "catch", "caught", "follow",
    "audible", "clearly",
})
_NEGATIONS = frozenset({
    "नहीं", "नही", "ना", "न", "nahi", "nahin", "na",
    "not", "no", "didn't", "didnt", "don't", "dont", "can't", "cant", "cannot",
    "couldn't", "couldnt", "won't", "unable",
})


def could_not_hear_us(text: str) -> bool:
    """Did they just say they could not hear or follow what we said? True only
    when a hearing/understanding word sits within three tokens of a negation,
    so "समझ आ गया" / "yes, clear" (no negation) are NOT this."""
    ws = _words(text)
    if not ws:
        return False
    heard = [i for i, w in enumerate(ws) if w in _NOT_HEARD_WORDS]
    if not heard:
        return False
    negs = [i for i, w in enumerate(ws)
            if w in _NEGATIONS or (w.endswith("n't") and len(w) > 3)]
    return any(abs(i - j) <= 3 for i in heard for j in negs)


_WHAT_TO_SAY = re.compile(
    r"(क्या\s*(बोलूं|बोलूँ|बोलू|बताऊं|बताऊँ|बताऊ|बताना\s*है|बोलना\s*है|पूछ\s*रही|पूछा))"
    r"|(kya\s*(bolu|boloon|bataun|batau|batana\s*hai|bolna\s*hai))"
    r"|(what\s*(should|do)\s*i\s*(say|tell))|(what\s*did\s*you\s*ask)")


def caller_asked_to_repeat(text: str) -> bool:
    """Did the caller ASK us to say it again? Then repeating is correct."""
    ws = set(_words(text))
    if not ws:
        return False
    t = (text or "").casefold()
    # "Who is this?" after the opening IS a request to hear the intro again —
    # the gate dropped "I'm Aarushi, from Vacademy." as already-said and asked
    # the model for a "next step" twice (call 180504b7, 2026-09-15).
    if caller_asks_who(t):
        return True
    if "again" in ws and ws & {"say", "come", "tell", "sorry"}:
        return True                       # "say that again", "come again?", "sorry, again?"
    if "sorry" in ws and len(ws) <= 2:
        return True                       # "Sorry?" — they missed it
    if could_not_hear_us(text):
        return True                       # "समझ नहीं आया", "I didn't catch that"
    # "समझ"/"सुनाई" are NOT here any more: bare, they also match "समझ गया सर"
    # (I DID understand), which is the opposite request — could_not_hear_us
    # above reads the negation instead. "phir"/"फिर" ("फिर से बोलिए") stays.
    # "क्या बोलूं?" / "क्या बताऊँ?" / "what should I say?" — they did not
    # catch WHAT we asked, so the question again is the reply. Call 3ad7f590
    # (2026-09-30): read as a question to answer, the model re-introduced
    # itself instead of re-asking the child's name and class.
    if len(ws) <= 5 and _WHAT_TO_SAY.search(t):
        return True
    return bool(ws & {"repeat", "dobara", "dubara", "दोबारा"}) or (
        len(ws) <= 5 and bool(ws & {"phir", "फिर"}))


def is_repeat(sentence: str, spoken, threshold: float = 0.80) -> bool:
    """Has this sentence already been said, in these words or near enough?

    Fuzzy on purpose: the model re-renders its own question slightly differently
    every time ("Kya aap iski fees ke baare mein jaanna chahenge" vs "chahengi"),
    and an exact match would catch none of the real cases.

    Short fragments are never repeats — "haan", "theek hai", "achha" legitimately
    recur, and suppressing them would strip the bot of every acknowledgement.

    COST. This is called for every sentence of every reply, on a 1-vCPU box
    carrying up to ten concurrent calls, and ``spoken`` grows for the whole call.
    A full ratio() against each entry measured 10 ms per sentence at 150 spoken
    sentences and 29 ms at 400 — in the audio path, per sentence. So: hold seq2
    fixed (SequenceMatcher caches its index for b, and rebuilding it per entry
    was most of the cost) and screen with real_quick_ratio/quick_ratio, which are
    UPPER BOUNDS on ratio() — skipping below the threshold cannot change a single
    answer, it only skips work that could not have qualified.
    """
    import difflib
    t = " ".join((sentence or "").split()).casefold()
    if len(t) < 22:
        return False
    # autojunk left at its default on purpose: changing it changes ratio() itself,
    # and this optimisation must be answer-for-answer identical to what shipped.
    sm = difflib.SequenceMatcher(None, "", t)
    for prev in spoken or ():
        sm.set_seq1(prev)
        if sm.real_quick_ratio() < threshold or sm.quick_ratio() < threshold:
            continue
        if sm.ratio() >= threshold:
            return True
    return False


def normalize_spoken(sentence: str) -> str:
    return " ".join((sentence or "").split()).casefold()


def spoken_key(text: str) -> str:
    """Letters, digits and combining marks only, casefolded, no spaces — for
    "was this sentence in what played?" The played transcript is rebuilt from
    the vendor's per-word timestamps, which do not carry our punctuation ("—",
    "50+", "।"), so a plain substring test failed on exactly those sentences
    and the gate un-recorded lines the caller had heard for 27 s (call
    f28888b2, 2026-09-15) — then said them again."""
    import unicodedata
    return "".join(ch for ch in (text or "").casefold()
                   if unicodedata.category(ch)[0] in ("L", "N", "M"))


# ── asking the same QUESTION twice, in different words ─────────────────────
# Sentence similarity catches a re-rendered sentence but not a paraphrase. Live
# call 597aeb3f asked for the class twice — "Aur wo abhi kis class mein hai?"
# then "Raman abhi kis class mein padh raha hai?" — which score about 0.6
# against each other and sailed through a 0.80 gate.
#
# A counselling call asks a FIXED, SMALL set of questions, so the robust key is
# not the wording but the SUBJECT: name, class, marks, weak subject, fees, the
# quiz link, the counselling slot. Ask about the same subject twice and it is a
# repeat however it is phrased.
_QUESTION_TOPICS = (
    ("child_name", ("naam", "नाम", "name")),
    # marks BEFORE klass: "पिछली class में कितने marks आए थे?" is the marks
    # question, and filing it under klass made the gate treat it as a re-ask
    # of the class question (call 22062aac, 2026-09-29).
    ("marks", ("marks", "मार्क्स", "score", "स्कोर", "percent", "परसेंट", "%")),
    ("klass", ("class", "क्लास", "kaksha", "कक्षा", "grade")),
    ("weak_subject", ("subject", "सब्जेक्ट", "dikkat", "दिक्कत", "weak", "kamzor")),
    ("fees", ("fees", "फीस", "fee", "price", "cost", "kitni hai")),
    # BEFORE quiz_link: "Is this number on WhatsApp?" shares the word with the
    # link question, and the topic dedupe dropped it twice as a re-ask of "you
    # send it to all your students on WhatsApp?" — the booking then ended on
    # "Okay. Okay. Yes, go ahead." (call b2f6330a, 2026-09-15).
    # The Hinglish form too: Shreya's close asks "क्या ये number WhatsApp पर है?" —
    # Latin "number" in a Devanagari sentence matched none of these, fell to
    # quiz_link, and the quiz question after it ("क्या मैं उसका link भी WhatsApp
    # कर दूँ?") was dropped as a re-ask of it in every simulated run (prompt v8
    # probe, 2026-10-02).
    ("whatsapp_number", ("this number", "same number", "whatsapp number", "number on whatsapp",
                         "ये नंबर", "यही नंबर", "yeh number", "yahi number", "isi number",
                         "ये number", "यही number", "इसी number", "number whatsapp",
                         "नंबर whatsapp", "whatsapp वाला number")),
    ("quiz_link", ("link", "लिंक", "quiz", "क्विज़", "whatsapp", "व्हाट्सएप")),
    ("counselling", ("counselling", "counseling", "काउंसलिंग", "session", "सेशन",
                     "slot", "book kar")),
    ("program_more", ("aur jaanna", "और जानना", "baare mein aur", "और बताना")),
)


# ── parroting the caller's own answer back at them ─────────────────────────
# Founder, 2026-08-12, after a live Shiksha Nation call: "every time the person
# answers, the AI again says okay. It asked how many marks, the person said
# ninety-four, and it comes back 'okay, you got ninety-four'. There is no need to
# reconfirm every time. It looks like an AI if you reconfirm everything."
#
# Three consecutive turns on that call opened with a restatement:
#   "अच्छा है सुबोध, तो सुबोध अभी कौन से क्लास में है?"
#   "ओके, सुबोध अभी आठवीं क्लास में है, तो … कितने मार्क्स आए थे?"
#   "सुबोध के लास्ट बहुत अच्छे, तिरानवे प्रतिशत मार्क्स, बहुत बढ़िया स्कोर है।"
#
# WHY IN CODE, not the prompt. This is the same class NoRepeatGate exists for,
# and the four measured prompt-only attempts recorded above (including no-echo
# rules with GALAT/SAHI examples: 3.0 -> 3.0) are exactly this experiment. A
# prompt rule ships alongside as a second line of defence; this is the first.
#
# CLAUSE level, not sentence level, because the parroting and the real question
# share one sentence — dropping the sentence would drop the question with it.
# What survives is anything the bot ADDED: "बहुत बढ़िया स्कोर है।" is a human
# reaction and stays; "तिरानवे प्रतिशत मार्क्स" is the caller's own words and goes.
_CLAUSE_SEP = ",;—–"

# Words that carry no answer content, so a clause made only of these plus the
# caller's own words is pure parroting. Deliberately function words only — a
# content word the caller did NOT say means the bot is adding something.
_ECHO_STOPWORDS = frozenset({
    "अभी", "में", "मे", "है", "हैं", "हूँ", "हूं", "था", "थी", "थे", "का", "की", "के",
    "को", "से", "पर", "ही", "भी", "और", "तो", "यह", "ये", "वो", "वह", "कि", "जी",
    "कर", "हो", "आप", "आपके", "आपका", "आपकी", "मैं", "उनका", "उनकी", "उनके", "उसका",
    "उसकी", "उसके", "इसका", "इसकी", "इसके",
    "is", "are", "was", "were", "the", "a", "an", "in", "at", "of", "to", "for",
    "and", "so", "has", "have", "had", "you", "your", "i", "it", "its", "that",
    "this", "he", "she", "his", "her", "their", "got", "get", "with", "on",
})
# A tag that only asks the caller to CONFIRM what came before it ("सही है?",
# "right?"). Once the read-back in front of it is trimmed, it confirms nothing:
# call a6849d85 (2026-09-30) took an order — "quantity पांच।" — and the bot's
# "पांच pieces, सही है?" reached the caller as a bare "सही है?", who said
# "Hello." after 3.6 s of silence. Reading an order back IS the next step.
_CONFIRM_TAGS = frozenset({
    "सही", "ठीक", "ना", "न", "नहीं", "पक्का", "correct", "right", "ok", "okay",
    "ओके", "confirm", "sure", "yes", "na", "sahi", "theek", "thik", "haina", "hai",
    "hain", "है", "हैं", "ये", "यह", "yeh", "ye", "that",
})
# Leading connectives left dangling once the parroting in front of them is gone.
_LEADING_CONNECTORS = frozenset({"तो", "और", "अब", "so", "and", "then", "now", "ok",
                                 "okay", "ओके"})
# Interrogatives, for "was the caller ASKING?" — reflecting a QUESTION back before
# answering it is wanted behaviour (it is a prompt rule), and must survive this.
_QUESTION_CUES = frozenset({
    "क्या", "कितना", "कितनी", "कितने", "कैसे", "कैसा", "क्यों", "कब", "कहाँ", "कहां",
    "कौन", "कौनसा", "किस", "kya", "kitna", "kitni", "kitne", "kaise", "kaisa",
    "kyun", "kyon", "kab", "kahan", "kaun", "what", "how", "why", "when", "where",
    "which", "who", "whom", "can", "could", "do", "does", "did", "will", "would",
})


def caller_asked_a_question(text: str) -> bool:
    """Was the caller's last turn a QUESTION rather than an answer?

    Reflecting a question back ("अच्छा, आप timing को लेकर पूछ रहे हैं —") is a
    prompt rule and good practice; parroting an ANSWER back is what the founder
    flagged. Sarvam does not reliably punctuate, so cues as well as '?'.
    """
    t = (text or "").strip()
    if not t:
        return False
    if "?" in t or "？" in t:
        return True
    return bool(set(_words(t)) & _QUESTION_CUES)


def strip_echo_opener(sentence: str, caller_text: str, bot_question: str = "",
                      max_clauses: int = 2, echo_ratio: float = 0.6) -> str:
    """PURE. Drop leading clauses that only repeat what the caller just said.

    Returns the trimmed sentence, or the sentence unchanged when there is nothing
    safe to drop. NEVER returns empty, and never drops:
      * a clause containing a question (that IS the next step),
      * a clause with two or more digit groups (a phone number / date read-back
        is required behaviour, see the CLOSE CONCRETELY prompt rule),
      * anything at all when the caller was ASKING rather than answering,
      * the last remaining clause, or a tail too thin to stand alone.

    A clause is parroting when nearly all of its CONTENT words (function words and
    acknowledgments removed) already appear in the caller's answer or in the bot's
    own question — i.e. it introduces nothing.
    """
    import re

    text = (sentence or "").strip()
    if not text or not (caller_text or "").strip():
        return sentence
    if caller_asked_a_question(caller_text):
        return sentence
    # Split on clause punctuation, keeping the separators so nothing is glued.
    clauses: list = []
    buf = ""
    for p in re.split(f"([{re.escape(_CLAUSE_SEP)}])", text):
        if p in _CLAUSE_SEP:
            clauses.append(buf)
            buf = ""
        else:
            buf += p
    clauses.append(buf)
    clauses = [c for c in clauses if c.strip()]
    if len(clauses) < 2:
        return sentence

    reference = set(_words(caller_text)) | set(_words(bot_question))
    acks = _BACKCHANNEL_WORDS
    dropped = 0
    while dropped < max_clauses and len(clauses) - dropped >= 2:
        clause = clauses[dropped]
        if "?" in clause or "？" in clause:
            break                       # a question is never a parroted answer
        ws = _words(clause)
        if not ws:
            dropped += 1
            continue
        if "?" in clause or "？" in clause:
            break
        if len(ws) > 10:
            break                       # too much said to be a bare restatement
        if len(re.findall(r"\d+", clause)) >= 2:
            break                       # a read-back we are required to do
        content = [w for w in ws if w not in acks and w not in _ECHO_STOPWORDS]
        if not content:
            dropped += 1                # pure acknowledgment ("ओके")
            continue
        overlap = sum(1 for w in content if w in reference)
        if overlap >= max(1, int(round(echo_ratio * len(content)))):
            dropped += 1
            continue
        break

    if not dropped:
        return sentence
    tail = clauses[dropped:]
    # Shed a connective the parroting used to hang off ("…, तो <question>").
    head_words = _words(tail[0])
    if head_words and head_words[0] in _LEADING_CONNECTORS:
        first = tail[0].strip()
        tail = [first.split(None, 1)[1] if " " in first else first, *tail[1:]]
    out = ", ".join(t.strip() for t in tail if t.strip()).strip()
    # A tail that cannot stand on its own is worse than the parroting.
    if len(_words(out)) < 3 and "?" not in out:
        return sentence
    # A bare confirmation tag asks about the words just trimmed: keep the read-back.
    if all(w in _CONFIRM_TAGS or w in _ECHO_STOPWORDS for w in _words(out)):
        return sentence
    if out[:1].islower() and text[:1].isupper():
        out = out[0].upper() + out[1:]
    return out or sentence


def question_topic(sentence: str):
    """Which of our standard questions is this, if any? None = not one of them.

    Only classifies actual QUESTIONS — a statement that merely mentions fees is
    not the fees question, and suppressing it would gut the pitch.
    """
    t = " ".join((sentence or "").split()).casefold()
    if not t or ("?" not in t and "？" not in t):
        return None
    for topic, cues in _QUESTION_TOPICS:
        if any(c in t for c in cues):
            return topic
    return None
