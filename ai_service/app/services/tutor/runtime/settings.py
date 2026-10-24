"""Resolve the effective Tutor Mode settings for a course.

Package `course_setting` envelope → institute `setting_json` → platform
settings → built-in defaults (design §5.3). Both admin surfaces write the key
TUTOR_MODE_SETTING; the institute helper wraps its payload one level deeper
({data: {...}}), so both shapes are read.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...platform_settings_service import get_platform_setting

logger = logging.getLogger(__name__)

KEY = "TUTOR_MODE_SETTING"


@dataclass
class TutorSettings:
    enabled: bool = False
    default_on: bool = True
    teacher_name: str = "Asha"
    tts_provider: str = "sarvam"
    tts_model: Optional[str] = None
    tts_voice: Optional[str] = None
    languages: List[str] = field(default_factory=lambda: ["en", "hi"])
    session_language: str = "course"       # course | learner
    llm_model: Optional[str] = None
    compile_model: Optional[str] = None
    strictness: str = "normal"
    generate_images: bool = True
    # Teacher voice speed multiplier (0.7–1.3, 1.0 = the engine's natural
    # pace); a learner's own "slower / faster" is applied on top of it.
    voice_pace: float = 1.0
    # Media file id of the teacher's face shown to learners; blank = the
    # built-in illustrated face.
    teacher_avatar_file_id: Optional[str] = None
    # {"knowledge_base_id": ..., "mode": "STRICT"|"BLENDED"} saved at creation
    # so recompiles from the course page stay grounded.
    kb_grounding: Optional[Dict[str, Any]] = None
    # Premium teacher avatar: "none" | "spatius" and the vendor's avatar id
    # (created from the teacher's face photo).
    avatar_provider: str = "none"
    avatar_id: Optional[str] = None

    @property
    def course_language(self) -> str:
        return (self.languages or ["en"])[0] if (self.languages or ["en"])[0] in ("en", "hi") else "en"


def _extract(envelope: Any) -> Dict[str, Any]:
    """setting.TUTOR_MODE_SETTING.data (or .data.data) from either envelope."""
    if not envelope:
        return {}
    try:
        root = json.loads(envelope) if isinstance(envelope, str) else envelope
        entry = ((root or {}).get("setting") or {}).get(KEY) or {}
        data = entry.get("data") if isinstance(entry, dict) else None
        if isinstance(data, dict) and isinstance(data.get("data"), dict) and "enabled" not in data:
            data = data["data"]
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _apply(s: TutorSettings, d: Dict[str, Any]) -> None:
    def pick(key: str, *alts: str):
        for k in (key, *alts):
            if k in d and d[k] not in (None, ""):
                return d[k]
        return None
    v = pick("enabled");            s.enabled = bool(v) if v is not None else s.enabled
    v = pick("defaultOn", "default_on"); s.default_on = bool(v) if v is not None else s.default_on
    v = pick("teacherName", "teacher_name"); s.teacher_name = str(v)[:60] if v else s.teacher_name
    v = pick("ttsProvider", "tts_provider"); s.tts_provider = str(v) if v else s.tts_provider
    v = pick("ttsModel", "tts_model");   s.tts_model = str(v) if v else s.tts_model
    v = pick("ttsVoice", "tts_voice");   s.tts_voice = str(v) if v else s.tts_voice
    v = pick("languages");               s.languages = [str(x) for x in v][:2] if isinstance(v, list) and v else s.languages
    v = pick("sessionLanguage", "session_language"); s.session_language = str(v) if v else s.session_language
    v = pick("llmModel", "llm_model");   s.llm_model = str(v) if v else s.llm_model
    v = pick("compileModel", "compile_model"); s.compile_model = str(v) if v else s.compile_model
    v = pick("strictness");              s.strictness = str(v) if v else s.strictness
    v = pick("generateImages", "generate_images"); s.generate_images = bool(v) if v is not None else s.generate_images
    v = pick("voicePace", "voice_pace")
    if v is not None:
        try:
            s.voice_pace = max(0.7, min(1.3, float(v)))
        except (TypeError, ValueError):
            pass
    v = pick("teacherAvatarFileId", "teacher_avatar_file_id"); s.teacher_avatar_file_id = str(v)[:255] if v else s.teacher_avatar_file_id
    v = pick("avatarProvider", "avatar_provider"); s.avatar_provider = str(v) if v in ("none", "spatius") else s.avatar_provider
    v = pick("avatarId", "avatar_id");   s.avatar_id = str(v)[:120] if v else s.avatar_id
    v = pick("kbGrounding", "kb_grounding")
    if isinstance(v, dict) and v.get("knowledge_base_id"):
        s.kb_grounding = {"knowledge_base_id": str(v["knowledge_base_id"]),
                          "mode": v.get("mode") if v.get("mode") in ("STRICT", "BLENDED") else "STRICT"}


def resolve_settings(db: Session, *, package_id: str, institute_id: str) -> TutorSettings:
    s = TutorSettings()
    try:
        s.tts_provider = str(get_platform_setting("tutor.voice.provider", default="sarvam", db=db) or "sarvam")
        s.tts_voice = get_platform_setting("tutor.voice.voice", default=None, db=db) or None
    except Exception:  # noqa: BLE001
        pass
    try:
        row = db.execute(text("SELECT setting_json FROM institutes WHERE id = :i"), {"i": institute_id}).first()
        if row and row[0]:
            _apply(s, _extract(row[0]))
    except Exception:  # noqa: BLE001
        logger.warning("institute tutor settings unreadable for %s", institute_id, exc_info=True)
    try:
        row = db.execute(text("SELECT course_setting FROM package WHERE id = :p"), {"p": package_id}).first()
        if row and row[0]:
            _apply(s, _extract(row[0]))
    except Exception:  # noqa: BLE001
        logger.warning("package tutor settings unreadable for %s", package_id, exc_info=True)
    _enforce_registry(db, s, institute_id)
    return s


def _enforce_registry(db: Session, s: TutorSettings, institute_id: str) -> None:
    """A saved avatar must be a ready registry row the institute may see; a
    voice registered to another institute is dropped to the provider default."""
    from ..asset_registry import avatar_allowed, voice_blocked
    try:
        if s.avatar_provider != "none" and s.avatar_id:
            if not avatar_allowed(db, institute_id=institute_id, provider=s.avatar_provider, avatar_id=s.avatar_id):
                logger.info("tutor avatar %s not allowed for institute %s; ignoring", s.avatar_id, institute_id)
                s.avatar_provider, s.avatar_id = "none", None
        if s.tts_voice and voice_blocked(db, institute_id=institute_id, provider=s.tts_provider, voice_id=s.tts_voice):
            logger.info("tutor voice %s not allowed for institute %s; ignoring", s.tts_voice, institute_id)
            s.tts_voice = None
    except Exception:  # noqa: BLE001
        logger.warning("asset registry check failed for %s", institute_id, exc_info=True)
