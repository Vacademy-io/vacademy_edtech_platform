"""
Service for resolving context based on context_type and context_meta.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, Any, Optional

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .slide_text_service import (
    UNREADABLE_SLIDE_NOTE,
    file_belongs_to_institute,
    get_cached_slide_text,
    looks_like_file_id,
    schedule_slide_text_extraction,
)
from .lesson_text_service import Lesson, cached_text, find_lesson, schedule_read
from .lesson_text_service import apply as apply_lesson_text

logger = logging.getLogger(__name__)


def strip_html(html: str, max_length: int = 4000) -> str:
    """Strip HTML tags, decode entities, normalize whitespace, and truncate."""
    if not html:
        return ""
    # Remove script/style blocks
    text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=re.DOTALL | re.IGNORECASE)
    # Replace block-level tags with newlines
    text = re.sub(r'<(br|p|div|li|h[1-6]|tr)[^>]*/?\s*>', '\n', text, flags=re.IGNORECASE)
    # Strip remaining tags
    text = re.sub(r'<[^>]+>', '', text)
    # Decode common HTML entities
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
    # Normalize whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()
    # Truncate
    if len(text) > max_length:
        text = text[:max_length] + "..."
    return text


class ContextResolverService:
    """
    Resolves passive context from context_meta based on context_type.
    Queries appropriate database tables to build context for the LLM.
    """
    
    def __init__(self, db_session: Session):
        self.db = db_session
        # Set by resolve_context when the open lesson's text is still being
        # read; the chat turn waits for it once its DB block is closed.
        self.pending_lesson: Optional[Lesson] = None
    
    async def resolve_context(
        self,
        context_type: str,
        context_meta: Dict[str, Any],
        user_id: str,
        institute_id: str
    ) -> Dict[str, Any]:
        """
        Main method to resolve context based on type.
        Combines:
        1. Frontend context (slide/course/general data)
        2. User performance data (strengths/weaknesses from user_linked_data)
        3. User details (name, email from student table)
      
        Returns:
            Dict with context_type, context_data, user_performance, user_details
        """
        import json
        
        # Get user details from student table
        user_details = await self._fetch_user_details(user_id)
        
        # Get user performance data from admin_core_service
        user_performance = await self._fetch_user_performance(user_id, institute_id)
        
        # Clean HTML from content fields before passing to LLM
        cleaned_meta = dict(context_meta) if context_meta else {}

        # Lessons whose text the app never has (video, SCORM, AI video, audio,
        # decks, drawings) are read server-side; see lesson_text_service. Only
        # real text changes anything below: without it (not read yet, nothing
        # readable) the context is built exactly as before. On a cache miss the
        # read starts now and `pending_lesson` lets a caller wait for it once
        # its DB session is released.
        self.pending_lesson = None
        lesson, lesson_text = None, ""
        if context_type == "slide":
            try:
                lesson = find_lesson(
                    self.db, cleaned_meta.get("slide_id"), institute_id, cleaned_meta.get("name")
                )
                if lesson is not None:
                    known, lesson_text = cached_text(self.db, lesson)
                    if not known:
                        schedule_read(lesson)
                        self.pending_lesson = lesson
            except Exception as exc:  # noqa: BLE001 - lesson text is optional
                logger.warning("lesson text skipped for slide %s: %s", cleaned_meta.get("slide_id"), exc)
                lesson, lesson_text, self.pending_lesson = None, "", None

        # A PDF slide arrives with `content` set to a media fileId rather than
        # the document text (see slide_text_service for the why). Swap in the
        # real text when we have it cached, and otherwise tell the model
        # explicitly that it has not been shown the slide — anything else and it
        # describes a slide it has never seen.
        raw_content = cleaned_meta.get("content")
        if not lesson_text and looks_like_file_id(raw_content):
            file_id = str(raw_content).strip()
            # context_meta is client-supplied and /chat-agent has no auth, so the
            # fileId is attacker-controllable. Only resolve files that really do
            # belong to a slide in THIS session's institute — otherwise this
            # becomes an arbitrary cross-tenant file reader. Gates the cache read
            # too, since the cache is keyed by fileId alone.
            if not file_belongs_to_institute(self.db, file_id, institute_id):
                logger.warning(
                    "slide content fileId %s is not owned by institute %s — "
                    "refusing to resolve",
                    file_id,
                    institute_id,
                )
                cleaned_meta["content"] = UNREADABLE_SLIDE_NOTE
            else:
                slide_text = get_cached_slide_text(self.db, file_id)
                if slide_text:
                    cleaned_meta["content"] = slide_text
                else:
                    cleaned_meta["content"] = UNREADABLE_SLIDE_NOTE
                    # Warm the cache off the request path so the next learner on
                    # this slide gets the real text.
                    schedule_slide_text_extraction(file_id)

        if "content" in cleaned_meta and cleaned_meta["content"]:
            cleaned_meta["content"] = strip_html(cleaned_meta["content"])

        # Real lesson text replaces what the app sent; a video's own
        # description is kept above its transcript (for the other kinds the app
        # sent nothing usable: empty, a deck URL or a drawing fileId).
        if lesson is not None:
            if lesson.keeps_description:
                lesson.description = str(cleaned_meta.get("content") or "")
            apply_lesson_text(cleaned_meta, lesson, lesson_text)
        if "about" in cleaned_meta and cleaned_meta["about"]:
            cleaned_meta["about"] = strip_html(cleaned_meta["about"])
        if "why_learn" in cleaned_meta and cleaned_meta["why_learn"]:
            cleaned_meta["why_learn"] = strip_html(cleaned_meta["why_learn"])
        if "who_should_learn" in cleaned_meta and cleaned_meta["who_should_learn"]:
            cleaned_meta["who_should_learn"] = strip_html(cleaned_meta["who_should_learn"])

        # Clean question/option text (can also contain HTML)
        if "questions" in cleaned_meta and cleaned_meta["questions"]:
            cleaned_meta["questions"] = [strip_html(q) if isinstance(q, str) else q for q in cleaned_meta["questions"]]

        # Return as dict with all context components
        return {
            "context_type": context_type,
            "context_data": cleaned_meta,
            "user_performance": user_performance,
            "user_details": user_details
        }
    
    async def _fetch_user_details(self, user_id: str) -> Dict[str, Any]:
        """
        Fetch user details from student table.
        
        Args:
            user_id: ID of the student
            
        Returns:
            Dict with name and email
        """
        try:
            query = text("""
                SELECT full_name, email
                FROM student
                WHERE user_id = :user_id
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"user_id": user_id}).fetchone()
            
            if result:
                email = result.email or None
                if getattr(result, "full_name", None) and str(result.full_name).strip():
                    name = result.full_name
                elif email and "@" in email:
                    name = email.split("@", 1)[0]
                else:
                    name = "Student"

                return {
                    "name": name,
                    "email": email
                }
            else:
                logger.warning(f"No student record found for user_id {user_id}")
                return {"name": "Student", "email": None}
                
        except Exception as e:
            logger.error(f"Error fetching user details for {user_id}: {e}")
            return {"name": "Student", "email": None}
    
    async def _fetch_user_performance(self, user_id: str, institute_id: str) -> Dict[str, Any]:
        """
        Fetch user's strengths and weaknesses from user_linked_data table.
        Table stores one row per strength/weakness with 'type' column.
        
        Returns:
            Dict with strengths, weaknesses, and performance metrics
        """
        try:
            # Fetch all strengths and weaknesses for the user
            stmt = text("""
                SELECT 
                    type,
                    data,
                    percentage
                FROM user_linked_data
                WHERE user_id = :user_id
                ORDER BY percentage DESC NULLS LAST, created_at DESC
            """)
            
            result = self.db.execute(stmt, {"user_id": user_id})
            rows = result.fetchall()
            
            if not rows:
                logger.info(f"No performance data found for user {user_id}")
                return {
                    "strengths": [],
                    "weaknesses": [],
                    "note": "No performance data available yet"
                }
            
            # Separate strengths and weaknesses
            strengths = []
            weaknesses = []
            
            for row in rows:
                type_val = row[0]  # 'strength' or 'weakness'
                topic = row[1]     # topic name (e.g., 'algebra', 'geometry')
                percentage = row[2]  # score 0-100
                
                entry = {
                    "topic": topic,
                    "score": percentage
                }
                
                if type_val == "strength":
                    strengths.append(entry)
                elif type_val == "weakness":
                    weaknesses.append(entry)
            
            return {
                "strengths": strengths,
                "weaknesses": weaknesses,
                "total_entries": len(rows),
                "note": f"Based on {len(rows)} recorded performance metrics"
            }
            
        except Exception as e:
            logger.error(f"Error fetching user performance data: {e}")
            # Return empty structure so context is still valid
            return {
                "strengths": [],
                "weaknesses": [],
                "note": "Performance data temporarily unavailable"
            }


__all__ = ["ContextResolverService"]
