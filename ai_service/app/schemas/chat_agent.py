"""
Pydantic schemas for chat agent API endpoints.
"""
from __future__ import annotations

from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from enum import Enum


class SessionMode(str, Enum):
    """Enumeration of session modes (text vs voice variants)."""
    TEXT = "text"
    VOICE_INTERVIEW = "voice_interview"
    VOICE_DOUBT = "voice_doubt"
    VOICE_ORAL_TEST = "voice_oral_test"


class ContextType(str, Enum):
    """Enumeration of supported context types."""
    SLIDE = "slide"
    COURSE_DETAILS = "course_details"
    GENERAL = "general"


class MessageType(str, Enum):
    """Enumeration of message types."""
    USER = "user"
    ASSISTANT = "assistant"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    QUIZ = "quiz"  # Contains quiz data for practice mode
    QUIZ_FEEDBACK = "quiz_feedback"  # Contains quiz results and feedback
    SUMMARY = "summary"  # Hierarchical conversation summary


class MessageIntent(str, Enum):
    """Categorization of user message intent."""
    DOUBT = "doubt"        # User has a question/doubt about content
    PRACTICE = "practice"  # User wants to practice/take a quiz
    GENERAL = "general"    # Regular conversation (default)


class Attachment(BaseModel):
    """File attachment for multimodal messages."""
    type: str = Field(..., description="Attachment type: 'image' or 'video'")
    url: str = Field(..., description="URL of the attachment")
    mime_type: Optional[str] = Field(None, description="MIME type, e.g., 'image/png'")
    name: Optional[str] = Field(None, description="Optional file name")


class SessionStatus(str, Enum):
    """Enumeration of session statuses."""
    ACTIVE = "ACTIVE"
    CLOSED = "CLOSED"


class AIStatus(str, Enum):
    """Enumeration of AI processing statuses."""
    IDLE = "idle"
    THINKING = "thinking"
    TOOL_EXECUTING = "tool_executing"
    GENERATING_QUIZ = "generating_quiz"


# Quiz Related Schemas

class QuizQuestion(BaseModel):
    """A single quiz question."""
    id: str = Field(..., description="Unique question identifier")
    question: str = Field(..., description="The question text")
    options: List[str] = Field(..., description="List of answer options")
    correct_answer_index: Optional[int] = Field(
        None, 
        description="Index of correct answer (only in backend, stripped for frontend)"
    )
    explanation: Optional[str] = Field(
        None,
        description="Explanation for the correct answer (shown in feedback)"
    )


class QuizData(BaseModel):
    """Quiz data for PRACTICE mode."""
    quiz_id: str = Field(..., description="Unique quiz identifier")
    title: str = Field(..., description="Quiz title")
    topic: str = Field(..., description="Topic being tested")
    questions: List[QuizQuestion] = Field(..., description="List of quiz questions")
    time_limit_seconds: Optional[int] = Field(None, description="Optional time limit")
    total_questions: int = Field(..., description="Total number of questions")
    
    class Config:
        json_schema_extra = {
            "example": {
                "quiz_id": "quiz-uuid-123",
                "title": "Photosynthesis Quiz",
                "topic": "photosynthesis",
                "total_questions": 5,
                "questions": [
                    {
                        "id": "q1",
                        "question": "What is the primary pigment in photosynthesis?",
                        "options": ["Chlorophyll", "Carotenoid", "Xanthophyll", "Phycocyanin"]
                    }
                ]
            }
        }


class QuizSubmission(BaseModel):
    """User's quiz answers."""
    quiz_id: str = Field(..., description="ID of the quiz being submitted")
    answers: Dict[str, int] = Field(
        ..., 
        description="Map of question_id to selected option index"
    )
    time_taken_seconds: Optional[int] = Field(None, description="Time taken to complete")
    
    class Config:
        json_schema_extra = {
            "example": {
                "quiz_id": "quiz-uuid-123",
                "answers": {"q1": 0, "q2": 2, "q3": 1},
                "time_taken_seconds": 120
            }
        }


class QuestionFeedback(BaseModel):
    """Feedback for a single question."""
    question_id: str
    question_text: str
    correct: bool
    user_answer_index: Optional[int]
    correct_answer_index: int
    user_answer_text: Optional[str]
    correct_answer_text: str
    explanation: Optional[str]


class QuizFeedback(BaseModel):
    """Feedback after quiz completion."""
    quiz_id: str = Field(..., description="ID of the completed quiz")
    score: int = Field(..., description="Number of correct answers")
    total: int = Field(..., description="Total number of questions")
    percentage: float = Field(..., description="Score percentage")
    passed: bool = Field(..., description="Whether the user passed (>=60%)")
    question_feedback: List[QuestionFeedback] = Field(
        ..., 
        description="Per-question feedback"
    )
    overall_feedback: str = Field(..., description="AI-generated summary feedback")
    recommendations: List[str] = Field(
        default_factory=list,
        description="Recommendations for improvement"
    )
    time_taken_seconds: Optional[int] = Field(None, description="Time taken")
    
    class Config:
        json_schema_extra = {
            "example": {
                "quiz_id": "quiz-uuid-123",
                "score": 4,
                "total": 5,
                "percentage": 80.0,
                "passed": True,
                "overall_feedback": "Great job! You have a strong understanding of photosynthesis.",
                "recommendations": ["Review the light-dependent reactions"],
                "question_feedback": []
            }
        }


# Request Schemas

class InitSessionRequest(BaseModel):
    """Request to initialize a new chat session."""
    user_id: str = Field(..., description="User ID from client")
    institute_id: str = Field(..., description="Institute ID from client")
    user_name: Optional[str] = Field(None, description="User's name for personalized greeting")
    context_type: Optional[ContextType] = Field(None, description="Type of context for the chat session (can be set later via context API)")
    context_meta: Optional[Dict[str, Any]] = Field(
        None, 
        description="Complete metadata with all data from frontend (can be set later via context API)"
    )
    session_mode: Optional[SessionMode] = Field(SessionMode.TEXT, description="Session mode: text chat or voice variant")
    initial_message: Optional[str] = Field(None, description="Optional initial message from the user")
    
    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user-123",
                "institute_id": "inst-456",
                "user_name": "John Doe",
                "context_type": None,
                "context_meta": None,
                "initial_message": None
            }
        }
        
    class Config:
        json_schema_extra = {
            "example_with_context": {
                "user_id": "user-123",
                "institute_id": "inst-456",
                "user_name": "John Doe",
                "context_type": "slide",
                "context_meta": {
                    "name": "Introduction to Photosynthesis",
                    "content": "<p>Photosynthesis is...</p>",
                    "level": "2",
                    "order": 5,
                    "chapter": "Plant Biology",
                    "module": "Biology 101",
                    "subject": "Biology",
                    "course": "Science",
                    "progress": "45%"
                },
                "initial_message": "I don't understand how chlorophyll works"
            }
        }


class SendMessageRequest(BaseModel):
    """Request to send a message in an existing session."""
    message: str = Field(
        "",
        description="The message content from the user. May be empty only when attachments are sent.",
        max_length=8000,
    )
    intent: Optional[MessageIntent] = Field(
        None,
        description="Optional message intent (doubt/practice/general). If not provided, AI will classify automatically."
    )
    quiz_submission: Optional[QuizSubmission] = Field(
        None,
        description="Quiz answers when submitting a completed quiz"
    )
    idempotency_key: Optional[str] = Field(
        None,
        description="Optional UUID to prevent duplicate message processing"
    )
    attachments: Optional[List[Attachment]] = Field(
        None,
        description="Optional image/video attachments for multimodal messages",
        max_length=5,
    )

    @model_validator(mode="after")
    def _text_or_attachment(self):
        # A photo of a question with no typed text is a real message; nothing
        # at all is not.
        if not (self.message or "").strip() and not self.attachments and not self.quiz_submission:
            raise ValueError("message must not be empty")
        return self

    class Config:
        json_schema_extra = {
            "example": {
                "message": "Can you explain this in simple terms?"
            },
            "example_practice": {
                "message": "I want to practice",
                "intent": "practice"
            },
            "example_quiz_submit": {
                "message": "Quiz completed",
                "quiz_submission": {
                    "quiz_id": "quiz-uuid-123",
                    "answers": {"q1": 0, "q2": 2},
                    "time_taken_seconds": 120
                }
            }
        }


class UpdateContextRequest(BaseModel):
    """Request to update context for an existing session without triggering AI response."""
    context_type: ContextType = Field(..., description="Type of context for the chat session")
    context_meta: Dict[str, Any] = Field(
        ..., 
        description="Complete metadata with all data from frontend"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "context_type": "slide",
                "context_meta": {
                    "name": "Cell Division",
                    "content": "<p>Cell division is...</p>",
                    "level": "3",
                    "order": 6,
                    "chapter": "Cell Biology",
                    "module": "Biology 101",
                    "subject": "Biology",
                    "course": "Science",
                    "progress": "50%"
                }
            }
        }


# Response Schemas

class InitSessionResponse(BaseModel):
    """Response after initializing a chat session."""
    session_id: str = Field(..., description="Unique identifier for the chat session")
    status: AIStatus = Field(..., description="Current AI processing status")
    
    class Config:
        json_schema_extra = {
            "example": {
                "session_id": "session-uuid-123",
                "status": "thinking"
            }
        }


class SendMessageResponse(BaseModel):
    """Response after sending a message."""
    message_id: int = Field(..., description="ID of the created message")
    status: AIStatus = Field(..., description="Current AI processing status")
    
    class Config:
        json_schema_extra = {
            "example": {
                "message_id": 42,
                "status": "thinking"
            }
        }


class UpdateContextResponse(BaseModel):
    """Response after updating session context."""
    session_id: str = Field(..., description="Session identifier")
    context_type: str = Field(..., description="Updated context type")
    success: bool = Field(..., description="Whether the context was updated successfully")
    
    class Config:
        json_schema_extra = {
            "example": {
                "session_id": "session-uuid-123",
                "context_type": "slide",
                "success": True
            }
        }


class ChatMessageSchema(BaseModel):
    """Schema for a single chat message."""
    id: int = Field(..., description="Message ID")
    type: MessageType = Field(..., description="Type of message")
    content: str = Field(..., description="Message content")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Optional metadata")
    created_at: datetime = Field(..., description="Message creation timestamp")
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": 121,
                "type": "user",
                "content": "Can you explain this?",
                "metadata": None,
                "created_at": "2026-01-08T10:00:00Z"
            }
        }


class GetUpdatesResponse(BaseModel):
    """Response for polling updates."""
    messages: List[ChatMessageSchema] = Field(default_factory=list, description="New messages since last poll")
    ai_status: AIStatus = Field(..., description="Current AI processing status")
    session_status: SessionStatus = Field(..., description="Session status (ACTIVE or CLOSED)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "messages": [
                    {
                        "id": 121,
                        "type": "user",
                        "content": "Can you explain this?",
                        "metadata": None,
                        "created_at": "2026-01-08T10:00:00Z"
                    },
                    {
                        "id": 122,
                        "type": "assistant",
                        "content": "Sure! Here's an explanation...",
                        "metadata": None,
                        "created_at": "2026-01-08T10:00:03Z"
                    }
                ],
                "ai_status": "idle",
                "session_status": "ACTIVE"
            }
        }


class CloseSessionResponse(BaseModel):
    """Response after closing a session."""
    session_id: str = Field(..., description="ID of the closed session")
    status: SessionStatus = Field(..., description="Final session status")
    message_count: int = Field(..., description="Total number of messages in the session")
    
    class Config:
        json_schema_extra = {
            "example": {
                "session_id": "session-uuid-123",
                "status": "CLOSED",
                "message_count": 15
            }
        }


__all__ = [
    "SessionMode",
    "ContextType",
    "MessageType",
    "MessageIntent",
    "Attachment",
    "SessionStatus",
    "AIStatus",
    "QuizQuestion",
    "QuizData",
    "QuizSubmission",
    "QuestionFeedback",
    "QuizFeedback",
    "InitSessionRequest",
    "SendMessageRequest",
    "UpdateContextRequest",
    "InitSessionResponse",
    "SendMessageResponse",
    "UpdateContextResponse",
    "ChatMessageSchema",
    "GetUpdatesResponse",
    "CloseSessionResponse",
]
