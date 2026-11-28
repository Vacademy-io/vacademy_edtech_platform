"""Request/response schemas for the Vacademy Assistant (admin) surface."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class AssistantInitRequest(BaseModel):
    """Start a new Assistant session. Identity is taken from the JWT, NOT this body."""
    initial_message: Optional[str] = Field(
        None, description="Optional first message from the user."
    )
    context_meta: Optional[Dict[str, Any]] = Field(
        None,
        description="Optional UI context (e.g. the page the user is on) to help the Assistant.",
    )


class AssistantInitResponse(BaseModel):
    session_id: str
    status: str = "idle"


class AssistantMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, description="The user's message.")
    context_meta: Optional[Dict[str, Any]] = Field(
        None,
        description="Current page context (route + selected student) so 'this student' resolves.",
    )


class AssistantMessageResponse(BaseModel):
    message_id: int
    status: str = "processing"


class AssistantCloseResponse(BaseModel):
    session_id: str
    status: str = "CLOSED"
    message_count: int


class AssistantSpeechToTextResponse(BaseModel):
    """A recording turned into text. Nothing is sent to the Assistant: the
    caller shows the transcript for the user to edit and send."""

    transcript: str
    language: Optional[str] = Field(
        None, description="BCP-47 code of the speech (detected when the hint was 'auto')."
    )
    duration_seconds: Optional[float] = Field(
        None, description="Length of the recording, when it could be measured."
    )


# ── chat history ─────────────────────────────────────────────────────────


class AssistantChatSummary(BaseModel):
    id: str
    title: str = Field(..., description="The chat's first question, cut to about 60 characters.")
    last_active: Optional[str] = Field(None, description="ISO-8601 UTC time of the chat's latest activity.")
    message_count: int = Field(..., description="Questions and answers in the chat.")
    is_open: bool = Field(..., description="True while new messages can be sent without continuing it.")


class AssistantChatList(BaseModel):
    items: List[AssistantChatSummary]
    page: int
    page_size: int
    has_more: bool


class AssistantChatCard(BaseModel):
    """A confirmation card as it ended. History cards are read-only."""
    summary: str
    status: Literal["pending", "applying", "executed", "cancelled", "failed", "expired"]
    details: Optional[List[str]] = None
    warnings: Optional[List[str]] = None


class AssistantChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant", "action"]
    content: str
    created_at: Optional[str] = None
    suggestions: Optional[List[str]] = Field(None, description="Follow-up questions offered after this answer.")
    action: Optional[AssistantChatCard] = None


class AssistantChatView(BaseModel):
    id: str
    title: str
    is_open: bool
    last_active: Optional[str] = None
    messages: List[AssistantChatMessage]


class AssistantChatContinueResponse(BaseModel):
    session_id: str
    status: str = "ACTIVE"


class AssistantChatDeleteResponse(BaseModel):
    session_id: str
    status: str = "DELETED"
