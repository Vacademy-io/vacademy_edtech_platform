"""
Repository for chat_messages table operations.
"""
from __future__ import annotations

import logging
from typing import Optional, List
from datetime import datetime

from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from ..models.chat_message import ChatMessage

logger = logging.getLogger(__name__)


class ChatMessageRepository:
    """
    Handles database operations for chat messages.
    """
    
    def __init__(self, db_session: Session):
        self.db = db_session
    
    def create_message(
        self,
        session_id: str,
        message_type: str,
        content: str,
        metadata: Optional[dict] = None,
    ) -> ChatMessage:
        """
        Create a new chat message.
        
        Args:
            session_id: ID of the chat session
            message_type: Type of message (user, assistant, tool_call, tool_result)
            content: Message content
            metadata: Optional metadata (for tool calls, etc.)
        """
        message = ChatMessage(
            session_id=session_id,
            message_type=message_type,
            content=content,
            meta_data=metadata or {},
        )
        
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        
        logger.debug(f"Created message {message.id} of type {message_type} for session {session_id}")
        return message
    
    def get_messages_by_session(
        self,
        session_id: str,
        limit: Optional[int] = None,
        after_message_id: Optional[int] = None,
    ) -> List[ChatMessage]:
        """
        Get messages for a session.
        
        Args:
            session_id: ID of the chat session
            limit: Maximum number of messages to return
            after_message_id: Only return messages with ID > this value
        """
        stmt = select(ChatMessage).where(ChatMessage.session_id == session_id)
        
        if after_message_id is not None:
            stmt = stmt.where(ChatMessage.id > after_message_id)
        
        stmt = stmt.order_by(ChatMessage.id.asc())
        
        if limit:
            stmt = stmt.limit(limit)
        
        result = self.db.execute(stmt)
        return list(result.scalars().all())
    
    def get_recent_user_messages(self, session_id: str, limit: int = 5) -> List[ChatMessage]:
        """
        Get the most recent user messages from a session.
        Used for building conversation context.
        """
        stmt = (
            select(ChatMessage)
            .where(and_(
                ChatMessage.session_id == session_id,
                ChatMessage.message_type == "user"
            ))
            .order_by(ChatMessage.id.desc())
            .limit(limit)
        )
        
        result = self.db.execute(stmt)
        messages = list(result.scalars().all())
        
        # Return in chronological order
        return list(reversed(messages))
    
    def get_conversation_history(
        self,
        session_id: str,
        limit: int = 10,
        message_types: Optional[List[str]] = None,
    ) -> List[ChatMessage]:
        """
        Get recent conversation history (user + assistant messages only).
        
        Args:
            session_id: ID of the chat session
            limit: Maximum number of messages (should be even for user/assistant pairs)
        """
        stmt = (
            select(ChatMessage)
            .where(and_(
                ChatMessage.session_id == session_id,
                ChatMessage.message_type.in_(message_types or ["user", "assistant"])
            ))
            .order_by(ChatMessage.id.desc())
            .limit(limit)
        )
        
        result = self.db.execute(stmt)
        messages = list(result.scalars().all())
        
        # Return in chronological order
        return list(reversed(messages))
    
    def count_messages_by_session(self, session_id: str) -> int:
        """
        Count total messages in a session.
        """
        stmt = select(ChatMessage).where(ChatMessage.session_id == session_id)
        result = self.db.execute(stmt)
        return len(list(result.scalars().all()))
    
    def get_latest_message(self, session_id: str) -> Optional[ChatMessage]:
        """
        Get the most recent message from a session.
        
        Args:
            session_id: ID of the chat session
            
        Returns:
            The latest ChatMessage or None if no messages exist
        """
        stmt = (
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.id.desc())
            .limit(1)
        )
        
        result = self.db.execute(stmt)
        return result.scalars().first()


    def find_by_idempotency_key(self, session_id: str, key: str) -> Optional[ChatMessage]:
        """Find a message by idempotency key in metadata."""
        try:
            from sqlalchemy import text
            query = text("""
                SELECT id FROM chat_messages
                WHERE session_id = :session_id
                AND metadata->>'idempotency_key' = :key
                AND message_type = 'user'
                LIMIT 1
            """)
            result = self.db.execute(query, {"session_id": session_id, "key": key}).fetchone()
            if result:
                return self.db.query(ChatMessage).filter(ChatMessage.id == result[0]).first()
            return None
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error finding message by idempotency key: {e}")
            return None


__all__ = ["ChatMessageRepository"]
