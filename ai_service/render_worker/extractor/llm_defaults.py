"""Chat-model defaults for the render worker's small LLM calls.

The worker has no database access, so it cannot read the platform's
ai_model_defaults rows; its models are env-driven with the platform default
(GLM) as the code default. Today the worker has no OPENROUTER_API_KEY on prod,
so these calls are inert there; the defaults matter for any environment that
sets one.

GLM cannot turn reasoning off and, with no reasoning shape sent, spends the
whole max_tokens budget thinking. Every GLM call therefore asks for low
effort and gets a max_tokens cap with room for that thinking.
"""
from __future__ import annotations

import os
from typing import Any, Dict

# Keep in step with ai_service/app/constants/model_defaults.py (GLM_DEFAULT);
# the worker image does not ship the app package.
GLM_DEFAULT = "z-ai/glm-5.3-flash"

# Output + low-effort reasoning for a short JSON reply.
LLM_MAX_TOKENS = int(os.environ.get("RENDER_WORKER_LLM_MAX_TOKENS", "1500"))


def llm_model(env_name: str) -> str:
    """$<env_name> > $RENDER_WORKER_LLM_MODEL > GLM."""
    return (
        (os.environ.get(env_name) or "").strip()
        or (os.environ.get("RENDER_WORKER_LLM_MODEL") or "").strip()
        or GLM_DEFAULT
    )


def reasoning_extra_body(model: str) -> Dict[str, Any]:
    """OpenRouter `extra_body` for one call: low reasoning effort for GLM
    (reasoning is mandatory there), nothing for other models."""
    if not (model or "").lower().startswith("z-ai/glm"):
        return {}
    effort = (os.environ.get("RENDER_WORKER_LLM_REASONING_EFFORT") or "low").strip().lower() or "low"
    return {"reasoning": {"enabled": True, "effort": effort}}
