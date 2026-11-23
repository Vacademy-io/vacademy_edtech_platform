"""Pipecat's own log output (loguru): INFO and above, plus the few DEBUG lines we use.

WHY. loguru's default sink logs everything at DEBUG, and pipecat logs every
internal step at DEBUG: processor links, every metric, every vendor message,
every TTS/LLM request with its full text. On the Mumbai box that is about 190
lines per 10 s with a few calls up, formatted by the bot and written by journald
on the SAME single vCPU the calls need (the 2026-11-14 5-call stalls). It also
leaves callers' transcripts in the system journal for no purpose.

WHAT. INFO and above as before, plus DEBUG from a short allowlist we read when
diagnosing calls: vendor socket connects and disconnects (Sarvam STT/TTS,
Smallest STT/TTS, Navana) and pipeline start/finish. Our own app.* loggers are
stdlib logging and are not affected.

PIPECAT_LOG_LEVEL=DEBUG brings back the full output (needs a restart, no deploy);
PIPECAT_LOG_LEVEL=WARNING quietens further. Any other value means INFO.
"""
from __future__ import annotations

import os
import sys

# (module name, function name) pairs kept at DEBUG.
_KEEP_DEBUG = {
    ("pipecat.services.sarvam.stt", "_connect"),
    ("pipecat.services.sarvam.stt", "_disconnect"),
    ("pipecat.services.sarvam.tts", "_connect_websocket"),
    ("pipecat.services.sarvam.tts", "_disconnect_websocket"),
    ("pipecat.services.smallest.stt", "_connect_websocket"),
    ("pipecat.services.smallest.stt", "_disconnect_websocket"),
    ("pipecat.services.smallest.tts", "_connect_websocket"),
    ("pipecat.services.smallest.tts", "_disconnect_websocket"),
    ("bodhi.integrations.pipecat_tts", "_connect_websocket"),
    ("bodhi.integrations.pipecat_tts", "_disconnect_websocket"),
    ("pipecat.pipeline.worker", "run"),
    ("pipecat.pipeline.worker", "_wait_for_pipeline_start"),
}

_LEVELS = {"TRACE": 5, "DEBUG": 10, "INFO": 20, "SUCCESS": 25, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}


def level_name() -> str:
    v = os.environ.get("PIPECAT_LOG_LEVEL", "INFO").strip().upper()
    return v if v in ("DEBUG", "INFO", "WARNING") else "INFO"


def keep(record) -> bool:
    """loguru filter: the record's level is at the threshold, or it is allowlisted DEBUG."""
    threshold = _LEVELS[level_name()]
    no = record["level"].no
    if no >= threshold:
        return True
    return no >= _LEVELS["DEBUG"] and (record["name"], record["function"]) in _KEEP_DEBUG


def configure() -> None:
    """Replace loguru's default DEBUG sink with the filtered one. Same format and
    stream (stderr, which docker sends to journald)."""
    try:
        from loguru import logger
    except Exception:
        return
    if level_name() == "DEBUG":
        return                                  # stock behaviour, untouched
    logger.remove()
    logger.add(sys.stderr, level="DEBUG", filter=keep, backtrace=False, diagnose=False)
