"""Code-level model defaults — the safety net when the DB can't answer.

The source of truth for which model a feature uses is the DB
(`ai_model_defaults` per use case, `ai_model_stage_assignments` for the AI-video
stage matrix), edited from the super-admin portal. These constants are only
used when a row is missing or the read fails, so a DB hiccup never silently
moves traffic to an expensive model.

GLM_DEFAULT is served through Isoquant (platform setting `llm.model_routes`),
and llm_router retries the same model on OpenRouter when Isoquant fails.
NON_GLM_FALLBACK is the one different-vendor model at the end of every chain,
so an outage of both GLM gateways doesn't take features down.
"""
from __future__ import annotations

GLM_DEFAULT = "z-ai/glm-5.3-flash"
NON_GLM_FALLBACK = "google/gemini-2.5-flash"
