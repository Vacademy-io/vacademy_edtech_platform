from pydantic import BaseModel, Field
from typing import Optional

class ChatContext(BaseModel):
    page_id: Optional[str] = None
    slide_id: Optional[str] = None
    slide_content: Optional[str] = Field(None, description="Content of the current slide to provide context")

class ChatRequest(BaseModel):
    prompt: str = Field(..., description="Student's doubt or question")
    context: Optional[ChatContext] = None
    institute_id: Optional[str] = Field(None, description="Institute ID for credit deduction")
    user_id: Optional[str] = Field(None, description="User ID for usage tracking")

class ChatResponse(BaseModel):
    content: str = Field(..., description="AI response in MDX format")


class CompletionRequest(BaseModel):
    """A generic single-prompt completion. The caller supplies the FULL prompt
    (system instructions + context + question); ai_service adds no persona of its
    own. Used by other services (e.g. the parent assistant in admin_core) so the
    LLM API key lives only here, never in the calling service."""
    prompt: str = Field(..., description="The full prompt to complete")
    model: Optional[str] = Field(None, description="Optional model id override (honoured for platform staff only)")
    use_case: Optional[str] = Field(
        None, description="ai_model_defaults use case: 'parent_assistant' or 'chat' (default)"
    )
    institute_id: Optional[str] = Field(None, description="Institute ID for credit deduction")
    user_id: Optional[str] = Field(None, description="User ID for usage tracking")


class CompletionResponse(BaseModel):
    content: str = Field(..., description="The completion text (empty on failure)")

