"""Does an English agent stay in English when its script pairs every line with Hinglish?

Calls 3bc5f884 / f8d8478b / be51d77f / 5b88b55c (2026-10-22): with callers who had
only said "Yes", the model spoke the script's Hinglish twin lines. This runs the
real build_system_prompt with a SYNTHETIC script of the same shape against Vertex,
with and without the LANGUAGE lock, and counts replies that contain Hindi.

    python -m probes.language_lock_probe [trials]
"""
from __future__ import annotations

import asyncio
import re
import sys

import app.bot as b
from sim.llm import make_chat

SCRIPT = """You are Aarushi, an AI calling assistant for Acme Leads, a CRM for sales teams.
Market: Indian businesses with enquiry-driven sales teams.

Style
- Normally up to three short sentences per turn; pause and listen. Mirror English or Hindi/Hinglish.
- Hindi: if they ask for Hindi or speak Hinglish, switch to easy spoken Hinglish. Keep business words in English.

1. Permission
AI — English: "I'm Acme Leads' AI calling assistant. May I take two minutes to tell you what we do?"
AI — Hinglish: "Main Acme Leads ki AI calling assistant hoon. Kya main do minute mein bata sakti hoon ki hum kya karte hain?"

2. Pitch
English: "Acme Leads is a CRM for sales teams. Leads from ads and your website come into one list, our AI calls each new lead within minutes, and follow-ups run automatically. How does your team handle new enquiries today?"
Hinglish: "Acme Leads sales teams ke liye ek CRM hai. Ads aur website ke leads ek list mein aate hain, hamara AI har nayi lead ko minutes mein call karta hai, aur follow-ups automatic chalte hain. Abhi aapki team nayi enquiries kaise handle karti hai?"

3. Discovery
D1: "Where do most enquiries come from?"
Hinglish: "Zyada enquiries kahan se aati hain?"

4. Demo
English: "Would a free 30-minute walkthrough be useful?"
Hinglish: "Kya aap 30-minute ka free walkthrough dekhna chahenge?"
""" * 3

OPENING = "Hello, am I speaking with Ravi? This is Aarushi from Acme Leads."
HI = re.compile(r"\b(aap|aapki|aapke|aapka|hai|hain|kya|kaise|main|hum|hamara|mein|nahi|karti|"
                r"karta|sakti|sakte|chahenge|bata|liye|abhi|theek|accha|haan|ji|hoon)\b", re.I)
DEVANAGARI = re.compile(r"[ऀ-ॿ]")

TURNS = {
    "yes_then_regarding": [("assistant", OPENING), ("user", "Yes.")],
    "pitch_after_permission": [("assistant", OPENING), ("user", "Yes."),
                               ("assistant", "Good afternoon Ravi. I'm Acme Leads' AI calling assistant. "
                                             "May I take two minutes to tell you what we do?"),
                               ("user", "Regarding.")],
    "asks_for_hindi": [("assistant", OPENING), ("user", "Yes. Can you please speak in Hindi?")],
}


def system_prompt() -> str:
    agent = {"id": "probe", "name": "Aarushi", "language": "english", "voice": "ipsita",
             "tts_model": "navana", "systemPrompt": SCRIPT, "direction": "OUTBOUND",
             "openingLine": OPENING}
    return b.build_system_prompt({"agent": agent, "instituteName": "Acme Leads",
                                  "direction": "OUTBOUND", "lead": {"name": "Ravi"}})


def classify(reply: str) -> str:
    if DEVANAGARI.search(reply):
        return "devanagari"
    return "romanized-hindi" if len(HI.findall(reply)) >= 3 else "english"


FIXED_STYLE = ("- LANGUAGE: Speak English for the whole call. The Hinglish lines below are only for "
               "a caller who asks for Hindi; never use them otherwise, and never mix the two in one reply.")
TURN_NOTE = "\n[Reply in English only — the caller has not asked for Hindi.]"


def variant_prompt(name: str, lock: str) -> str:
    b._ENGLISH_CALL_LANGUAGE_LOCK = lock if name in ("lock", "lock_at_end", "turn_note", "script+lock") else ""
    script = SCRIPT
    if name.startswith("script"):
        script = SCRIPT.replace("- Normally up to three short sentences per turn; pause and listen. "
                                "Mirror English or Hindi/Hinglish.", FIXED_STYLE)
    agent = {"id": "probe", "name": "Aarushi", "language": "english", "voice": "ipsita",
             "tts_model": "navana", "systemPrompt": script, "direction": "OUTBOUND",
             "openingLine": OPENING}
    system = b.build_system_prompt({"agent": agent, "instituteName": "Acme Leads",
                                    "direction": "OUTBOUND", "lead": {"name": "Ravi"}})
    if name == "lock_at_end":
        system = system.replace(lock, "") + lock
    return system


async def main(trials: int) -> None:
    chat = make_chat("vertex:gemini-2.5-flash")
    lock = b._ENGLISH_CALL_LANGUAGE_LOCK
    for variant in ("shipped",):
        system = system_prompt()
        assert system.rstrip().splitlines()[-1].startswith("- LANGUAGE: This is an English call.")
        for name, turns in TURNS.items():
            counts: dict[str, int] = {}
            for i in range(trials):
                msgs = [{"role": r, "content": t} for r, t in turns]
                for attempt in range(4):
                    try:
                        text, _ = await chat(system, msgs, 300, 0.7)
                        break
                    except Exception as e:  # shared Vertex quota with live calls: back off
                        print(f"  retry {attempt}: {str(e)[:120]}")
                        await asyncio.sleep(5 * (attempt + 1))
                else:
                    continue
                kind = classify(text)
                counts[kind] = counts.get(kind, 0) + 1
                print(f"[{variant}] {name} #{i}: {kind} | {text[:220]!r}")
                await asyncio.sleep(1.5)
            print(f"== {variant} {name}: {counts}")
    b._ENGLISH_CALL_LANGUAGE_LOCK = lock


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 8))
